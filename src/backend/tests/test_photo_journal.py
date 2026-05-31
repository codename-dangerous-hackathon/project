"""
Photo Memory Journal: a photo memory = a general memory (text = caption) + an
on-device thumbnail keyed by the memory id. PHOTO_DIR is isolated to tmp by
conftest, so these never touch the real data/photos/.
"""
from fastapi.testclient import TestClient

import main

# A minimal 1x1 PNG (decodable by PIL -> save_photo).
PNG_1x1 = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/1eaAAAAAElFTkSuQmCC"
)


def _client():
    return TestClient(main.app)


def test_photo_memory_round_trip_and_cleanup():
    with _client() as c:
        assert c.get("/photo-journal").json() == {"photos": []}

        r = c.post("/memories/photo", json={"text": "Grandkids at the lake", "image_base64": PNG_1x1})
        assert r.status_code == 200
        mid = r.json()["memory_id"]

        journal = c.get("/photo-journal").json()["photos"]
        assert journal == [{"id": mid, "caption": "Grandkids at the lake"}]

        photo = c.get(f"/memories/{mid}/photo")
        assert photo.status_code == 200
        assert photo.headers["content-type"] == "image/jpeg"
        assert len(photo.content) > 100  # a real (downscaled) JPEG

        # delete the memory -> photo + journal entry both gone
        assert c.delete(f"/memories/{mid}").status_code == 200
        assert c.get(f"/memories/{mid}/photo").status_code == 404
        assert c.get("/photo-journal").json() == {"photos": []}


def test_photo_memory_validation():
    with _client() as c:
        assert c.post("/memories/photo", json={"text": "", "image_base64": PNG_1x1}).status_code == 400
        r = c.post("/memories/photo", json={"text": "no image", "image_base64": "not-base64-image!!"})
        assert r.status_code == 400
        # the rolled-back memory must not linger
        assert c.get("/photo-journal").json() == {"photos": []}
        assert all(m["text"] != "no image" for m in c.get("/memories").json()["memories"])
