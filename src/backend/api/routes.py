from fastapi import APIRouter, HTTPException, UploadFile, File
from fastapi.responses import Response
from pydantic import BaseModel
from typing import List, Optional
from agents.companion import ask_companion
from database.chroma_manager import vdb
from tools.audio import transcribe_audio_local, synthesize_speech_local
import uuid

router = APIRouter()

class AskRequest(BaseModel):
    user_input: str

class EnrollMemoryRequest(BaseModel):
    text: str
    date: Optional[str] = None
    tags: Optional[str] = None

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

@router.post("/identify")
async def identify_person(request: IdentifyRequest):
    """
    Match camera frame to enrolled embeddings in Vector DB.
    """
    try:
        # MOCK PIPELINE: In reality, we'd pass image_base64 to a local InsightFace model here to get `embedding_query`
        # embedding_query = local_vision_model.extract(request.image_base64)
        mock_embedding = [0.1, 0.2, 0.3] # Placeholder

        # Here we query the ChromaDB
        results = vdb.recognize_face(embedding_query=mock_embedding)
        
        # MOCK RETURN: Let's assume we matched someone to test the UI flow
        return {"match": True, "name": "Sarah", "relationship": "daughter"}
        
        # Real logic would trigger:
        # if results['distances'] and len(results['distances'][0]) > 0:
        #     if results['distances'][0][0] < 0.5: 
        #         meta = results['metadatas'][0][0]
        #         return {"match": True, "name": meta.get("name"), "relationship": meta.get("relationship")}
        # return {"match": False, "message": "Unknown face"}
        
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
