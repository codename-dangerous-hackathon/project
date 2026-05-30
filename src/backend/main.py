from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from api.routes import router

app = FastAPI(
    title="Anchor API",
    description="Backend API for the Anchor Dementia Companion App (NVIDIA GB10 Local)",
    version="1.0.0"
)

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
    return {"status": "ok", "message": "Anchor API is running fully on-device"}

if __name__ == "__main__":
    import uvicorn
    # Bound to localhost only as per security/privacy spec
    uvicorn.run(app, host="127.0.0.1", port=8001)
