import asyncio
import json
import logging
import os
from collections import Counter
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, Dict, Set

from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from gemini_coach import (
    analyze_transcript,
    build_suggested_alternatives,
    insights_to_toast_messages,
    parse_coaching_response,
    transcribe_audio_gemini,
)
from groq_transcribe import transcribe_audio

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("main")

_backend_dir = Path(__file__).resolve().parent
load_dotenv(_backend_dir / ".env")
if not os.environ.get("GEMINI_API_KEY"):
    load_dotenv(_backend_dir / ".env.example")

_has_gemini = bool(os.environ.get("GEMINI_API_KEY"))
_has_groq = bool(os.environ.get("GROQ_API_KEY"))
logger.info(
    "API keys loaded — GEMINI_API_KEY: %s | GROQ_API_KEY: %s",
    "YES" if _has_gemini else "MISSING",
    "YES" if _has_groq else "MISSING",
)

active_connections: Dict[str, Set[WebSocket]] = {}

# Internal transcript buffers only (never sent to clients)
meeting_transcript_buffers: Dict[str, list[str]] = {}

coaching_queue: Dict[str, list[str]] = {}
coaching_tasks: Dict[str, "asyncio.Task[None]"] = {}

# Per-meeting rolling stats for end-of-session summary
meeting_session_stats: Dict[str, dict[str, Any]] = {}

MIN_SENTENCE_LEN_FOR_QUEUE = 5
MIN_TRANSCRIPT_LEN_FOR_GEMINI = 1


def _ensure_session_stats(meeting_id: str) -> dict[str, Any]:
    if meeting_id not in meeting_session_stats:
        meeting_session_stats[meeting_id] = {
            "filler_total": 0,
            "filler_word_counts": Counter(),
            "pace_counts": Counter(),
            "volume_counts": Counter(),
            "clarity_counts": Counter(),
            "improvement_tips": [],
            "tips_seen": set(),
        }
    return meeting_session_stats[meeting_id]


def _accumulate_insights(meeting_id: str, insights: dict[str, Any]) -> None:
    st = _ensure_session_stats(meeting_id)
    fillers = insights.get("fillerWordsDetected") or []
    if isinstance(fillers, list):
        st["filler_total"] += len(fillers)
        for w in fillers:
            if isinstance(w, str) and w.strip():
                st["filler_word_counts"][w.strip().lower()] += 1

    pace = insights.get("pace")
    if pace in ("fast", "slow", "good"):
        st["pace_counts"][pace] += 1

    volume = insights.get("volume")
    if volume in ("low", "high", "good"):
        st["volume_counts"][volume] += 1

    clarity = insights.get("clarity")
    if clarity in ("poor", "good"):
        st["clarity_counts"][clarity] += 1

    for tip in insights.get("suggestions") or []:
        if not isinstance(tip, str) or not tip.strip():
            continue
        key = tip.strip().lower()
        if key not in st["tips_seen"]:
            st["tips_seen"].add(key)
            st["improvement_tips"].append(tip.strip()[:200])


def _pace_dominant_threshold(c: Counter) -> float:
    t = sum(c.values())
    return max(2.0, t * 0.35)


def _build_meeting_summary(meeting_id: str) -> dict[str, Any]:
    st = meeting_session_stats.get(meeting_id) or _ensure_session_stats(meeting_id)
    fc = st["filler_word_counts"]
    most_used = [w for w, _ in fc.most_common(5)] if fc else []

    pc = st["pace_counts"]
    fast, slow, good_p = pc.get("fast", 0), pc.get("slow", 0), pc.get("good", 0)
    thr = _pace_dominant_threshold(pc)
    if fast == 0 and slow == 0 and good_p == 0:
        speaking_pace = "good"
    elif fast >= thr and fast > slow:
        speaking_pace = "too fast"
    elif slow >= thr and slow > fast:
        speaking_pace = "too slow"
    else:
        speaking_pace = "good"

    vc = st["volume_counts"]
    low_n, good_v = vc.get("low", 0), vc.get("good", 0)
    high_n = vc.get("high", 0)
    volume_analysis = "low" if low_n > good_v + high_n else "good"

    cc = st["clarity_counts"]
    poor_n, good_c = cc.get("poor", 0), cc.get("good", 0)
    if poor_n + good_c == 0:
        clarity_score = 85
    else:
        clarity_score = int(round(100 * good_c / (poor_n + good_c)))

    improvements: list[str] = []
    if st["filler_total"] > 0:
        improvements.append("Reduce filler words")
    if speaking_pace == "too fast":
        improvements.append("Slow down speaking pace")
    elif speaking_pace == "too slow":
        improvements.append("Speak with a slightly quicker, steadier pace")
    if volume_analysis == "low":
        improvements.append("Increase microphone volume or speak louder")
    if poor_n > good_c and poor_n > 0:
        improvements.append("Use clearer, more structured sentences")
    improvements.extend(st["improvement_tips"][:5])
    # Dedupe improvements
    seen_i: set[str] = set()
    dedup_imp: list[str] = []
    for x in improvements:
        k = x.lower()
        if k in seen_i:
            continue
        seen_i.add(k)
        dedup_imp.append(x)

    suggested_alts = build_suggested_alternatives(most_used)

    return {
        "totalFillerWords": int(st["filler_total"]),
        "mostUsedFillerWords": most_used,
        "speakingPace": speaking_pace,
        "volumeAnalysis": volume_analysis,
        "clarityScore": clarity_score,
        "improvements": dedup_imp[:12],
        "suggestedAlternatives": suggested_alts,
    }


