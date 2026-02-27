# Changes: Speech Pace, Volume, and Other-Language Detection

Summary of updates for **speech pace**, **volume** in feedback, **other-language detection** with a suggestion card, and **mic input for other languages** (recognition language picker).

---

## Backend

### 1. `backend/gemini_coach.py`

- **Language parsing in `parse_structured_feedback()`**
  - In the line-by-line loop, added handling for:
    - **`key == "language"`**: If the value indicates non-English (e.g. contains "non-english" or "non english"), set:
      - `field_map["language_detected"] = "non_english"`
      - `field_map["non_english_message"] = value`
    - Otherwise set `field_map["language_detected"] = "english"`.
  - Optional: keys containing `"non-english"` or `"non_english"` (e.g. "Non-English Duration (Session)") are stored as `field_map["non_english_duration"]`.
  - Result dict already reads `language_detected` and `non_english_message` from `field_map`.

- **Feedback type for other language**
  - When `result["language_detected"] == "non_english"`, set `result["feedback_type"] = "other_language"` so the frontend can show a dedicated “Other language detected” card.

### 2. `backend/main.py`

- **WebSocket feedback payload**
  - In `_send_feedback()`, the payload sent to the client now includes:
    - `language_detected`: from `structured.get("language_detected")`
    - `non_english_message`: from `structured.get("non_english_message")`

---

## Frontend

### 3. `frontend/src/hooks/useCoachingWebSocket.ts`

- **`FeedbackMessage` type**
  - Added optional fields:
    - `language_detected?: string`
    - `non_english_message?: string`
  - Extended `feedbackType` to include `'other_language'`.

- **WebSocket `onmessage`**
  - When parsing feedback from the server, the hook now sets `language_detected` and `non_english_message` on the message object passed to the UI.

### 4. `frontend/src/hooks/useSpeechTranscription.ts`

- **Recognition language parameter**
  - New optional third argument: `recognitionLang: string = 'en-US'`.
  - `rec.lang` is set to `recognitionLang || 'en-US'` so the Web Speech API uses the chosen language for transcription.
  - Enables the mic to capture and transcribe input in other languages (e.g. Hindi, Spanish) when the user selects that language in the UI.

### 5. `frontend/src/views/LiveCoachingView.tsx`

- **Recognition language dropdown**
  - New constant `RECOGNITION_LANG_KEY` for `localStorage`.
  - `RECOGNITION_LANGUAGES` list of BCP-47 codes and labels (e.g. English US/UK, Hindi, Spanish, French, German, Portuguese, Bengali, Tamil, Telugu, Marathi).
  - State `recognitionLang` (initialized from `localStorage`, default `'en-US'`).
  - `handleRecognitionLangChange()` updates state and `localStorage`.
  - New “Recognition language” dropdown in the pre-listening card (with short note that mic transcribes in the selected language; for English coaching tips, speak in English).
  - `useSpeechTranscription(..., recognitionLang)` is called with the selected language so the mic works for other languages.

- **FeedbackCard: Speech pace & volume**
  - **Always show** when backend sends them:
    - New booleans: `hasPace`, `hasVolume` (true when pace/volume strings are present).
    - Section title: “Speech pace & volume”.
    - Content: “Pace: &lt;value&gt;. Volume: &lt;value&gt;.” (e.g. “Pace: good. Volume: good.” or “Pace: too fast. Volume: low.”).
  - **Issue hint**: If `hasPaceVolumeIssue` (pace not “good” or volume “low”), an extra line suggests adjusting pace or speaking louder.

- **FeedbackCard: Other language detected**
  - When `msg.language_detected === 'non_english'`:
    - New section (amber-styled card): title **“Other language detected”**.
    - Body: uses `msg.non_english_message` if present, otherwise a default line, plus a suggestion to speak in English for better coaching/transcription.

- **Fallback**
  - The “nothing parsed” fallback condition now also checks `!hasOtherLanguage` so the main feedback block is not shown when the only content is the other-language card.

---

## User-facing behavior

| Feature | Behavior |
|--------|----------|
| **Speech pace** | Always shown in feedback when provided (e.g. “Pace: good” or “Pace: too fast”). |
| **Volume** | Always shown when provided (e.g. “Volume: good” or “Volume: low”). |
| **Other language** | If non-English is detected, a separate “Other language detected” card suggests speaking in English for better communication. |
| **Mic in other languages** | User can choose “Recognition language” (e.g. Hindi, Spanish). The browser transcribes in that language so the mic still captures input; Gemini can still flag non-English and show the suggestion card. |