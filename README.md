# MeetingMirror

A meeting extension providing private, real-time AI coaching — for **Microsoft Teams** and **Google Meet**.

## Structure

```
├── manifest.json          # Teams app manifest (meetingSidePanel)
├── frontend/
│   ├── src/
│   │   ├── platforms/
│   │   │   ├── teams/     # TeamsApp, Teams context
│   │   │   └── meet/      # MeetApp, Meet context (Chrome extension)
│   │   ├── views/         # ConsentView, LiveCoachingView, ConfigView
│   │   └── hooks/         # useMeetingContext, useCoachingWebSocket
│   └── extension/         # Chrome extension for Google Meet
│       ├── manifest.json
│       ├── content.js     # Extracts meeting ID from meet.google.com
│       └── build/         # Output of npm run build:extension
└── backend/               # FastAPI + WebSocket (shared by both platforms)
    └── main.py
```

## Quick Start

### 1. Backend (FastAPI)

**Important:** The frontend runs on HTTPS (required for Teams). The backend must use HTTPS/WSS too, or the WebSocket will fail with "Connecting..." indefinitely.

```bash
cd backend
python -m venv venv
source venv/bin/activate   # Windows: venv\Scripts\activate
pip install -r requirements.txt
```

**Add your API keys** for real-time AI coaching:

```bash
cp .env.example .env
# Edit .env and set:
#   GEMINI_API_KEY=your_key_from_https_aistudio.google.com_apikey
#   GROQ_API_KEY=your_key_from_https_console.groq.com_keys  (for Whisper transcription)
```

Generate mkcert certs first (see `frontend/MKCERT_SETUP.md`), then:

```bash
python run_dev.py   # Uses certs for WSS; falls back to HTTP if none
```

Or manually with SSL: `uvicorn main:app --reload --port 8000 --ssl-certfile ../frontend/certs/localhost.pem --ssl-keyfile ../frontend/certs/localhost-key.pem`

### 2. Frontend (React)

```bash
cd frontend
npm install
npm run dev
```

Frontend runs at `https://localhost:3000` (HTTPS required for Teams).

---

## Google Meet (Chrome Extension)

### 1. Build the extension

```bash
cd frontend
npm run build:extension
```

This outputs to `frontend/extension/build/`.

### 2. Load in Chrome

1. Open Chrome → `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select the `frontend/extension` folder

### 3. Use in a meeting

1. Start or join a meeting at [meet.google.com](https://meet.google.com)
2. Click the MeetingMirror extension icon in the toolbar
3. The side panel opens with the coaching view

The extension reads the meeting ID from the Meet URL and connects to the same backend. Ensure the backend is running with WSS (see Backend section above).

### 4. Test Meet without extension

Open `https://localhost:3000?platform=meet&meetingId=test-meeting` to test the Meet flow directly (e.g. in a new tab). The backend must be running.

---

### 3. Manifest Icons

Add `color.png` and `outline.png` (192x192) to the project root. You can create simple placeholder icons or use [Teams icon generator](https://learn.microsoft.com/en-us/microsoftteams/platform/assets/images/app-icons).

### 4. Sideload in Teams

1. In Teams, go to **Apps** → **Manage your apps** → **Upload an app** → **Upload a custom app**
2. Select the `manifest.json` (and package with icons if needed)
3. Join a meeting and add MeetingMirror to the side panel

## Features

- **Consent View**: "Allow MeetingMirror" before using
- **Live Coaching View**: WebSocket connection for real-time feedback
- **Platform support**: Teams (side panel) and Google Meet (Chrome extension)
- **Meeting context detection**: Teams uses `app.getContext()`; Meet uses the extension content script to read the meeting ID from the URL
- **Gemini AI coaching**: Captures your speech via VAD + Groq Whisper (from [swift-ai-voice-assistant](https://github.com/Sirisha-428/swift-ai-voice-assistant)), sends transcripts to backend, Gemini analyzes for filler words, pace, clarity, and returns real-time tips. Set `GEMINI_API_KEY` and `GROQ_API_KEY` in `.env`.

## URLs

| Purpose          | URL                      |
|------------------|--------------------------|
| Config (manifest)| `https://localhost:3000/config` |
| Content (side panel) | `https://localhost:3000/` |

For production, replace `localhost` with your deployed domain and add it to `validDomains` in the manifest.
