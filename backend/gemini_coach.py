"""
Gemini AI integration for real-time speech transcription and communication coaching.
Transcription stays internal; coaching output is JSON insights only (no quoted speech in payloads).
"""
import base64
import json
import logging
import os
import re
from typing import Any, Optional

logger = logging.getLogger(__name__)

try:
    import google.generativeai as genai
    GEMINI_AVAILABLE = True
except ImportError:
    GEMINI_AVAILABLE = False

TRANSCRIPTION_PROMPT = (
    "Transcribe this audio exactly as spoken. "
    "Output only the transcribed text, nothing else. "
    "If the audio is silent or has no speech, output exactly: [silence]"
)

# Suggested replacements for common fillers (post-meeting report).
FILLER_ALTERNATIVES: dict[str, list[str]] = {
    "uh": ["pause", "well", "let me think"],
    "um": ["pause", "briefly", "well"],
    "like": ["for example", "such as"],
    "you know": ["as you may know", "essentially"],
    "basically": ["in short", "essentially", "the key point is"],
    "so": ["therefore", "next", "moving on"],
    "i mean": ["in other words", "specifically"],
}

COACHING_JSON_PROMPT = """
You are a real-time communication coach. You receive ONE English sentence that was just spoken.
Analyse ONLY that sentence. Do not quote, repeat, or paraphrase the user's words in your output.

Return a single JSON object with exactly these keys (no markdown, no code fences, no extra text):
{
  "fillerWordsDetected": string[],
  "pace": "fast" | "slow" | "good",
  "volume": "low" | "high" | "good",
  "clarity": "poor" | "good",
  "suggestions": string[]
}

Rules:
- fillerWordsDetected: list distinct filler tokens you detect from this set only:
  um, uh, like, basically, you know, so, i mean (lowercase strings).
- pace: infer from length and density; long run-on → "fast"; very choppy/fragmented → "slow"; else "good".
- volume: you cannot truly hear volume from text; use "good" unless the sentence is extremely short
  or clearly truncated (then "low"). Otherwise "good".
- clarity: "poor" if confusing, vague, or very messy grammar; else "good".
- suggestions: 0 to 3 short actionable tips (max 12 words each). Empty array if there are no issues.
  Never include the user's original wording or a rewritten sentence.

Sentence to analyse (do not echo it back):
"""

DEFAULT_GEMINI_MODEL = "gemini-2.0-flash"


def _extract_json_object(text: str) -> Optional[dict[str, Any]]:
    if not text or not text.strip():
        return None
    s = text.strip()
    # Strip markdown code fence if present
    fence = re.match(r"^```(?:json)?\s*([\s\S]*?)\s*```$", s, re.IGNORECASE)
    if fence:
        s = fence.group(1).strip()
    try:
        data = json.loads(s)
        return data if isinstance(data, dict) else None
    except json.JSONDecodeError:
        # Try first {...} block
        start = s.find("{")
        end = s.rfind("}")
        if start >= 0 and end > start:
            try:
                data = json.loads(s[start : end + 1])
                return data if isinstance(data, dict) else None
            except json.JSONDecodeError:
                pass
    return None


def normalize_coaching_insights(raw: dict[str, Any]) -> dict[str, Any]:
    """Validate and normalize Gemini JSON into a fixed shape."""
    fillers = raw.get("fillerWordsDetected") or raw.get("filler_words_detected") or []
    if not isinstance(fillers, list):
        fillers = []
    fillers_norm: list[str] = []
    for f in fillers:
        if isinstance(f, str) and f.strip():
            fillers_norm.append(f.strip().lower())

    pace = raw.get("pace") or "good"
    if pace not in ("fast", "slow", "good"):
        pace = "good"

    volume = raw.get("volume") or "good"
    if volume not in ("low", "high", "good"):
        volume = "good"

    clarity = raw.get("clarity") or "good"
    if clarity not in ("poor", "good"):
        clarity = "good"

    suggestions = raw.get("suggestions") or []
    if not isinstance(suggestions, list):
        suggestions = []
    tips: list[str] = []
    for t in suggestions:
        if isinstance(t, str) and t.strip():
            tips.append(t.strip()[:200])

    return {
        "fillerWordsDetected": fillers_norm,
        "pace": pace,
        "volume": volume,
        "clarity": clarity,
        "suggestions": tips,
    }


