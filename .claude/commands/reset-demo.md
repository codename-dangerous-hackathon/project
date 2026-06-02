---
description: Reset local data stores to a clean, known demo state (DESTRUCTIVE — backs up first)
allowed-tools: Bash, Read
---

Reset Belong's on-device data to a clean demo state so a fresh walkthrough or test run starts from known facts. This is **destructive** to local patient data, so be careful and confirm before wiping.

Steps:
1. **Back up first.** Tar the live stores to `~/belong-data-backup-<index>.tar.gz`: `src/backend/database/data/`, `src/backend/data/`, `src/backend/keys/`. Confirm the tarball exists and report its size before deleting anything. (The VAPID private key lives in `keys/` and is painful to regenerate — never lose it.)
2. Show me what's currently there (`GET /journal`, `GET /events`, `GET /profile` if the backend is up, or list the files) and **ask me to confirm** before wiping.
3. On confirmation, reset to a clean demo seed. Prefer the existing helper `scripts/clean_test_data.py` if it fits; otherwise clear the Chroma collections (people / face_embeddings / life_story_memories) and reset the JSON stores, then seed a small, consistent demo family + a couple of meds/appointments + a patient profile so the companion has real facts to ground on.
4. Leave `keys/vapid_private.pem` untouched.
5. Report the final clean state (counts of people / memories / events) so I know the seed took.
