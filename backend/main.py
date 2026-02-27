import asyncio
import json
import logging
import os
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Dict, Set

from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from gemini_coach import analyze_audio, analyze_transcript, parse_structured_feedback, transcribe_audio_gemini
from groq_transcribe import transcribe_audio

# Configure logging so all INFO+ messages appear in the uvicorn terminal
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("main")

# Load .env from backend directory (works regardless of cwd)
_backend_dir = Path(__file__).resolve().parent
load_dotenv(_backend_dir / ".env")
# Fallback: .env.example (e.g. if user added key there)
if not os.environ.get("GEMINI_API_KEY"):
    load_dotenv(_backend_dir / ".env.example")

# Log API key status at startup so it's obvious what's configured
_has_gemini = bool(os.environ.get("GEMINI_API_KEY"))
_has_groq   = bool(os.environ.get("GROQ_API_KEY"))
logger.info("API keys loaded — GEMINI_API_KEY: %s | GROQ_API_KEY: %s",
            "YES" if _has_gemini else "MISSING",
            "YES" if _has_groq   else "MISSING")

# Active WebSocket connections per meeting
active_connections: Dict[str, Set[WebSocket]] = {}

# Per-meeting transcript buffers (for analysis every N seconds of speech)
meeting_transcript_buffers: Dict[str, list[str]] = {}

# Throttle Gemini calls to avoid API exhaustion (continuous stream -> many segments)
GEMINI_COOLDOWN_SEC = 15
MIN_TRANSCRIPT_LEN_FOR_GEMINI = 15
last_gemini_at: Dict[str, float] = {}


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield
    active_connections.clear()
    meeting_transcript_buffers.clear()
    last_gemini_at.clear()


app = FastAPI(title="MeetingMirror API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://localhost:3000", "http://localhost:3000"],
    allow_origin_regex=r"^chrome-extension://[a-z]{32}$",
    allow_credentials=True,
)


async def _send_to_meeting(meeting_id: str, payload: dict) -> None:
    """Send a JSON payload to all connected clients for this meeting."""
    if meeting_id in active_connections:
        message = json.dumps(payload)
        for ws in list(active_connections[meeting_id]):
            try:
                await ws.send_text(message)
            except Exception:
                pass


async def _send_transcript(meeting_id: str, transcript: str) -> None:
    """Send just the transcript (what was heard) to the client immediately."""
    await _send_to_meeting(meeting_id, {"heard": transcript})


async def _send_feedback(
    meeting_id: str,
    feedback: str,
    transcript: str | None = None,
    fillers: str | None = None,
) -> None:
    """Send Gemini coaching feedback to all connected clients (structured for single-card UI)."""
    if not feedback:
        return
    structured = parse_structured_feedback(feedback)
    payload: dict = {
        "feedback": feedback,
        "feedbackType": structured["feedback_type"],
        "improved_sentence": structured.get("improved_sentence"),
        "fillers": structured.get("fillers") or fillers,
        "filler_breakdown": structured.get("filler_breakdown"),
        "pace": structured.get("pace"),
        "volume": structured.get("volume"),
        "engagement_alert": structured.get("engagement_alert"),
        "suggestion": structured.get("suggestion"),
        "language_detected": structured.get("language_detected"),
        "non_english_message": structured.get("non_english_message"),
    }
    if transcript:
        payload["transcript"] = transcript
    await _send_to_meeting(meeting_id, payload)


def _parse_fillers_from_feedback(feedback: str) -> str | None:
    """If feedback starts with 'Filler words: ...', return that phrase (e.g. 'um, like')."""
    prefix = "Filler words:"
    if not feedback.strip().lower().startswith(prefix.lower()):
        return None
    first_line = feedback.split("\n")[0].strip()
    if prefix.lower() in first_line.lower():
        rest = first_line[first_line.lower().index(prefix.lower()) + len(prefix) :].strip()
        return rest if rest else None
    return None


def _process_transcript(meeting_id: str, transcript: str) -> tuple[str, str] | None:
    """Analyze transcript with Gemini. Returns (feedback, transcript) or None.
    Respects cooldown and minimum length to avoid API exhaustion.
    """
    t = transcript.strip()
    if not t or len(t) < MIN_TRANSCRIPT_LEN_FOR_GEMINI:
        logger.info("[%s] Gemini coaching SKIPPED — transcript too short (%d chars, need %d)",
                    meeting_id, len(t), MIN_TRANSCRIPT_LEN_FOR_GEMINI)
        return None
    now = time.monotonic()
    if meeting_id in last_gemini_at:
        elapsed = now - last_gemini_at[meeting_id]
        if elapsed < GEMINI_COOLDOWN_SEC:
            logger.info("[%s] Gemini coaching SKIPPED — cooldown (%.1fs remaining)",
                        meeting_id, GEMINI_COOLDOWN_SEC - elapsed)
            return None
    logger.info("[%s] Sending transcript to Gemini for coaching: %r", meeting_id, t[:80])
    result = analyze_transcript(t)
    if result is None:
        logger.warning("[%s] Gemini coaching returned None (API error or key missing)", meeting_id)
        return None
    logger.info("[%s] Gemini coaching response: %r", meeting_id, result[:120])
    last_gemini_at[meeting_id] = now
    return (result, t)