def insights_to_toast_messages(insights: dict[str, Any]) -> list[str]:
    """Map structured insights to short coaching strings (one toast per string)."""
    out: list[str] = []
    fillers = insights.get("fillerWordsDetected") or []
    if isinstance(fillers, list) and len(fillers) > 0:
        out.append("Filler words detected — try replacing with pauses")

    pace = insights.get("pace")
    if pace == "fast":
        out.append("You're speaking too fast — slow down")
    elif pace == "slow":
        out.append("You're speaking too slowly — pick up the pace slightly")

    volume = insights.get("volume")
    if volume == "low":
        out.append("Your voice is low — increase volume")
    elif volume == "high":
        out.append("Your voice may be loud — ease back slightly")

    clarity = insights.get("clarity")
    if clarity == "poor":
        out.append("Speak more clearly and structure your sentences")

    for tip in insights.get("suggestions") or []:
        if isinstance(tip, str) and tip.strip():
            t = tip.strip()
            if len(t) > 120:
                t = t[:117] + "…"
            out.append(t)

    # Dedupe while preserving order
    seen: set[str] = set()
    deduped: list[str] = []
    for m in out:
        key = m.lower()
        if key in seen:
            continue
        seen.add(key)
        deduped.append(m)
    return deduped


def build_suggested_alternatives(filler_words: list[str]) -> dict[str, list[str]]:
    """Map detected fillers to replacement phrases."""
    result: dict[str, list[str]] = {}
    for w in filler_words:
        key = w.strip().lower()
        if key in FILLER_ALTERNATIVES:
            result[key] = list(FILLER_ALTERNATIVES[key])
    return result


def parse_structured_feedback(raw: str) -> dict[str, Any]:
    """
    Legacy hook: parse old line-based Gemini output if ever needed.
    Prefer parse_coaching_json for new flow.
    """
    return {
        "feedback": raw,
        "feedback_type": "positive",
        "improved_sentence": None,
        "fillers": None,
        "filler_breakdown": None,
        "pace": None,
        "volume": None,
        "engagement_alert": None,
        "suggestion": None,
        "language_detected": None,
        "non_english_message": None,
    }


def _get_model() -> Optional["genai.GenerativeModel"]:
    if not GEMINI_AVAILABLE:
        return None
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        return None
    genai.configure(api_key=api_key)
    model_name = os.environ.get("GEMINI_MODEL", DEFAULT_GEMINI_MODEL)
    return genai.GenerativeModel(model_name)


def transcribe_audio_gemini(audio_base64: str, mime_type: str = "audio/wav") -> Optional[str]:
    """
    Transcribe audio using Gemini. Used when Groq is not configured.
    Returns the transcript text or None (internal only; never send to Meet overlay).
    """
    model = _get_model()
    if not model:
        logger.warning("Gemini transcription skipped: GEMINI_API_KEY missing or google-generativeai not installed")
        return None
    try:
        audio_bytes = base64.b64decode(audio_base64)
        audio_size_kb = len(audio_bytes) // 1024
        logger.info("Gemini: sending %dKB %s for transcription...", audio_size_kb, mime_type)
        audio_part = {"mime_type": mime_type, "data": audio_bytes}
        response = model.generate_content([TRANSCRIPTION_PROMPT, audio_part])
        text = (response.text or "").strip()
        if not text or text.lower() == "[silence]":
            logger.info("Gemini: transcription returned empty/silence")
            return None
        logger.info("Gemini: transcription success → %r", text[:120])
        return text
    except Exception as e:
        logger.warning("Gemini transcription failed: %s", e)
        return None


def analyze_audio(audio_base64: str, mime_type: str = "audio/webm") -> Optional[str]:
    """
    Legacy: audio-in coaching. Not used in primary flow (transcribe + analyse text).
    """
    model = _get_model()
    if not model:
        return None
    try:
        audio_bytes = base64.b64decode(audio_base64)
        audio_part = {"mime_type": mime_type, "data": audio_bytes}
        response = model.generate_content([COACHING_JSON_PROMPT + "(audio segment — skip)", audio_part])
        text = (response.text or "").strip()
        return text or None
    except Exception as e:
        logger.warning("Gemini audio analysis failed: %s", e)
        return None


def analyze_transcript(sentence: str) -> Optional[str]:
    """
    Analyse one spoken sentence; return raw model text (expected JSON object as string).
    """
    model = _get_model()
    if not model:
        logger.warning("Gemini coaching skipped: no model (missing key?)")
        return None
    sentence = sentence.strip()
    if not sentence:
        return None
    try:
        logger.info("Gemini: analysing sentence (%d chars)", len(sentence))
        prompt = COACHING_JSON_PROMPT + sentence
        response = model.generate_content(prompt)
        text = (response.text or "").strip()
        if not text:
            logger.info("Gemini: coaching returned empty response")
            return None
        logger.info("Gemini: coaching → %r", text[:160])
        return text
    except Exception as e:
        logger.exception("Gemini transcript analysis failed: %s", e)
        return None


def parse_coaching_response(model_text: Optional[str]) -> Optional[dict[str, Any]]:
    if not model_text:
        return None
    parsed = _extract_json_object(model_text)
    if not parsed:
        logger.warning("Coaching response not valid JSON: %r", model_text[:100])
        return None
    return normalize_coaching_insights(parsed)
