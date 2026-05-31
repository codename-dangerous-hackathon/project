"""
Small on-device thumbnails of family members, so the patient can SEE their
faces on the "About Me" screen (not just recognize them by camera).

Stored as downscaled JPEGs in data/photos/<person_id>.jpg — local only, never
leaves the box. Separate from the face embedding (which stays in ChromaDB).
"""

import base64
import io
import os

from PIL import Image, ImageOps

_BASE = os.path.dirname(os.path.dirname(__file__))  # src/backend
PHOTO_DIR = os.path.join(_BASE, "data", "photos")
os.makedirs(PHOTO_DIR, exist_ok=True)

_MAX = 320  # longest side, px


def _path(person_id: str) -> str:
    return os.path.join(PHOTO_DIR, f"{person_id}.jpg")


def save_photo(person_id: str, image_base64: str) -> bool:
    """Decode a base64 (data URL or raw), downscale, and store as JPEG."""
    if not image_base64:
        return False
    if "," in image_base64:
        image_base64 = image_base64.split(",", 1)[1]
    try:
        raw = base64.b64decode(image_base64)
        img = Image.open(io.BytesIO(raw))
        img = ImageOps.exif_transpose(img)  # honour the phone's rotation tag
        img = img.convert("RGB")
        img.thumbnail((_MAX, _MAX))
        img.save(_path(person_id), "JPEG", quality=85)
        return True
    except Exception as e:
        print(f"save_photo failed for {person_id}: {e}")
        return False


def photo_path(person_id: str):
    p = _path(person_id)
    return p if os.path.isfile(p) else None


def delete_photo(person_id: str) -> None:
    p = _path(person_id)
    if os.path.isfile(p):
        try:
            os.remove(p)
        except OSError:
            pass
