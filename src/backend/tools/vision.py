"""
On-device face recognition for Belong.

Uses InsightFace (buffalo_l: RetinaFace detector + ArcFace recognition) to turn
a photo into a 512-d normalized face embedding. Everything runs locally on the
box — no image ever leaves the device, and we store embeddings only (never the
original photo), matching the privacy spec.
"""

import base64
import io
import threading
from typing import List, Optional

import cv2
import numpy as np
from PIL import Image, ImageOps

# Lazily-initialized singleton — loading the model takes a few seconds and a few
# hundred MB, so we do it once on first use rather than at import time.
_app = None
_lock = threading.Lock()


def _get_app():
    global _app
    if _app is None:
        with _lock:
            if _app is None:
                from insightface.app import FaceAnalysis

                app = FaceAnalysis(
                    name="buffalo_l", providers=["CPUExecutionProvider"]
                )
                app.prepare(ctx_id=0, det_size=(640, 640))
                _app = app
    return _app


def warmup() -> None:
    """Pre-load the face model so the first enroll/identify isn't slow."""
    _get_app()


def _decode_image(image_bytes: bytes):
    # Decode via PIL so we honour the phone's EXIF rotation (a sideways face
    # won't be detected otherwise), then convert to the BGR array OpenCV expects.
    try:
        img = Image.open(io.BytesIO(image_bytes))
        img = ImageOps.exif_transpose(img).convert("RGB")
        return cv2.cvtColor(np.array(img), cv2.COLOR_RGB2BGR)
    except Exception:
        arr = np.frombuffer(image_bytes, dtype=np.uint8)
        return cv2.imdecode(arr, cv2.IMREAD_COLOR)  # fallback


def extract_face_embedding(image_bytes: bytes) -> Optional[List[float]]:
    """Return the normalized embedding of the largest face, or None if none found."""
    img = _decode_image(image_bytes)
    if img is None:
        return None
    faces = _get_app().get(img)
    if not faces:
        return None
    # Pick the most prominent face (largest bounding box).
    faces.sort(
        key=lambda f: (f.bbox[2] - f.bbox[0]) * (f.bbox[3] - f.bbox[1]),
        reverse=True,
    )
    return faces[0].normed_embedding.astype(float).tolist()


def extract_face_embedding_from_base64(b64: str) -> Optional[List[float]]:
    """Accepts a raw base64 string or a full data: URL."""
    if not b64:
        return None
    if "," in b64:
        b64 = b64.split(",", 1)[1]
    try:
        raw = base64.b64decode(b64)
    except Exception:
        return None
    return extract_face_embedding(raw)
