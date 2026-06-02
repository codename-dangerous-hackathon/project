import chromadb
from chromadb.config import Settings
import os

# Create a local persistent ChromaDB client
# The database will be stored inside the database/data folder
DB_DIR = os.path.join(os.path.dirname(__file__), "data")
os.makedirs(DB_DIR, exist_ok=True)

class BelongVectorDB:
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
        # For Vision (Who is this?) - Stores InsightFace vectors, id == person_id
        self.face_collection = self.client.get_or_create_collection(
            name="face_embeddings",
            metadata={"hnsw:space": "cosine"}
        )

        # 3. People registry — one record per family member (photo optional).
        # Memories about a person are linked back here via metadata.person_id.
        self.people_collection = self.client.get_or_create_collection(
            name="people",
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

    def list_memories(self):
        """Return every stored life-story memory (for the caregiver to review)."""
        res = self.memory_collection.get(include=["documents", "metadatas"])
        ids = res.get("ids", []) or []
        docs = res.get("documents", []) or []
        metas = res.get("metadatas", []) or []
        out = []
        for i, mem_id in enumerate(ids):
            meta = metas[i] or {}
            out.append({
                "id": mem_id,
                "text": docs[i] if i < len(docs) else "",
                "date": meta.get("date", ""),
                "tags": meta.get("tags", ""),
            })
        return out

    def delete_memory(self, memory_id: str):
        self.memory_collection.delete(ids=[memory_id])

    def list_memories_for_person(self, person_id: str):
        """All facts recorded about one family member."""
        res = self.memory_collection.get(
            where={"person_id": person_id}, include=["documents", "metadatas"]
        )
        ids = res.get("ids", []) or []
        docs = res.get("documents", []) or []
        out = []
        for i, mem_id in enumerate(ids):
            out.append({"id": mem_id, "text": docs[i] if i < len(docs) else ""})
        return out

    def list_general_memories(self):
        """Facts about the patient themselves (not tied to a specific person)."""
        res = self.memory_collection.get(include=["documents", "metadatas"])
        ids = res.get("ids", []) or []
        docs = res.get("documents", []) or []
        metas = res.get("metadatas", []) or []
        out = []
        for i, mem_id in enumerate(ids):
            meta = metas[i] or {}
            if not meta.get("person_id"):  # general / legacy memories
                out.append({"id": mem_id, "text": docs[i] if i < len(docs) else ""})
        return out

    # ----- People (family member profiles) -----

    def add_person(self, person_id: str, name: str, relationship: str, has_photo: bool = False):
        """Create/update a family member record (photo optional)."""
        self.people_collection.upsert(
            documents=[f"{name} {relationship}".strip() or name or relationship or " "],
            metadatas=[{"name": name, "relationship": relationship, "has_photo": has_photo}],
            ids=[person_id],
        )

    def get_person(self, person_id: str):
        res = self.people_collection.get(ids=[person_id], include=["metadatas"])
        ids = res.get("ids", []) or []
        if not ids:
            return None
        meta = (res.get("metadatas", []) or [{}])[0] or {}
        return {
            "id": person_id,
            "name": meta.get("name", ""),
            "relationship": meta.get("relationship", ""),
            "has_photo": bool(meta.get("has_photo", False)),
        }

    def list_people(self):
        res = self.people_collection.get(include=["metadatas"])
        ids = res.get("ids", []) or []
        metas = res.get("metadatas", []) or []
        out = []
        for i, person_id in enumerate(ids):
            meta = metas[i] or {}
            out.append({
                "id": person_id,
                "name": meta.get("name", ""),
                "relationship": meta.get("relationship", ""),
                "has_photo": bool(meta.get("has_photo", False)),
                "memory_count": len(self.list_memories_for_person(person_id)),
            })
        return out

    def set_person_photo(self, person_id: str, embedding: list, name: str, relationship: str):
        """Attach/replace a person's face embedding and mark them as having a photo."""
        self.face_collection.upsert(
            embeddings=[embedding],
            metadatas=[{"name": name, "relationship": relationship, "person_id": person_id}],
            ids=[person_id],
        )
        self.add_person(person_id, name, relationship, has_photo=True)

    def delete_person(self, person_id: str):
        """Remove a person, their face embedding, and all memories about them."""
        self.people_collection.delete(ids=[person_id])
        try:
            self.face_collection.delete(ids=[person_id])
        except Exception:
            pass
        mem = self.memory_collection.get(where={"person_id": person_id})
        mem_ids = mem.get("ids", []) or []
        if mem_ids:
            self.memory_collection.delete(ids=mem_ids)

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

    def list_faces(self):
        """Return every enrolled person (name + relationship, embeddings omitted)."""
        res = self.face_collection.get(include=["metadatas"])
        ids = res.get("ids", []) or []
        metas = res.get("metadatas", []) or []
        out = []
        for i, person_id in enumerate(ids):
            meta = metas[i] or {}
            out.append({
                "id": person_id,
                "name": meta.get("name", ""),
                "relationship": meta.get("relationship", ""),
            })
        return out

    def delete_face(self, person_id: str):
        self.face_collection.delete(ids=[person_id])

# Singleton instance to be used by agents and API
vdb = BelongVectorDB()