def _reset_session_stats(meeting_id: str) -> None:
    meeting_session_stats.pop(meeting_id, None)


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield
    active_connections.clear()
    meeting_transcript_buffers.clear()
    coaching_queue.clear()
    meeting_session_stats.clear()
    for task in coaching_tasks.values():
        task.cancel()
    coaching_tasks.clear()


app = FastAPI(title="MeetingMirror API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://localhost:3000", "http://localhost:3000"],
    allow_origin_regex=r"^chrome-extension://[a-z]{32}$",
    allow_credentials=True,
)


async def _send_to_meeting(meeting_id: str, payload: dict) -> None:
    if meeting_id in active_connections:
        message = json.dumps(payload)
        for ws in list(active_connections[meeting_id]):
            try:
                await ws.send_text(message)
            except Exception:
                pass


def filter_coaching_payload(
    insights: dict[str, Any],
    toast_messages: list[str],
    *,
    kind: str = "coaching",
) -> dict[str, Any]:
    """
    Client-safe payload: structured insights + toast lines only.
    Never includes transcript, improved sentences, or raw model blobs.
    """
    return {
        "type": kind,
        "insights": {
            "fillerWordsDetected": list(insights.get("fillerWordsDetected") or []),
            "pace": insights.get("pace"),
            "volume": insights.get("volume"),
            "clarity": insights.get("clarity"),
            "suggestions": list(insights.get("suggestions") or []),
        },
        "toastMessages": list(toast_messages),
    }


async def _send_coaching_insights(meeting_id: str, insights: dict[str, Any]) -> None:
    _accumulate_insights(meeting_id, insights)
    toasts = insights_to_toast_messages(insights)
    if not toasts:
        return
    payload = filter_coaching_payload(insights, toasts, kind="coaching")
    await _send_to_meeting(meeting_id, payload)


async def _send_welcome_toasts(meeting_id: str, lines: list[str]) -> None:
    """Non-Gemini system messages as coaching-shaped payloads (no stats accumulation)."""
    empty_insights = {
        "fillerWordsDetected": [],
        "pace": "good",
        "volume": "good",
        "clarity": "good",
        "suggestions": [],
    }
    payload = {
        "type": "coaching",
        "insights": empty_insights,
        "toastMessages": lines,
        "system": True,
    }
    await _send_to_meeting(meeting_id, payload)


def _process_transcript_sync(meeting_id: str, transcript: str) -> dict[str, Any] | None:
    t = transcript.strip()
    if not t or len(t) < MIN_TRANSCRIPT_LEN_FOR_GEMINI:
        return None
    logger.info("[%s] Gemini coaching (internal transcript, not sent to clients)", meeting_id)
    raw = analyze_transcript(t)
    insights = parse_coaching_response(raw)
    if not insights:
        return None
    return insights


async def _process_coaching_queue(meeting_id: str) -> None:
    queue = coaching_queue.get(meeting_id)
    if not queue:
        return
    while queue:
        sentence = queue.pop(0)
        if not sentence or not sentence.strip():
            continue
        try:
            insights = await asyncio.to_thread(_process_transcript_sync, meeting_id, sentence)
            if insights:
                await _send_coaching_insights(meeting_id, insights)
        except asyncio.CancelledError:
            raise
        except Exception as e:
            logger.exception("[%s] Coaching queue processing failed: %s", meeting_id, e)
    coaching_tasks.pop(meeting_id, None)


