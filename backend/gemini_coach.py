"""
Gemini AI integration for real-time speech transcription and communication coaching.
Supports Gemini-only setups (no Groq required).
"""
import base64
import logging
import os
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

# COACHING_PROMPT = """You are a concise communication coach. Analyze this speech and give brief feedback.

# If you notice filler words (um, uh, like, basically, you know, so, I mean), start your response with exactly:
# Filler words: <list the filler words you heard, e.g. um, like>

# Then on the next line give ONE short tip (under 12 words). Examples:
# - "Pause instead of saying 'um'"
# - "Consider slowing down"
# - "Use fewer filler words"
# - "Let others respond — you've been speaking a while"

# Also give a tip if you notice: speaking too fast or too slow, unclear or long-winded phrasing, or repetitive words.

# If the speech is clear with no issues, respond with exactly: OK

# Always respond with exactly one line (either a tip or OK). Do not leave the response empty.

# Speech:
# """

COACHING_PROMPT = """
You are a real-time AI communication coach. You will receive ONE sentence that was just spoken.
Analyse ONLY that sentence — do not reference, summarise, or rewrite anything from outside it.

🧠 Instructions:

1. Filler Words
   Detect filler words ONLY in this sentence from: (um, uh, like, basically, you know, so, I mean)
   List every filler word found. If none → None.

2. Improved Sentence
   Only rewrite if the sentence has a real problem: filler words, unclear phrasing, poor grammar,
   or unnecessary words. If the sentence is already clear, concise, and professional → output None.
   When rewriting, improve THIS sentence only — do NOT generalise, add context, or change the meaning.

3. Pace
   Estimate from word density of this sentence alone:
   - Very long run-on (>30 words) → "Speaking too fast — slow down for clarity"
   - Very short (<4 meaningful words) → "Speaking too slow — maintain a steady pace"
   - Otherwise → "Pace is good"

4. Volume
   If the sentence looks incomplete or very short → "Voice is low — speak louder"
   Else → "Volume is good"

5. Language
   If non-English words appear in this sentence → "Non-English detected — maintain English for consistency"
   Else → "English"

6. Engagement Alert
   → None  (per-sentence analysis does not track monologue duration)

7. Suggestion
   ONE actionable tip (max 12 words) based only on this sentence.
   If the sentence has NO issues at all → output None.

🧾 Output Format — output ALL fields exactly as shown, no extras:
Filler Words (Current): <fillers or None>
Filler Count (Total): <count of fillers in this sentence>
Filler Breakdown: <word: count, or None>
Improved Sentence: <rewritten version of THIS sentence only, or None if already good>
Pace: <too fast / too slow / good>
Volume: <low / good>
Language: <English / Non-English detected>
Non-English Duration (Session): None
Engagement Alert: None
Suggestion: <one short tip, or None if no issues>

❗ Rules
- Analyse ONLY the sentence provided — never reference previous sentences
- Improved Sentence must be a direct rewrite of the input sentence, not a summary
- If the sentence is already good → Improved Sentence: None and Suggestion: None
- Do NOT skip any field; use "None" or "good" when there is no issue
- No preamble, no explanations, output only the structured fields above
"""

# Priority order for which card to show (first match wins)
FEEDBACK_TYPE_PRIORITY = ("engagement", "pace_volume", "suggested_sentence", "filler_words", "positive")


