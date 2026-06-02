"""
On-device speech for Belong — fully offline, multilingual.

  STT: faster-whisper (multilingual) — auto-detects the spoken language.
  TTS: Piper — one voice per language; we pick the voice from the text's
       detected language so the companion speaks back in the same tongue.

Models load lazily as singletons (per language for TTS).
"""

import io
import os
import threading
import wave

from langdetect import DetectorFactory, detect

DetectorFactory.seed = 0  # make language detection deterministic

_BASE = os.path.dirname(os.path.dirname(__file__))  # src/backend
_VOICE_DIR = os.path.join(_BASE, "models", "piper")
# Multilingual model so we can auto-detect French/Spanish/etc. (NOT base.en).
WHISPER_MODEL_NAME = os.getenv("WHISPER_MODEL", "base")

# language code -> Piper voice file
PIPER_VOICES = {
    "en": "en_US-amy-medium.onnx",
    "fr": "fr_FR-siwis-medium.onnx",
    "es": "es_ES-davefx-medium.onnx",
}
DEFAULT_LANG = "en"

_whisper = None
_whisper_lock = threading.Lock()
_piper = {}                # lang -> PiperVoice
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


def _get_piper(lang: str):
    lang = lang if lang in PIPER_VOICES else DEFAULT_LANG
    if lang not in _piper:
        with _piper_lock:
            if lang not in _piper:
                from piper import PiperVoice

                _piper[lang] = PiperVoice.load(os.path.join(_VOICE_DIR, PIPER_VOICES[lang]))
    return _piper[lang]


def warmup() -> None:
    """Pre-load the STT model and the default voice so the first turn is fast."""
    _get_whisper()
    _get_piper(DEFAULT_LANG)


def warmed() -> bool:
    """Whether the STT model is loaded (for /health)."""
    return _whisper is not None


def transcribe_audio_local(audio_bytes: bytes) -> str:
    """
    Transcribe patient speech in whatever language they spoke (auto-detected).
    Keeps the original language (task='transcribe', not 'translate').
    """
    if not audio_bytes:
        return ""
    model = _get_whisper()
    segments, _info = model.transcribe(io.BytesIO(audio_bytes), beam_size=1)
    return " ".join(seg.text for seg in segments).strip()


def _detect_lang(text: str) -> str:
    try:
        code = detect(text)
        return code if code in PIPER_VOICES else DEFAULT_LANG
    except Exception:
        return DEFAULT_LANG


def synthesize_speech_local(text: str) -> bytes:
    """Speak the text using the Piper voice matching its detected language."""
    voice = _get_piper(_detect_lang(text or " "))
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        voice.synthesize_wav(text or " ", wf)
    return buf.getvalue()
