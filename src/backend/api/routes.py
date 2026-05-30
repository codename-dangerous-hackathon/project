from fastapi import APIRouter, HTTPException, UploadFile, File
from fastapi.responses import Response
from pydantic import BaseModel
from typing import List, Optional
from agents.companion import ask_companion
from database.chroma_manager import vdb
from tools.audio import transcribe_audio_local, synthesize_speech_local
from tools.vision import extract_face_embedding_from_base64
from services import reminders
from services import eventbrite
from services import profile
import uuid

router = APIRouter()

# Minimum cosine similarity (1 - Chroma cosine distance) to count as the same
# person. buffalo_l/ArcFace gives ~0.5+ for the same face and <0.2 for
# different faces, so 0.35 is a comfortable, conservative cut.
FACE_MATCH_THRESHOLD = 0.35

class ChatTurn(BaseModel):
    role: str
    content: str

class AskRequest(BaseModel):
    user_input: str
    history: Optional[List[ChatTurn]] = None

class EnrollMemoryRequest(BaseModel):
    text: str
    date: Optional[str] = None
    tags: Optional[str] = None

class EnrollFaceRequest(BaseModel):
    name: str
    relationship: str
    # Base64 (raw or data: URL) of the caregiver-uploaded photo.
    image_base64: str

class IdentifyRequest(BaseModel):
    # Base64 string of the captured image from the UI
    image_base64: str

class CreatePersonRequest(BaseModel):
    name: str
    relationship: str
    image_base64: Optional[str] = None  # photo is optional

class EventRequest(BaseModel):
    type: str                       # medication | appointment | family
    title: str
    notes: Optional[str] = ""
    time: str                       # "HH:MM" (24h)
    date: Optional[str] = ""        # "YYYY-MM-DD" for one-off events
    recurrence: Optional[str] = "once"  # "daily" for medications, else "once"

class ProfileRequest(BaseModel):
    name: Optional[str] = None
    tagline: Optional[str] = None
    photo: Optional[str] = None  # base64 data URL (the patient's own photo)

class PersonMemoryRequest(BaseModel):
    text: str

class PersonPhotoRequest(BaseModel):
    image_base64: str

@router.post("/ask")
async def ask_endpoint(request: AskRequest):
    """
    Open Companion Q&A (the infinite-patience loop).
    Passes the input to the NemoClaw/Nemotron Companion Agent.
    """
    try:
        history = [turn.model_dump() for turn in request.history] if request.history else None
        reply = ask_companion(request.user_input, history=history)
        return {"reply": reply}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/enroll")
async def enroll_face(request: EnrollFaceRequest):
    """
    Caregiver App: enroll a family member from a photo. The local InsightFace
    model turns the photo into a 512-d embedding which is stored in the Vector
    DB; the original photo is never persisted (privacy by design).
    """
    try:
        embedding = extract_face_embedding_from_base64(request.image_base64)
        if embedding is None:
            return {
                "status": "no_face",
                "message": "No clear face detected. Please use a well-lit, front-facing photo.",
            }
        person_id = str(uuid.uuid4())
        vdb.add_face_embedding(
            person_id=person_id,
            embedding=embedding,
            metadata={"name": request.name, "relationship": request.relationship},
        )
        return {"status": "success", "person_id": person_id, "name": request.name}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/identify")
