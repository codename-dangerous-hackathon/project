"""
On-device speech for Anchor — fully offline.

  STT: faster-whisper (CTranslate2)  — patient speech -> text
  TTS: Piper (ONNX)                  — companion text  -> warm audio

Both models are loaded once as lazy singletons (loading takes a few seconds, so
we never want to do it per request).
"""

import io
import os
import threading
import wave

_BASE = os.path.dirname(os.path.dirname(__file__))  # src/backend
PIPER_VOICE_PATH = os.getenv(
    "PIPER_VOICE", os.path.join(_BASE, "models", "piper", "en_US-amy-medium.onnx")
)
WHISPER_MODEL_NAME = os.getenv("WHISPER_MODEL", "base.en")

_whisper = None
_whisper_lock = threading.Lock()
_piper = None
_piper_lock = threading.Lock()


def _get_whisper():
    global _whisper
    if _whisper is None:
        with _whisper_lock:
            if _whisper is None:
                from faster_whisper import WhisperModel

                _whisper = WhisperModel(
                    WHISPER_MODEL_NAME, device="cpu", compute_type="int8"
                )
    return _whisper


def _get_piper():
    global _piper
    if _piper is None:
        with _piper_lock:
            if _piper is None:
                from piper import PiperVoice

                _piper = PiperVoice.load(PIPER_VOICE_PATH)
    return _piper


def warmup() -> None:
    """Pre-load both models so the first user request isn't slow."""
    _get_whisper()
    _get_piper()


def transcribe_audio_local(audio_bytes: bytes) -> str:
    """
    Transcribe patient speech. Accepts any container faster-whisper/PyAV can
    decode (webm/opus from the browser, wav, mp4, ...).
    """
    if not audio_bytes:
        return ""
    model = _get_whisper()
    segments, _info = model.transcribe(
        io.BytesIO(audio_bytes), beam_size=1, language="en"
    )
    return " ".join(seg.text for seg in segments).strip()


def synthesize_speech_local(text: str) -> bytes:
    """Convert companion text into a warm WAV using the local Piper voice."""
    voice = _get_piper()
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        voice.synthesize_wav(text or " ", wf)
    return buf.getvalue()
