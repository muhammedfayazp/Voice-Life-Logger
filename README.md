# Voice Life-Logger

Speak a moment from your day; it gets classified into one of six categories and
logged as an event on your Google Calendar.

## Stack

- **Next.js 14** (App Router, TypeScript) — single app, no separate backend.
- **NextAuth.js** for Google sign-in, minimal `calendar.events` OAuth scope.
- **Web Speech API** (browser built-in) for speech-to-text — no custom speech model.
- **Groq API** (`llama-3.3-70b-versatile`, direct `fetch`, genuinely free tier — no credit card) for detection/classification of the transcript.
- **Google Calendar REST API** (direct `fetch`, no SDK) to create events.
- **Vitest** for unit tests on the classification/parsing logic.

## Running it

### 1. Install

```bash
npm install
```

### 2. Google Cloud setup (for real OAuth + Calendar)

1. Go to [Google Cloud Console](https://console.cloud.google.com/) → create/select a project.
2. **APIs & Services → Library** → enable the **Google Calendar API**.
3. **APIs & Services → OAuth consent screen**:
   - User type: External (or Internal if using a Workspace org).
   - Add your own Google account under **Test users** (required while the app is in "Testing" status).
   - **Scopes** (under the consent screen's **Data Access** / **Scopes** tab): click **Add or Remove Scopes**, search "Calendar API", and check `.../auth/calendar.events`, then **Save**. This step is required — if it's skipped, Google will still show a consent screen and let you approve it, but the issued access token silently won't carry the scope, and calendar inserts will fail with a `403 ACCESS_TOKEN_SCOPE_INSUFFICIENT` error even though everything looks fine on the surface.
4. **APIs & Services → Credentials → Create Credentials → OAuth client ID**:
   - Application type: **Web application**.
   - Authorized redirect URI: `http://localhost:3000/api/auth/callback/google`
   - Copy the generated **Client ID** and **Client Secret**.

### 3. Environment variables

```bash
cp .env.example .env.local
```

Fill in:
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` — from step 2.
- `NEXTAUTH_SECRET` — generate with `openssl rand -base64 32`.
- `NEXTAUTH_URL` — `http://localhost:3000` for local dev.
- `GROQ_API_KEY` — free API key from [console.groq.com/keys](https://console.groq.com/keys) (free account, no credit card required).

### 4. Run

```bash
npm run dev
```

Open `http://localhost:3000` in **Chrome** (Web Speech API support is best there). Sign in with the Google account you added as a test user, grant calendar access, tap the mic, and speak.

### 5. Automated tests

```bash
npm test
```

## Reviewer checklist (manual walkthrough)

A quick script to verify the core loop end-to-end, roughly in order of the
evaluation weighting:

1. **Sign-in & scope** — load the app signed out, click "Sign in with Google."
   You should see a Google consent screen naming calendar event access
   specifically (not a broad "manage all your data" scope). Approve it and
   land back on the single-screen app, signed in.
2. **Single-category phrase** — tap the mic and say *"Took my vitamin D and
   blood pressure pill."* Expect one 💊 Meds entry in the review card before
   logging.
3. **Multi-category phrase** — say *"I had a chicken salad for lunch and I'm
   feeling pretty good today."* Expect two entries: 🍽️ Food and 🙂 Mood.
4. **Confirm before logging** — check that nothing hits the calendar until
   you explicitly tap "Log to Calendar" — the review step is the
   confirmation the spec asks for.
5. **Check the calendar** — click "View event" on a logged entry (or open
   Google Calendar directly) and confirm the event exists with a sensible
   title, a short time block, and a description holding the extracted
   detail.
6. **Vague / unrecognized input** — say something off-topic (e.g. *"the
   weather is nice today"*). Expect a friendly "didn't detect any loggable
   moments" message, not a crash or a bogus calendar entry.
7. **Robustness of the classify step** — this one's optional to verify
   manually since it's covered by automated tests, but if you want to see it
   live: temporarily set `GROQ_API_KEY` to an invalid value and restart —
   the app should still classify correctly via the rule-based fallback
   (`lib/ruleClassifier.ts`), just with slightly less nuance on vague
   phrasing.
8. **Unit tests** — `npm test` should show all tests passing, covering the
   LLM-response parsing/validation logic and the fallback classifier
   independent of any live network call.

## How detection works

1. The browser's `SpeechRecognition` API transcribes speech to text client-side.
2. The transcript is sent to `/api/classify`, which calls Groq's OpenAI-compatible
   chat completions API (`llama-3.3-70b-versatile`, via direct REST call in
   `lib/classify.ts`) with a system prompt describing the six categories (food,
   mood, meds, exercise, prayer, expenses) and asks it to return a JSON array of
   `{category, title, detail, note?}` objects — one per distinct loggable moment
   in the sentence. This is how a single utterance like *"I had a chicken salad
   for lunch and I'm feeling pretty good"* becomes two entries (food + mood).
3. The raw model output is parsed and validated against a Zod schema
   (`lib/schema.ts`). Parsing is deliberately lenient: it strips markdown code
   fences the model sometimes adds, tries to recover a JSON array embedded in
   extra prose, and — if some entries in the array are malformed — keeps the
   valid ones instead of discarding the whole batch. This logic lives in
   `lib/classify.ts::parseEntries` and is unit tested (`__tests__/classify.test.ts`)
   independent of any network call, so the tests don't need an API key.
4. **Fallback classifier**: if the Groq call fails for any reason (missing/
   invalid key, rate limit, network outage), `classifyText()` in
   `lib/classify.ts` falls back to a small dependency-free keyword/regex
   classifier (`lib/ruleClassifier.ts`) instead of surfacing an error. It
   splits the utterance into clauses and matches each of the six categories
   against known trigger words (e.g. "had/ate" → food, "took my vitamin" →
   meds, "prayed Maghrib" → prayer, "spent 40 dirhams" → expenses). It won't
   handle vague phrasing as well as an LLM, but it keeps the core speak →
   detect → log loop working even when the LLM is unavailable — this is
   unit tested independently in `__tests__/classify.test.ts`.
5. If nothing is detected by either path (empty transcript, no match), the
   UI shows a "didn't catch anything loggable" message instead of silently
   failing or logging garbage.
6. The user reviews the detected entries (title + detail per category) before
   confirming — nothing is written to the calendar until they tap "Log to
   Calendar."

### Time handling

Every entry is logged as a **15-minute point-in-time event at "now"**, except
food entries that mention a conventional meal name (breakfast/lunch/dinner/
snack) with no other time info from speech — those anchor to a typical clock
time for that meal today (e.g. "had a sandwich for lunch" at 4pm still logs
around 1pm). This is a small, clearly-scoped heuristic in `lib/calendar.ts`,
not a general time-parser — the take-home didn't ask for arbitrary time
extraction ("logged at 3pm yesterday"), so this was kept intentionally simple.

## What I left out (intentionally, per scope)

- No history/timeline view, dashboard, or charts.
- No editing or deleting past entries — logging is one-way, by design.
- No reminders, notifications, or recurring logs.
- No multi-language support (English only) — see below for how I'd approach it.
- Minimal styling — one clean screen, no design system.
- No arbitrary natural-language time parsing ("at 3pm", "yesterday") — only the
  meal-time heuristic described above.

## What I'd do next with more time

- **Multi-language support**: swap `SpeechRecognition.lang` based on user
  preference/browser locale, and let the classification prompt handle
  non-English transcripts directly (the underlying Llama model handles
  several languages) rather than round-tripping through a translation step.
- **Smarter time extraction**: parse explicit time phrases in speech ("this
  morning", "at 3", "yesterday") into the event's start time instead of only
  the meal-name heuristic.
- **Retry/undo affordance**: if a Calendar API call fails for one entry in a
  multi-entry batch, let the user retry just that one instead of the whole
  utterance.
- **Confidence threshold**: have the classifier return a confidence score per
  entry and visually flag low-confidence detections in the review step so the
  user knows to double check them before confirming.
- **Offline queuing**: if the network drops mid-flow, queue the transcript and
  retry classification/logging when connectivity returns.

## Notes on the OAuth scope

The app only requests `https://www.googleapis.com/auth/calendar.events`
(create/modify events), not the broader `calendar` or `calendar.readonly`
scopes — the app never reads the user's existing calendar, only inserts new
events on their primary calendar.
