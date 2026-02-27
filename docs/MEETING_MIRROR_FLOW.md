# Meeting Mirror — Complete Flow

This document describes the end-to-end flow of the Meeting Mirror application: Chrome extension, frontend (Google Meet side panel), backend WebSocket server, and Gemini-based coaching.

---

## 1. High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  User's browser (Chrome)                                                     │
│  ┌──────────────────────────────┐  ┌─────────────────────────────────────┐ │
│  │  meet.google.com tab          │  │  Side panel (MeetingMirror UI)        │ │
│  │  • Content script extracts    │  │  • React app (MeetApp →               │ │
│  │    meeting ID from URL        │  │    LiveCoachingView)                  │ │
│  │  • Writes to chrome.storage   │  │  • Web Speech API (mic + STT)         │ │
│  └──────────────────────────────┘  │  • WebSocket client → backend         │ │
│                 ▲                   └─────────────────────────────────────┘ │
│                 │ chrome.storage.local                                        │
│  ┌──────────────┴──────────────┐                                              │
│  │  Extension background       │  Opens side panel on icon click              │
│  └────────────────────────────┴─────────────────────────────────────────────┘
└─────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        │ WSS (e.g. wss://localhost:8000)
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  Backend (Python, e.g. localhost:8000)                                       │
│  • FastAPI WebSocket: /ws/coaching/{meeting_id}                              │
│  • Receives: transcript (streaming), process_transcript (one-shot), audio   │
│  • Calls Gemini for coaching analysis → sends structured feedback to client │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Extension & Entry (Google Meet)

| Step | Where | What happens |
|------|--------|----------------|
| 1 | **manifest.json** | Extension declares: `side_panel` (default path `build/index.html`), `content_scripts` on `https://meet.google.com/*`, `background` service worker, host permissions for Meet and backend (`localhost:8000`, `wss://localhost:8000`). |
| 2 | **User opens meet.google.com** | Content script (`content.js`) runs on the page. |
| 3 | **content.js** | Extracts meeting ID from URL path (e.g. `/abc-defg-hij` → `abc-defg-hij`). Writes it to `chrome.storage.local` as `meetingId`. Uses `MutationObserver` and `popstate` to update when the user navigates to another Meet. |
| 4 | **User clicks extension icon** | Background script (`background.js`) has set `chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })`, so the side panel opens. |
| 5 | **Side panel loads** | The panel loads `build/index.html` (the built React app). |

---

## 3. Frontend App Bootstrap

| Step | File | What happens |
|------|------|----------------|
| 1 | **main.tsx** | Renders `<App />` into `#root`. |
| 2 | **App.tsx** | Calls `detectPlatform()`. If running as Chrome extension (`chrome.runtime?.id`) or `?platform=meet`, platform is **meet**; otherwise **teams**. Renders `<MeetApp />` or `<TeamsApp />` (lazy-loaded). |
| 3 | **MeetApp.tsx** (Google Meet) | Uses `useMeetContext()` to get `isInMeeting` and `meetingId`. |

---

## 4. Meeting Context (Google Meet)

| Step | File | What happens |
|------|------|----------------|
| 1 | **useMeetContext.ts** | Reads `meetingId` from `chrome.storage.local` (set by content script). Subscribes to `chrome.storage.onChanged` so when the user switches Meet tabs, the side panel gets the new `meetingId`. Fallback: URL param `?meetingId=xxx` for dev. |
| 2 | **MeetApp** | If `!isInMeeting` (no `meetingId`): show "Open a Google Meet and join…" and steps. If in meeting but user **declined** consent: show "Coaching is paused" + "Enable coaching". If in meeting but **no consent yet**: show **ConsentView** (Allow / Not now). If **consent given**: render **LiveCoachingView** with `meetingId` and `isInMeeting={true}`. |

---

## 5. Consent

| Step | File | What happens |
|------|------|----------------|
| 1 | **ConsentView** | Asks "Enable coaching for this meeting?" — Allow stores consent in `sessionStorage` under key `meetingmirror-consent-meet-{meetingId}`; Decline sets local state so MeetApp shows "Coaching is paused". |
| 2 | **MeetApp** | Consent is per meeting (keyed by `meetingId`). On Allow, state updates and **LiveCoachingView** is shown. |

---

## 6. WebSocket Connection (Backend)

| Step | File | What happens |
|------|------|----------------|
| 1 | **LiveCoachingView** | Calls `useCoachingWebSocket(meetingId)`. |
| 2 | **useCoachingWebSocket.ts** | Builds URL `wss://localhost:8000/ws/coaching/{meetingId}` (or `local-dev` if `meetingId` is null). Opens WebSocket, sets `status` to `connecting` → `connected` or `failed`. |
| 3 | **Backend main.py** | On `GET /ws/coaching/{meeting_id}`: accepts connection, adds the socket to `active_connections[meeting_id]`, sends a welcome message (e.g. "MeetingMirror is listening…"). If no `GEMINI_API_KEY`, sends a message asking to add it. |

---

## 7. Live Coaching View — Before Listening

| Step | File | What happens |
|------|------|----------------|
| 1 | **LiveCoachingView** | Shows connection status (Live / Connecting… / Connection failed). If connected and not listening: shows **microphone** dropdown (from `navigator.mediaDevices.enumerateDevices`, persisted in `localStorage`), **Recognition language** dropdown (e.g. en-US, Hindi, Spanish; persisted in `localStorage`), and **"Start listening"** button. |
| 2 | **useSpeechTranscription** | Hook is initialized with `recognitionLang` from the dropdown. It does not start until the user clicks Start. |

---

## 8. Start Listening — Speech Capture & Transcription

| Step | File | What happens |
|------|------|----------------|
| 1 | **User clicks "Start listening"** | `handleStartListening` runs: if WebSocket is connected and speech is supported, calls `startListening()` from `useSpeechTranscription`. |
| 2 | **useSpeechTranscription.ts** | Requests mic permission (`getUserMedia`). Creates `SpeechRecognition` (or `webkitSpeechRecognition`), sets `rec.lang = recognitionLang` (so other languages are transcribed if user chose them), `continuous = true`, `interimResults = true`, and calls `rec.start()`. |
| 3 | **Ongoing** | On `result` events: **interim** results update `interim` state (live text in UI). **Final** results call `onFinal(text)` (passed from LiveCoachingView). |
| 4 | **LiveCoachingView** | `handleFinalTranscript` appends each final phrase to `transcriptLines` and calls `sendTranscript(line)` to send that line to the backend over WebSocket. |
| 5 | **Voice level bars** | `VoiceLevelBars` uses `getUserMedia` + `AudioContext` + `AnalyserNode` to compute RMS and animates bars so the user sees mic input level. |

---

## 9. Backend — Streaming Transcript Path

| Step | File | What happens |
|------|------|----------------|
| 1 | **Backend main.py** | On message `type === "transcript"`: appends `text` to `meeting_transcript_buffers[meeting_id]`. Builds `full_text` from the buffer. |
| 2 | **Throttling** | If `len(full_text) > 50` and cooldown has passed (`GEMINI_COOLDOWN_SEC`, `MIN_TRANSCRIPT_LEN_FOR_GEMINI`), calls `_process_transcript(meeting_id, full_text)`. Then clears the buffer. |
| 3 | **_process_transcript** | If transcript too short or still in cooldown, returns `None`. Otherwise calls `analyze_transcript(full_text)` (Gemini), updates `last_gemini_at[meeting_id]`, returns `(feedback, transcript)`. |
| 4 | **_send_feedback** | Parses raw feedback with `parse_structured_feedback(feedback)` (gemini_coach), builds payload (feedbackType, improved_sentence, fillers, pace, volume, engagement_alert, suggestion, language_detected, non_english_message, etc.) and sends it to all clients in that meeting via WebSocket. |

---

## 10. Backend — One-Shot "Process" Path

| Step | File | What happens |
|------|------|----------------|
| 1 | **User clicks "Stop mic"** | Listening stops; transcript lines remain on screen. User sees **"Process"** button. |
| 2 | **User clicks "Process"** | LiveCoachingView calls `sendProcessTranscript(transcriptLines.join(' '))`. |
| 3 | **useCoachingWebSocket** | Sends `{ type: "process_transcript", text: fullText }` over WebSocket. |
| 4 | **Backend main.py** | On `type === "process_transcript"`: calls `analyze_transcript(full_text)` (no buffer, no cooldown for this path). Then `_send_feedback(..., transcript=full_text)`. |
| 5 | **Frontend** | Same as streaming path: WebSocket receives feedback message; `useCoachingWebSocket` sets `feedbackMessage`; LiveCoachingView shows it in "Live feedback" and prepends to **feedbackHistory**. |

---

## 11. Gemini Coaching (Backend)

| Step | File | What happens |
|------|------|----------------|
| 1 | **gemini_coach.analyze_transcript** | Sends `COACHING_PROMPT + transcript` to Gemini. Prompt asks for: filler words, improved sentence, pace, volume, language (English / non-English), engagement alert, suggestion — in a strict text format. |
| 2 | **parse_structured_feedback (gemini_coach)** | Parses the response line-by-line (key: value). Fills: improved_sentence, fillers, filler_breakdown, pace, volume, engagement_alert, suggestion, language_detected, non_english_message. Sets **feedback_type** by priority: engagement → other_language → pace_volume → suggested_sentence → filler_words → positive. |
| 3 | **main._send_feedback** | Puts structured fields into the JSON payload and sends to all WebSocket clients for that meeting. |

---

## 12. Feedback Display (Frontend)

| Step | File | What happens |
|------|------|----------------|
| 1 | **useCoachingWebSocket** | On WebSocket message with `data.feedback`: builds `FeedbackMessage` (including language_detected, non_english_message) and calls `setFeedbackMessage`. |
| 2 | **LiveCoachingView** | When `feedbackMessage` changes: if coming from "Process", sets `processResult` and stops "Processing…"; in all cases, prepends `{ id, msg }` to **feedbackHistory** (newest first, max 50). |
| 3 | **FeedbackCard** | For each message: shows "What you said" (transcript), "Suggested sentence", "Filler words", "Speech pace & volume" (always when present), "Other language detected" (when `language_detected === 'non_english'`), "Engagement", "Improvement for next speech". Fallback: raw `feedback` text if nothing structured. |

---

## 13. Alternative Path: Audio (Legacy)

Backend also accepts `type === "audio"` with base64 audio. It can use Groq Whisper (if configured) or Gemini for transcription, then `_process_transcript` and `_send_feedback`. The current Meet UI uses **Web Speech API + transcript** (and optionally Process); audio path is available for other clients or future use.

---

## 14. Platform Variant: Teams

For **Teams**, `App.tsx` renders **TeamsApp**, which uses **useMeetingContext** (Teams SDK `app.getContext()` for `meetingId` and frame context). Consent and **LiveCoachingView** are used the same way; only the source of `meetingId` and "in meeting" differs.

---

## 15. Summary Diagram (Data Flow)

```
User on meet.google.com
    → Content script: URL → meetingId → chrome.storage
User opens side panel
    → App → MeetApp → useMeetContext (meetingId) → Consent → LiveCoachingView
LiveCoachingView
    → useCoachingWebSocket(meetingId) → WSS to backend
    → useSpeechTranscription(recognitionLang) → mic + Web Speech API
User speaks
    → Final phrases → sendTranscript(line) → backend
Backend
    → transcript buffer → (throttle) → analyze_transcript → parse_structured_feedback
    → _send_feedback → WebSocket → client
User stops mic → Process
    → sendProcessTranscript(fullText) → backend → analyze_transcript → _send_feedback → client
Client
    → feedbackMessage + feedbackHistory → FeedbackCard (pace, volume, other language, etc.)
```

---

## 16. Key Files Reference

| Layer | Files |
|-------|--------|
| Extension | `frontend/extension/manifest.json`, `background.js`, `content.js` |
| App entry | `frontend/src/main.tsx`, `App.tsx`, `utils/platform.ts` |
| Meet UI | `frontend/src/platforms/meet/MeetApp.tsx`, `useMeetContext.ts` |
| Consent | `frontend/src/views/ConsentView.tsx` |
| Live coaching | `frontend/src/views/LiveCoachingView.tsx` |
| WebSocket | `frontend/src/hooks/useCoachingWebSocket.ts` |
| Speech | `frontend/src/hooks/useSpeechTranscription.ts` |
| Backend | `backend/main.py`, `backend/gemini_coach.py` |
