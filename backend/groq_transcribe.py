"""
Groq Whisper transcription for speech-to-text.
Uses the same approach as swift-ai-voice-assistant:
https://github.com/Sirisha-428/swift-ai-voice-assistant
"""
import base64
import io
import logging
import os
from typing import Optional

try:
    from groq import Groq
    GROQ_AVAILABLE = True
except ImportError:
    GROQ_AVAILABLE = False

logger = logging.getLogger(__name__)

# Whisper model - whisper-large-v3-turbo is faster, whisper-large-v3 is more accurate
WHISPER_MODEL = "whisper-large-v3-turbo"


def _get_client() -> Optional["Groq"]:
    if not GROQ_AVAILABLE:
        return None
    api_key = os.environ.get("GROQ_API_KEY")
    if not api_key:
        return None
    return Groq(api_key=api_key)


def transcribe_audio(audio_base64: str, mime_type: str = "audio/wav") -> Optional[str]:
    """
    Transcribe audio using Groq Whisper. Returns transcript text or None.
    """
    if not GROQ_AVAILABLE:
        logger.warning("groq package not installed — run: pip install groq")
        return None

    client = _get_client()
    if not client:
        logger.warning("Groq skipped: GROQ_API_KEY not set in .env")
        return None

    try:
        audio_bytes = base64.b64decode(audio_base64)
        audio_size_kb = len(audio_bytes) // 1024
        ext = "wav" if "wav" in mime_type else "webm"
        logger.info("Groq: sending %dKB %s to Whisper (%s)...", audio_size_kb, ext, WHISPER_MODEL)
        file_obj = io.BytesIO(audio_bytes)
        transcription = client.audio.transcriptions.create(
            file=(f"audio.{ext}", file_obj),
            model=WHISPER_MODEL,
        )
        text = (transcription.text or "").strip()
        if text:
            logger.info("Groq: transcription success → %r", text[:120])
        else:
            logger.info("Groq: transcription returned empty text (silent audio?)")
        return text if text else None
    except Exception as e:
        logger.warning("Groq transcription failed: %s", e)
        return None
