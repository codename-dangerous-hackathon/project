from fastapi import APIRouter, HTTPException, UploadFile, File
from fastapi.responses import Response
from pydantic import BaseModel
from typing import List, Optional
from agents.companion import ask_companion
from database.chroma_manager import vdb
from database import store      # SQLite reads (authoritative for structured data)
from database import writes     # dual-write coordinator (SQLite + Chroma)
from tools.audio import transcribe_audio_local, synthesize_speech_local
from tools.vision import extract_face_embedding_from_base64
from services import reminders
from services import eventbrite
from services import profile
from services import places
from services import photos
import uuid

router = APIRouter()

# Minimum cosine similarity (1 - Chroma cosine distance) to count as the same
# person. buffalo_l/ArcFace gives ~0.5+ for the same face and <0.2 for
# different faces, so 0.35 is a comfortable, conservative cut.
FACE_MATCH_THRESHOLD = 0.35

class ChatTurn(BaseModel):
    role: str
    content: str

class LatLng(BaseModel):
    lat: float
    lng: float

class AskRequest(BaseModel):
    user_input: str
    history: Optional[List[ChatTurn]] = None
    location: Optional[LatLng] = None  # patient's current location, if shared

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
    emergency_name: Optional[str] = None
    emergency_phone: Optional[str] = None
    medical: Optional[str] = None  # allergies, conditions, blood type, etc.

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
        location = request.location.model_dump() if request.location else None
        reply = ask_companion(request.user_input, history=history, location=location)
        return {"reply": reply}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# LEGACY (back-compat): /enroll, /faces, DELETE /faces/{id} are the old face-only
# path that never created a people row (the UI uses /people). Left on Chroma; not
# part of the SQLite cutover.
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
                # (Face match stays on Chroma; the fact comes from SQLite.)
                person_mems = store.list_memories_for_person(person_id)
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
        if request.image_base64:
            embedding = extract_face_embedding_from_base64(request.image_base64)
            person_id = writes.create_person(request.name, request.relationship,
                                             has_photo=embedding is not None)
            photos.save_photo(person_id, request.image_base64)  # thumbnail for "About Me"
            if embedding is None:
                return {
                    "status": "no_face",
                    "person_id": person_id,
                    "name": request.name,
                    "has_photo": False,
                    "message": "Saved — but no clear face was detected, so 'Who is this?' won't recognize them yet. Add a clearer photo anytime.",
                }
            writes.set_photo_flag(person_id, request.name, request.relationship, embedding)
            return {"status": "success", "person_id": person_id, "name": request.name, "has_photo": True}
        person_id = writes.create_person(request.name, request.relationship, has_photo=False)
        return {"status": "success", "person_id": person_id, "name": request.name, "has_photo": False}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/people")
async def list_people():
    try:
        return {"people": store.list_people()}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/people/{person_id}")
async def get_person(person_id: str):
    person = store.get_person(person_id)
    if not person:
        raise HTTPException(status_code=404, detail="Person not found")
    person["memories"] = store.list_memories_for_person(person_id)
    return person

@router.get("/people/{person_id}/photo")
async def get_person_photo(person_id: str):
    """Serve the stored thumbnail for a family member (for the About Me cards)."""
    from fastapi.responses import FileResponse
    path = photos.photo_path(person_id)
    if not path:
        raise HTTPException(status_code=404, detail="No photo")
    return FileResponse(path, media_type="image/jpeg")

@router.delete("/people/{person_id}")
async def delete_person(person_id: str):
    try:
        writes.delete_person(person_id)
        photos.delete_photo(person_id)
        return {"status": "deleted", "id": person_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/people/{person_id}/memories")
async def add_person_memory(person_id: str, request: PersonMemoryRequest):
    person = store.get_person(person_id)
    if not person:
        raise HTTPException(status_code=404, detail="Person not found")
    if not request.text.strip():
        raise HTTPException(status_code=400, detail="Memory text is required.")
    mem_id = writes.record_memory(
        request.text, person_id=person_id, person_name=person["name"],
        relationship=person["relationship"], scope="person", tags="person",
    )
    return {"status": "success", "memory_id": mem_id}

@router.post("/people/{person_id}/photo")
async def set_person_photo(person_id: str, request: PersonPhotoRequest):
    person = store.get_person(person_id)
    if not person:
        raise HTTPException(status_code=404, detail="Person not found")
    photos.save_photo(person_id, request.image_base64)  # thumbnail for "About Me"
    embedding = extract_face_embedding_from_base64(request.image_base64)
    if embedding is None:
        return {"status": "no_face", "message": "No clear face detected. Try a well-lit, front-facing photo."}
    writes.set_photo_flag(person_id, person["name"], person["relationship"], embedding)
    return {"status": "success"}

# ----- Calendar events + Web Push reminders -----

@router.get("/events")
async def get_events():
    return {"events": store.list_events()}

@router.post("/events")
async def create_event(request: EventRequest):
    return reminders.add_event(request.model_dump())

@router.delete("/events/{event_id}")
async def delete_event(event_id: str):
    reminders.delete_event(event_id)
    return {"status": "deleted", "id": event_id}

@router.get("/places/nearest")
async def places_nearest(category: str, lat: float, lng: float, n: int = 3):
    """Nearest washroom / care home to a location (the agent's location tool)."""
    try:
        return {"category": category, "results": places.find_nearest(category, lat, lng, n)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

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
    return store.get_profile()

@router.post("/profile")
async def update_patient_profile(request: ProfileRequest):
    return profile.save_profile(request.model_dump(exclude_none=True))

@router.get("/journal")
async def journal():
    """Grouped view for the patient: each family member with their memories,
    plus general notes about the patient."""
    try:
        people = []
        for p in store.list_people():
            people.append({**p, "memories": store.list_memories_for_person(p["id"])})
        return {"people": people, "general": store.list_general_memories()}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/enroll_memory")
async def enroll_memory(request: EnrollMemoryRequest):
    """
    Caregiver App: Add a life-story fact or memory text to ChromaDB.
    """
    try:
        mem_id = writes.record_memory(
            request.text, person_id=None, scope="general",
            tags=request.tags or "", date=request.date or "",
        )
        return {"status": "success", "memory_id": mem_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/memories")
async def list_memories():
    """List every life-story memory so the caregiver can verify what's stored."""
    try:
        return {"memories": store.list_memories()}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.delete("/memories/{memory_id}")
async def delete_memory(memory_id: str):
    try:
        writes.delete_memory(memory_id)
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
    """A warm, concrete morning briefing composed on-device from the patient
    profile + today's schedule. Deterministic (no LLM) so it's instant and never
    invents anything."""
    from datetime import datetime

    now = datetime.now()
    prof = store.get_profile()
    first = (prof.get("name") or "").split()[0] if prof.get("name") else ""
    greeting = f"Good morning, {first}." if first else "Good morning."
    parts = [greeting, f"Today is {now.strftime('%A, %B %d')}."]
    schedule = reminders.calendar_summary(now)
    parts.append("Here is your day:\n" + schedule if schedule else "You have a calm, open day ahead.")
    return {"briefing": "\n\n".join(parts)}
