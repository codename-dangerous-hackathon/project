"""
One-off cleanup: remove test/junk data, keep the real family + Leo notes, and
migrate the real orphan face enrollments into proper person profiles so they
appear in the new Family Members UI.

Run with the backend STOPPED (avoids concurrent ChromaDB access):
    venv/bin/python scripts/clean_test_data.py
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src", "backend"))
from database.chroma_manager import vdb  # noqa: E402

# Names that are test junk (faces + people)
JUNK_NAMES = {"grace", "test", "sarah", "tom"}
# Real family to KEEP (and migrate into person profiles)
KEEP_FACE_NAMES = {"farida noori", "jeremy", "rob", "lebna"}
# Memory text prefixes that are test/seed junk
JUNK_MEMORY_PREFIXES = (
    "helen grew up in scarborough",
    "api smoke-test memory",
    "my daughter sarah works as an architect",
)


def main():
    print("BEFORE:", vdb.people_collection.count(), "people,",
          vdb.face_collection.count(), "faces,",
          vdb.memory_collection.count(), "memories")

    # 1) Delete junk people (cascades to their person-memories).
    for p in vdb.list_people():
        if p["name"].strip().lower() in JUNK_NAMES:
            vdb.delete_person(p["id"])
            print("  deleted person:", p["name"])

    # 2) Delete junk faces; collect real ones to migrate.
    fres = vdb.face_collection.get(include=["metadatas"])
    junk_face_ids, keep_faces = [], []
    for fid, meta in zip(fres.get("ids", []), fres.get("metadatas", [])):
        name = (meta or {}).get("name", "").strip()
        if name.lower() in JUNK_NAMES:
            junk_face_ids.append(fid)
        elif name.lower() in KEEP_FACE_NAMES:
            keep_faces.append((fid, meta))
    if junk_face_ids:
        vdb.face_collection.delete(ids=junk_face_ids)
        print(f"  deleted {len(junk_face_ids)} junk faces")

    # 3) Delete junk memories by text prefix.
    mres = vdb.memory_collection.get(include=["documents"])
    junk_mem_ids = []
    for mid, doc in zip(mres.get("ids", []), mres.get("documents", [])):
        d = (doc or "").strip().lower()
        if any(d.startswith(pfx) for pfx in JUNK_MEMORY_PREFIXES):
            junk_mem_ids.append(mid)
    if junk_mem_ids:
        vdb.memory_collection.delete(ids=junk_mem_ids)
        print(f"  deleted {len(junk_mem_ids)} junk memories")

    # 4) Migrate real orphan faces -> person profiles (id == face id == person_id).
    for fid, meta in keep_faces:
        name = (meta or {}).get("name", "")
        rel = (meta or {}).get("relationship", "")
        vdb.add_person(fid, name, rel, has_photo=True)
        print(f"  migrated face -> profile: {name} / {rel}")

    print("AFTER :", vdb.people_collection.count(), "people,",
          vdb.face_collection.count(), "faces,",
          vdb.memory_collection.count(), "memories")
    print("\nRemaining people:")
    for p in vdb.list_people():
        print(f"  - {p['name']} / {p['relationship']} (photo={p['has_photo']}, facts={p['memory_count']})")
    print("Remaining memories:")
    for m in vdb.list_memories():
        print("  -", m["text"][:70])


if __name__ == "__main__":
    main()