@app.websocket("/ws/coaching/{meeting_id}")
async def websocket_coaching(websocket: WebSocket, meeting_id: str):
    await websocket.accept()
    logger.info("[%s] WebSocket connected from %s", meeting_id, websocket.client)

    if meeting_id not in active_connections:
        active_connections[meeting_id] = set()
    active_connections[meeting_id].add(websocket)

    has_gemini = bool(os.environ.get("GEMINI_API_KEY"))
    has_groq = bool(os.environ.get("GROQ_API_KEY"))
    logger.info(
        "[%s] Keys at connect — GEMINI: %s | GROQ: %s",
        meeting_id,
        "YES" if has_gemini else "NO",
        "YES" if has_groq else "NO",
    )
    _ensure_session_stats(meeting_id)

    if has_gemini:
        await _send_welcome_toasts(
            meeting_id,
            ["MeetingMirror is listening — coaching tips will appear on Meet."],
        )
    else:
        await _send_welcome_toasts(
            meeting_id,
            ["Add GEMINI_API_KEY to backend/.env for real-time coaching."],
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
                    transcript = msg.get("text", "").strip()
                    if not transcript:
                        continue
                    meeting_transcript_buffers[meeting_id].append(transcript)
                    if len(transcript) < MIN_SENTENCE_LEN_FOR_QUEUE:
                        continue
                    if meeting_id not in coaching_queue:
                        coaching_queue[meeting_id] = []
                    coaching_queue[meeting_id].append(transcript)
                    task = coaching_tasks.get(meeting_id)
                    if task is None or task.done():
                        coaching_tasks[meeting_id] = asyncio.create_task(
                            _process_coaching_queue(meeting_id)
                        )

                elif msg_type == "process_transcript":
                    full_text = msg.get("text", "").strip()
                    if full_text:
                        logger.info("[%s] Process transcript requested (%d chars, internal)", meeting_id, len(full_text))
                        try:
                            insights = await asyncio.to_thread(_process_transcript_sync, meeting_id, full_text)
                            if insights:
                                await _send_coaching_insights(meeting_id, insights)
                            else:
                                await _send_welcome_toasts(
                                    meeting_id,
                                    ["Coaching could not parse feedback — check backend logs."],
                                )
                        except Exception as e:
                            logger.exception("[%s] process_transcript failed: %s", meeting_id, e)

                elif msg_type == "request_summary":
                    summary = _build_meeting_summary(meeting_id)
                    await _send_to_meeting(
                        meeting_id,
                        {"type": "meeting_summary", "summary": summary},
                    )

                elif msg_type == "reset_session":
                    _reset_session_stats(meeting_id)
                    meeting_transcript_buffers[meeting_id] = []
                    await _send_to_meeting(meeting_id, {"type": "session_reset"})

                elif msg_type == "audio":
                    audio_b64 = msg.get("data", "")
                    mime = msg.get("mime", "audio/wav")
                    audio_kb = len(audio_b64) * 3 // 4 // 1024
                    logger.info("[%s] Audio segment received — mime=%s size≈%dKB", meeting_id, mime, audio_kb)
                    if audio_b64:
                        logger.info("[%s] Trying Groq transcription...", meeting_id)
                        transcript = await asyncio.to_thread(transcribe_audio, audio_b64, mime)
                        if transcript:
                            logger.info("[%s] Groq transcript (internal)", meeting_id)
                        else:
                            logger.info("[%s] Groq returned None — trying Gemini transcription...", meeting_id)
                            transcript = await asyncio.to_thread(transcribe_audio_gemini, audio_b64, mime)
                            if transcript:
                                logger.info("[%s] Gemini transcript (internal)", meeting_id)
                            else:
                                logger.warning("[%s] Both Groq and Gemini transcription returned None", meeting_id)

                        if transcript:
                            meeting_transcript_buffers[meeting_id].append(transcript)
                            insights = await asyncio.to_thread(_process_transcript_sync, meeting_id, transcript)
                            if insights:
                                await _send_coaching_insights(meeting_id, insights)
                        # Do not send raw transcript to clients
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
        coaching_queue.pop(meeting_id, None)
        task = coaching_tasks.pop(meeting_id, None)
        if task is not None and not task.done():
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass


@app.get("/health")
async def health():
    return {"status": "ok"}
