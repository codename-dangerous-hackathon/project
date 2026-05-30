import os
from database.chroma_manager import vdb

# Pseudo-code / NIM API compatibility setup setup
# Assuming standard OpenAI formatting to hit a local NVIDIA NIM endpoint
import requests

NIM_BASE_URL = os.getenv("NIM_BASE_URL", "http://localhost:8000/v1")
COMPANION_MODEL = "nemotron-mini-4b-instruct"

# The Errorless & Validation Therapy System Prompt
SYSTEM_PROMPT = """You are a warm, reassuring companion for someone who experiences memory loss. 
RULES (STRICT):
1. ERRORLESS: Never tell the user they are wrong.
2. NEVER QUIZ: Never say "Do you remember?" or "Don't you remember?".
3. VALIDATION: If the user looks for someone who is not there, validate their feeling warmly. 
4. CONTEXTUAL: Use the provided memory facts to ground your response, but do it naturally like a friend chatting.
5. SHORT: Keep your answers very short (1-3 sentences) so they can be spoken clearly by TTS.
"""

def fetch_revelant_memories(user_query: str) -> str:
    """Retrieve facts from ChromaDB to inject into the LLM context."""
    results = vdb.query_memories(query_text=user_query, n_results=2)
    memories = ""
    if results['documents'] and results['documents'][0]:
        memories = " ".join(results['documents'][0])
    return memories

def ask_companion(user_input: str) -> str:
    """
    Main entry point for the infinite-patience conversational loop.
    Fetches RAG context, constructs the prompt, and hits the local NIM.
    """
    # 1. Get context from ChromaDB
    rag_context = fetch_revelant_memories(user_input)
    
    # 2. Build the enhanced prompt
    context_injection = f"Here is some background context about the user's life: {rag_context}\n\n" if rag_context else ""
    messages = [
        {"role": "system", "content": SYSTEM_PROMPT + context_injection},
        {"role": "user", "content": user_input}
    ]

    try:
        # 3. Call the Local NIM Model
        response = requests.post(
            f"{NIM_BASE_URL}/chat/completions",
            json={
                "model": COMPANION_MODEL,
                "messages": messages,
                "max_tokens": 150,
                "temperature": 0.3
            },
            timeout=5
        )
        response.raise_for_status()
        reply = response.json()
        return reply["choices"][0]["message"]["content"]
    except Exception as e:
        # Fallback mechanism if the model is unreachable during development
        print(f"NIM Error: {e}")
        return "I hear you, my friend. Let's take a look at the garden together."
