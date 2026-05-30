import threading

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from api.routes import router

app = FastAPI(
    title="Belong API",
    description="Backend API for the Belong Dementia Companion App (NVIDIA GB10 Local)",
    version="1.0.0"
)


@app.on_event("startup")
def _preload_models() -> None:
    """Warm the speech + face models in the background so the first patient
    interaction is fast (loading Whisper/Piper/InsightFace takes a few seconds)."""
    def _bg():
        try:
            from tools.audio import warmup as audio_warmup
            from tools.vision import warmup as vision_warmup
            audio_warmup()
            vision_warmup()
            print("Models warmed up (Whisper + Piper + InsightFace).")
        except Exception as e:
            print(f"Model warmup error: {e}")

    threading.Thread(target=_bg, daemon=True).start()

    # Start the reminder scheduler (sends Web Push when events are due).
    try:
        from services.reminders import start_scheduler
        start_scheduler()
    except Exception as e:
        print(f"Reminder scheduler failed to start: {e}")

# Allow local frontend to communicate with local backend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include the endpoints from our routes.py
app.include_router(router)

@app.get("/")
async def root():
    return {"status": "ok", "message": "Belong API is running fully on-device"}

if __name__ == "__main__":
    import uvicorn
    # Bound to localhost only as per security/privacy spec
    uvicorn.run(app, host="127.0.0.1", port=8001)