def parse_structured_feedback(raw: str) -> dict[str, Any]:
    """
    Parse Gemini's structured text response into a dict for the frontend.
    Returns keys: feedback_type, improved_sentence, fillers, filler_breakdown,
    pace, volume, engagement_alert, suggestion, plus raw feedback for fallback.
    """
    result = {
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
    if not raw or not raw.strip():
        return result

    lines = raw.strip().split("\n")
    field_map = {}
    for line in lines:
        if ":" not in line:
            continue
        key, _, value = line.partition(":")
        key = key.strip().lower()
        value = value.strip()
        if key in ("filler words (current)", "filler words"):
            field_map["fillers"] = value if value and value.lower() not in ("none", "n/a", "-") else None
        elif "filler" in key and "breakdown" in key:
            field_map["filler_breakdown"] = value if value and value.lower() not in ("none", "n/a", "-") else None
        elif "filler" in key and field_map.get("fillers") is None:
            field_map["fillers"] = value if value and value.lower() not in ("none", "n/a", "-") else None
        elif key in ("filler count (total)", "filler count"):
            field_map["filler_count"] = value
        elif key == "filler breakdown":
            field_map["filler_breakdown"] = value if value and value.lower() not in ("none", "n/a", "-") else None
        elif key in ("improved sentence",):
            field_map["improved_sentence"] = value if value and value.lower() not in ("none", "n/a", "-") else None
        elif key == "pace":
            v = value.lower()
            field_map["pace"] = "good" if "good" in v or v in ("none", "n/a", "-", "") else value
        elif key == "volume":
            v = value.lower()
            field_map["volume"] = "low" if "low" in v else "good"
        elif key in ("engagement alert",):
            field_map["engagement_alert"] = value if value and value.lower() not in ("none", "n/a", "-") else None
        elif key == "suggestion":
            field_map["suggestion"] = value if value else None
        elif key == "language":
            v = value.lower()
            if "non-english" in v or "non english" in v:
                field_map["language_detected"] = "non_english"
                field_map["non_english_message"] = value
            else:
                field_map["language_detected"] = "english"
        elif "non-english" in key or "non_english" in key:
            field_map["non_english_duration"] = value if value else None
    result["improved_sentence"] = field_map.get("improved_sentence")
    result["fillers"] = field_map.get("fillers")
    result["filler_breakdown"] = field_map.get("filler_breakdown")
    result["pace"] = field_map.get("pace")
    result["volume"] = field_map.get("volume")
    result["engagement_alert"] = field_map.get("engagement_alert")
    result["suggestion"] = field_map.get("suggestion")
    result["language_detected"] = field_map.get("language_detected")
    result["non_english_message"] = field_map.get("non_english_message")

    if result["engagement_alert"]:
        result["feedback_type"] = "engagement"
    elif result["language_detected"] == "non_english":
        result["feedback_type"] = "other_language"
    elif (result["pace"] and result["pace"] != "good") or (result["volume"] and result["volume"] == "low"):
        result["feedback_type"] = "pace_volume"
    elif result["improved_sentence"]:
        result["feedback_type"] = "suggested_sentence"
    elif result["fillers"]:
        result["feedback_type"] = "filler_words"
    else:
        result["feedback_type"] = "positive"

    return result


# Default model when GEMINI_MODEL is not set in .env (gemini-1.5-flash 404s on current v1beta).
DEFAULT_GEMINI_MODEL = "gemini-2.0-flash"


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
    Returns the transcript text or None.
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
    Send audio directly to Gemini for coaching (legacy fallback, prefer transcribe then analyze).
    Returns coaching feedback or None.
    """
    model = _get_model()
    if not model:
        return None
    try:
        audio_bytes = base64.b64decode(audio_base64)
        audio_part = {"mime_type": mime_type, "data": audio_bytes}
        response = model.generate_content([COACHING_PROMPT, audio_part])
        text = (response.text or "").strip()
        if text.upper() == "OK" or not text:
            return None
        return text
    except Exception as e:
        logger.warning("Gemini audio analysis failed: %s", e)
        return None


def analyze_transcript(sentence: str) -> Optional[str]:
    """
    Analyse a single spoken sentence and return structured coaching feedback or None.
    The sentence is analysed in isolation — no accumulated history is passed.
    """
    model = _get_model()
    if not model:
        logger.warning("Gemini coaching skipped: no model (missing key?)")
        return None
    sentence = sentence.strip()
    if not sentence:
        return None
    try:
        logger.info("Gemini: analysing sentence (%d chars): %r", len(sentence), sentence[:80])
        prompt = COACHING_PROMPT + f"\n\nSentence to analyse:\n{sentence}"
        response = model.generate_content(prompt)
        text = (response.text or "").strip()
        if not text:
            logger.info("Gemini: coaching returned empty response")
            return "✓ No issues detected — keep it up!"
        if text.upper() == "OK":
            logger.info("Gemini: coaching → OK")
            return "✓ No issues — speech looks good"
        logger.info("Gemini: coaching → %r", text[:120])
        return text
    except Exception as e:
        logger.exception("Gemini transcript analysis failed: %s", e)
        return None