def _process_audio_base64(meeting_id: str, audio_b64: str, mime: str = "audio/webm") -> str | None:
    """Analyze audio with Gemini. Returns feedback or None."""
    return analyze_audio(audio_b64, mime)


@app.websocket("/ws/coaching/{meeting_id}")
async def websocket_coaching(websocket: WebSocket, meeting_id: str):
    await websocket.accept()
    logger.info("[%s] WebSocket connected from %s", meeting_id, websocket.client)

    if meeting_id not in active_connections:
        active_connections[meeting_id] = set()
    active_connections[meeting_id].add(websocket)

    has_gemini = bool(os.environ.get("GEMINI_API_KEY"))
    has_groq = bool(os.environ.get("GROQ_API_KEY"))
    logger.info("[%s] Keys at connect — GEMINI: %s | GROQ: %s",
                meeting_id, "YES" if has_gemini else "NO", "YES" if has_groq else "NO")
    if has_gemini:
        mode = "Groq Whisper + Gemini" if has_groq else "Gemini (transcription + coaching)"
        await _send_feedback(
            meeting_id,
            f"MeetingMirror is listening — speak and tips will appear. ({mode})",
        )
    else:
        await _send_feedback(
            meeting_id,
            "Add GEMINI_API_KEY to backend/.env for real-time AI coaching.",
        )

    if meeting_id not in meeting_transcript_buffers:
        meeting_transcript_buffers[meeting_id] = []

    try:
        while True:
            data = await websocket.receive_text()
            try:
                msg = json.loads(data)
                msg_type = msg.get("type", "")

                if msg_type == "transcript":
                    # Client sends one finalised sentence at a time (Web Speech API onFinal)
                    transcript = msg.get("text", "").strip()
                    if transcript:
                        # Accumulate for session context so Gemini maintains cumulative
                        # filler counts, engagement monitoring, etc. across sentences.
                        meeting_transcript_buffers[meeting_id].append(transcript)
                        full_context = " ".join(meeting_transcript_buffers[meeting_id])
                        # Analyse immediately — cooldown in _process_transcript handles rate limiting
                        try:
                            result = await asyncio.to_thread(
                                _process_transcript, meeting_id, full_context
                            )
                            if result:
                                feedback, _ctx = result
                                fillers = _parse_fillers_from_feedback(feedback)
                                # Surface the current sentence (not full context) as "transcript"
                                await _send_feedback(
                                    meeting_id, feedback, transcript=transcript, fillers=fillers
                                )
                        except Exception:
                            pass

                elif msg_type == "process_transcript":
                    # Client sends full transcript for one-shot processing (e.g. after Stop recording)
                    full_text = msg.get("text", "").strip()
                    if full_text:
                        logger.info("[%s] Process transcript requested (%d chars)", meeting_id, len(full_text))
                        try:
                            res = await asyncio.to_thread(analyze_transcript, full_text)
                            if res:
                                fillers = _parse_fillers_from_feedback(res)
                                await _send_feedback(
                                    meeting_id, res, transcript=full_text, fillers=fillers
                                )
                            else:
                                await _send_feedback(
                                    meeting_id,
                                    "Coaching request failed — check backend logs (e.g. API key or rate limit).",
                                )
                        except Exception as e:
                            logger.exception("[%s] process_transcript failed: %s", meeting_id, e)

                elif msg_type == "audio":
                    audio_b64 = msg.get("data", "")
                    mime = msg.get("mime", "audio/wav")
                    audio_kb = len(audio_b64) * 3 // 4 // 1024  # approx decoded KB
                    logger.info("[%s] Audio segment received — mime=%s size≈%dKB",
                                meeting_id, mime, audio_kb)
                    if audio_b64:
                        # Step 1: try Groq Whisper
                        logger.info("[%s] Trying Groq transcription...", meeting_id)
                        transcript = await asyncio.to_thread(
                            transcribe_audio, audio_b64, mime
                        )
                        if transcript:
                            logger.info("[%s] Groq transcript: %r", meeting_id, transcript[:120])
                        else:
                            logger.info("[%s] Groq returned None — trying Gemini transcription...", meeting_id)
                            transcript = await asyncio.to_thread(
                                transcribe_audio_gemini, audio_b64, mime
                            )
                            if transcript:
                                logger.info("[%s] Gemini transcript: %r", meeting_id, transcript[:120])
                            else:
                                logger.warning("[%s] Both Groq and Gemini transcription returned None", meeting_id)

                        if transcript:
                            await _send_transcript(meeting_id, transcript)
                            result = await asyncio.to_thread(
                                _process_transcript, meeting_id, transcript
                            )
                            if result:
                                feedback, trans = result
                                fillers = _parse_fillers_from_feedback(feedback)
                                await _send_feedback(
                                    meeting_id, feedback, transcript=trans, fillers=fillers
                                )
                        else:
                            await _send_transcript(meeting_id, "[transcription unavailable — check GEMINI_API_KEY in backend/.env]")
            except json.JSONDecodeError:
                pass
    except WebSocketDisconnect:
        pass
    finally:
        if meeting_id in active_connections:
            active_connections[meeting_id].discard(websocket)
            if not active_connections[meeting_id]:
                del active_connections[meeting_id]
        meeting_transcript_buffers.pop(meeting_id, None)


@app.get("/health")
async def health():
    return {"status": "ok"}
