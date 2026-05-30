from fastapi import APIRouter, HTTPException, UploadFile, File
from fastapi.responses import Response
from pydantic import BaseModel
from typing import List, Optional
from agents.companion import ask_companion
from database.chroma_manager import vdb
from tools.audio import transcribe_audio_local, synthesize_speech_local
from tools.vision import extract_face_embedding_from_base64
import uuid

router = APIRouter()

# Minimum cosine similarity (1 - Chroma cosine distance) to count as the same
# person. buffalo_l/ArcFace gives ~0.5+ for the same face and <0.2 for
# different faces, so 0.35 is a comfortable, conservative cut.
FACE_MATCH_THRESHOLD = 0.35

class AskRequest(BaseModel):
    user_input: str

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

@router.post("/ask")
async def ask_endpoint(request: AskRequest):
    """
    Open Companion Q&A (the infinite-patience loop).
    Passes the input to the NemoClaw/Nemotron Companion Agent.
    """
    try:
        reply = ask_companion(request.user_input)
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

        if distances[0]:
            # Chroma cosine distance = 1 - cosine similarity.
            similarity = 1.0 - distances[0][0]
            if similarity >= FACE_MATCH_THRESHOLD:
                meta = metadatas[0][0]
                return {
                    "match": True,
                    "name": meta.get("name"),
                    "relationship": meta.get("relationship"),
                    "confidence": round(similarity, 3),
                }

        return {"match": False, "message": "I don't recognize this person yet."}
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