async def identify_person(request: IdentifyRequest):
    """
    Match a live camera frame against enrolled face embeddings in the Vector DB.
    """
    try:
        embedding = extract_face_embedding_from_base64(request.image_base64)
        if embedding is None:
            return {"match": False, "message": "I can't see a face clearly right now."}

        if vdb.face_collection.count() == 0:
            return {"match": False, "message": "No family members have been enrolled yet."}

        results = vdb.recognize_face(embedding_query=embedding, n_results=1)
        distances = results.get("distances") or [[]]
        metadatas = results.get("metadatas") or [[]]
        ids = results.get("ids") or [[]]

        if distances[0]:
            # Chroma cosine distance = 1 - cosine similarity.
            similarity = 1.0 - distances[0][0]
            if similarity >= FACE_MATCH_THRESHOLD:
                meta = metadatas[0][0]
                person_id = ids[0][0]
                # Pull a warm, remembered fact about this person if we have one.
                person_mems = vdb.list_memories_for_person(person_id)
                fact = person_mems[0]["text"] if person_mems else ""
                return {
                    "match": True,
                    "person_id": person_id,
                    "name": meta.get("name"),
                    "relationship": meta.get("relationship"),
                    "fact": fact,
                    "confidence": round(similarity, 3),
                }

        return {"match": False, "message": "I don't recognize this person yet."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ----- Family member profiles (photo optional, rich memories) -----

@router.post("/people")
async def create_person(request: CreatePersonRequest):
    """Create a family member. Photo is optional — facts work without one."""
    try:
        if not request.name.strip() or not request.relationship.strip():
            raise HTTPException(status_code=400, detail="Name and relationship are required.")
        person_id = str(uuid.uuid4())
        if request.image_base64:
            embedding = extract_face_embedding_from_base64(request.image_base64)
            if embedding is None:
                # Still create the person, just without face recognition.
                vdb.add_person(person_id, request.name, request.relationship, has_photo=False)
                return {
                    "status": "no_face",
                    "person_id": person_id,
                    "name": request.name,
                    "has_photo": False,
                    "message": "Saved — but no clear face was detected, so 'Who is this?' won't recognize them yet. Add a clearer photo anytime.",
                }
            vdb.set_person_photo(person_id, embedding, request.name, request.relationship)
            return {"status": "success", "person_id": person_id, "name": request.name, "has_photo": True}
        vdb.add_person(person_id, request.name, request.relationship, has_photo=False)
        return {"status": "success", "person_id": person_id, "name": request.name, "has_photo": False}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/people")
async def list_people():
    try:
        return {"people": vdb.list_people()}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/people/{person_id}")
async def get_person(person_id: str):
    person = vdb.get_person(person_id)
    if not person:
        raise HTTPException(status_code=404, detail="Person not found")
    person["memories"] = vdb.list_memories_for_person(person_id)
    return person

@router.delete("/people/{person_id}")
async def delete_person(person_id: str):
    try:
        vdb.delete_person(person_id)
        return {"status": "deleted", "id": person_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/people/{person_id}/memories")
async def add_person_memory(person_id: str, request: PersonMemoryRequest):
    person = vdb.get_person(person_id)
    if not person:
        raise HTTPException(status_code=404, detail="Person not found")
    if not request.text.strip():
        raise HTTPException(status_code=400, detail="Memory text is required.")
    mem_id = str(uuid.uuid4())
    vdb.add_memory(mem_id, request.text, metadata={
        "person_id": person_id,
        "person_name": person["name"],
        "relationship": person["relationship"],
        "scope": "person",
        "tags": "person",
    })
    return {"status": "success", "memory_id": mem_id}

@router.post("/people/{person_id}/photo")
async def set_person_photo(person_id: str, request: PersonPhotoRequest):
    person = vdb.get_person(person_id)
    if not person:
        raise HTTPException(status_code=404, detail="Person not found")
    embedding = extract_face_embedding_from_base64(request.image_base64)
    if embedding is None:
        return {"status": "no_face", "message": "No clear face detected. Try a well-lit, front-facing photo."}
    vdb.set_person_photo(person_id, embedding, person["name"], person["relationship"])
    return {"status": "success"}

# ----- Calendar events + Web Push reminders -----

@router.get("/events")
async def get_events():
    return {"events": reminders.list_events()}

@router.post("/events")
async def create_event(request: EventRequest):
    return reminders.add_event(request.model_dump())

@router.delete("/events/{event_id}")
async def delete_event(event_id: str):
    reminders.delete_event(event_id)
    return {"status": "deleted", "id": event_id}

@router.get("/discover/events")
async def discover_events(location: str = "online", q: str = "dementia", limit: int = 20):
    """Public dementia-related events from Eventbrite (for the caregiver to browse
    and add to the patient's calendar)."""
    try:
        return {"events": eventbrite.fetch_dementia_events(location, q, limit)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/push/public_key")
async def push_public_key():
    return {"public_key": reminders.VAPID_PUBLIC}

@router.post("/push/subscribe")
async def push_subscribe(subscription: dict):
    reminders.add_subscription(subscription)
    return {"status": "subscribed"}

@router.post("/push/test")
async def push_test():
    """Fire a test push to all subscribed devices (to verify notifications)."""
    sent = reminders.send_push({
        "title": "🔔 Belong reminder test",
        "body": "Great — reminders are working!",
        "type": "test",
        "event_id": "test",
        "event_title": "Test",
    })
    return {"sent": sent}

@router.get("/profile")
async def get_patient_profile():
    return profile.get_profile()

@router.post("/profile")
async def update_patient_profile(request: ProfileRequest):
    return profile.save_profile(request.model_dump(exclude_none=True))

@router.get("/journal")
async def journal():
    """Grouped view for the patient: each family member with their memories,
    plus general notes about the patient."""
    try:
        people = []
        for p in vdb.list_people():
            people.append({**p, "memories": vdb.list_memories_for_person(p["id"])})
        return {"people": people, "general": vdb.list_general_memories()}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/enroll_memory")
async def enroll_memory(request: EnrollMemoryRequest):
    """
    Caregiver App: Add a life-story fact or memory text to ChromaDB.
    """
    try:
        mem_id = str(uuid.uuid4())
        vdb.add_memory(
            memory_id=mem_id,
            text=request.text,
            metadata={"date": request.date or "", "tags": request.tags or ""}
        )
        return {"status": "success", "memory_id": mem_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/memories")
async def list_memories():
    """List every life-story memory so the caregiver can verify what's stored."""
    try:
        return {"memories": vdb.list_memories()}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.delete("/memories/{memory_id}")
async def delete_memory(memory_id: str):
    try:
        vdb.delete_memory(memory_id)
        return {"status": "deleted", "id": memory_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/faces")
async def list_faces():
    """List every enrolled person (name + relationship; embeddings stay private)."""
    try:
        return {"faces": vdb.list_faces()}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.delete("/faces/{person_id}")
async def delete_face(person_id: str):
    try:
        vdb.delete_face(person_id)
        return {"status": "deleted", "id": person_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/transcribe")
async def transcribe(file: UploadFile = File(...)):
    """
    Takes an audio file from the Patient UI, returns recognized text.
    """
    try:
        content = await file.read()
        text = transcribe_audio_local(content)
        return {"text": text}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/synthesize")
async def synthesize(request: AskRequest):
    """
    Takes companion text, returns a WAV audio file (TTS).
    """
    try:
        wav_bytes = synthesize_speech_local(request.user_input)
        return Response(content=wav_bytes, media_type="audio/wav")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/briefing")
async def get_daily_briefing():
    """
    Gentle morning audio/text summary logic.
    Could query ChromaDB for today's 'routine' context.
    """
    routine_results = vdb.query_memories("morning routine schedule", n_results=1)
    routine_hint = "No specific schedule."
    if routine_results['documents'] and len(routine_results['documents'][0]) > 0:
        routine_hint = routine_results['documents'][0][0]
        
    return {"briefing": f"Good morning. Here is what we have: {routine_hint}."}



@router.get("/events")
async def get_events():
    """
    Returns dementia-related events in Toronto from Eventbrite.
    """
    try:
        import re
        import time
        import requests
        from bs4 import BeautifulSoup

        BASE_URL = "https://www.eventbrite.ca/d/canada--toronto/dementia/"
        HEADERS = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-CA,en;q=0.9",
            "Accept-Encoding": "gzip, deflate, br",
            "Connection": "keep-alive",
            "Upgrade-Insecure-Requests": "1",
            "Sec-Fetch-Dest": "document",
            "Sec-Fetch-Mode": "navigate",
            "Sec-Fetch-Site": "none",
            "Sec-Fetch-User": "?1",
            "Cache-Control": "max-age=0",
        }

        session = requests.Session()
        session.headers.update(HEADERS)
        session.get("https://www.eventbrite.ca/", timeout=15)
        time.sleep(1)

        resp = session.get(BASE_URL, timeout=20)
        resp.raise_for_status()
        soup = BeautifulSoup(resp.text, "html.parser")

        events = []
        seen_urls = set()

        for link in soup.find_all("a", class_="event-card-link"):
            href = link.get("href", "")
            if not href or "/e/" not in href:
                continue

            clean_url = href.split("?")[0]
            if clean_url in seen_urls:
                continue
            seen_urls.add(clean_url)

            h3 = link.find("h3")
            title = h3.get_text(strip=True) if h3 else link.get("aria-label", "").replace("View ", "")
            if not title:
                continue

            event_id_match = re.search(r"-(\d+)$", clean_url)
            event_id = event_id_match.group(1) if event_id_match else None

            section = link.find_parent("section") or link.find_parent("div")
            date_text = ""
            location_text = ""

            if section:
                for p in section.find_all("p"):
                    text = p.get_text(strip=True)
                    if re.search(r"(Mon|Tue|Wed|Thu|Fri|Sat|Sun|Today|Tomorrow|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)", text):
                        date_text = text
                    elif "·" in text:
                        location_text = text

            events.append({
                "id": event_id,
                "title": title,
                "date": date_text,
                "location": location_text,
                "url": clean_url,
            })

        return {"total": len(events), "events": events}

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))