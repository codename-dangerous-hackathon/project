import chromadb
from chromadb.config import Settings
import os

# Create a local persistent ChromaDB client
# The database will be stored inside the database/data folder
DB_DIR = os.path.join(os.path.dirname(__file__), "data")
os.makedirs(DB_DIR, exist_ok=True)

class AnchorVectorDB:
    def __init__(self):
        # We use a persistent client so data survives restarts (completely offline)
        self.client = chromadb.PersistentClient(path=DB_DIR)
        
        # 1. Life Story & Memory Collection
        # For text RAG: journals, routines, core facts
        self.memory_collection = self.client.get_or_create_collection(
            name="life_story_memories",
            metadata={"hnsw:space": "cosine"}
        )
        
        # 2. Face Embeddings Collection
        # For Vision (Who is this?) - Stores InsightFace vectors
        self.face_collection = self.client.get_or_create_collection(
            name="face_embeddings",
            metadata={"hnsw:space": "cosine"}
        )

    def add_memory(self, memory_id: str, text: str, metadata: dict):
        """Add a factual memory or journal entry to the vector store."""
        self.memory_collection.add(
            documents=[text],
            metadatas=[metadata],
            ids=[memory_id]
        )

    def query_memories(self, query_text: str, n_results: int = 3):
        """Query for related life events or facts to provide context to NemoClaw."""
        results = self.memory_collection.query(
            query_texts=[query_text],
            n_results=n_results
        )
        return results

    def add_face_embedding(self, person_id: str, embedding: list, metadata: dict):
        """Store a parsed face embedding directly."""
        self.face_collection.add(
            embeddings=[embedding],
            metadatas=[metadata],
            ids=[person_id]
        )

    def recognize_face(self, embedding_query: list, n_results: int = 1):
        """Match a live camera embedding against enrolled faces."""
        results = self.face_collection.query(
            query_embeddings=[embedding_query],
            n_results=n_results
        )
        return results

# Singleton instance to be used by agents and API
vdb = AnchorVectorDB()
