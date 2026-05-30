from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from agents.companion import ask_companion

router = APIRouter()

class AskRequest(BaseModel):
    user_input: str

class EnrollRequest(BaseModel):
    name: str
    relationship: str
    # Usually you'd accept an image/file here for the embedding

@router.post("/ask")
async def ask_endpoint(request: AskRequest):
    """
    Open Companion Q&A (the infinite-patience loop).
    Passes the input to the NemoClaw Companion Agent.
    """
    try:
        reply = ask_companion(request.user_input)
        return {"reply": reply}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/identify")
async def identify_person():
    """
    Match camera frame to enrolled embeddings (Vision Agent).
    """
    # TODO: Connect to Vision agent / Vector DB
    return {"name": "Sarah", "relationship": "daughter"}

@router.get("/briefing")
async def get_daily_briefing():
    """
    Gentle morning audio summary logic here.
    """
    # TODO: Connect to Memory Agent
    return {"briefing": "Today you see Dr. Lee at 2. Sarah is coming over at 5."}

@router.post("/enroll")
async def enroll_person(request: EnrollRequest):
    """
    Add a person (photo -> embedding) to the VectorDB.
    """
    # TODO: Generate embedding and store in DB
    return {"status": "success", "enrolled": request.name}
