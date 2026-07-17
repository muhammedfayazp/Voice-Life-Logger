import { DetectedEntriesSchema, type DetectedEntries } from "./schema";
import { CATEGORIES } from "./categories";
import { ruleBasedClassify } from "./ruleClassifier";

export const SYSTEM_PROMPT = `You are a strict information-extraction engine for a voice life-logging app.

The user speaks a sentence describing something that just happened. Identify every
distinct loggable moment in the sentence and classify each one into exactly one of
these six categories: ${CATEGORIES.join(", ")}.

Category meanings:
- food: eating or drinking something
- mood: how the user is feeling emotionally/mentally
- meds: taking medication, vitamins, or supplements
- exercise: physical activity/workout
- prayer: a religious prayer or worship act
- expenses: spending money on something

Rules:
- A single sentence can contain MULTIPLE entries across different categories. Return one
  object per distinct entry.
- If the sentence contains nothing that fits any category, return an empty array.
- "title" must be short (a few words), human-readable, and NOT include an emoji, e.g.
  "Lunch — chicken salad", "Afternoon mood — stressed", "Vitamin D + blood pressure pill",
  "Morning run — 30 min", "Maghrib prayer", "Groceries — 40 AED".
- "detail" is the key extracted fact only (the food, the medication name(s), the amount
  spent with currency, the mood word, the activity + duration, the prayer name).
- Only set "note" if there is a genuinely useful extra detail that doesn't fit title/detail;
  omit it otherwise.
- Respond with ONLY a JSON array (no markdown fences, no prose) matching this shape:
  [{"category": "...", "title": "...", "detail": "...", "note": "..."}]
- If input is empty, garbled, or ambiguous with no confident match, return [].`;

export function buildUserPrompt(transcript: string): string {
  return `Transcribed speech: "${transcript.trim()}"`;
}

/**
 * Parses and validates the raw text returned by the LLM into a list of
 * DetectedEntry objects. This is the core "detection/classification logic"
 * kept separate from network I/O so it can be unit tested without hitting
 * a real API.
 */
export function parseEntries(raw: string): DetectedEntries {
  const cleaned = stripCodeFences(raw).trim();
  if (!cleaned) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    // Try to salvage a JSON array embedded in extra prose.
    const match = cleaned.match(/\[[\s\S]*\]/);
    if (!match) return [];
    try {
      parsed = JSON.parse(match[0]);
    } catch {
      return [];
    }
  }

  const result = DetectedEntriesSchema.safeParse(parsed);
  if (!result.success) {
    // Be lenient: filter down to just the entries that DO validate instead
    // of failing the whole batch on one malformed item.
    if (Array.isArray(parsed)) {
      const salvaged = parsed
        .map((item) => DetectedEntriesSchema.element.safeParse(item))
        .filter(
          (r): r is { success: true; data: DetectedEntries[number] } =>
            r.success
        )
        .map((r) => r.data);
      return salvaged;
    }
    return [];
  }

  return result.data;
}

function stripCodeFences(text: string): string {
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return fenceMatch ? fenceMatch[1] : text;
}

// Groq offers a genuinely free API tier (no credit card required) for fast
// open-weight models via an OpenAI-compatible chat completions endpoint, so
// this app calls it directly via REST rather than pulling in a full SDK —
// same pattern used for the Calendar API in lib/calendar.ts.
const GROQ_MODEL = "llama-3.3-70b-versatile";
const GROQ_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";

function getGroqApiKey(): string {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error(
      "GROQ_API_KEY is not set. Add it to .env.local (see .env.example)."
    );
  }
  return apiKey;
}

async function classifyWithGroq(transcript: string): Promise<DetectedEntries> {
  const apiKey = getGroqApiKey();
  const res = await fetch(GROQ_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      temperature: 0.2,
      max_tokens: 1024,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildUserPrompt(transcript) },
      ],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Groq API error (${res.status}): ${body}`);
  }

  const data = await res.json();
  const raw: string = data?.choices?.[0]?.message?.content ?? "";
  return parseEntries(raw);
}

/**
 * Sends the transcript to Groq (free tier, no billing required) and returns
 * validated, structured entries. If the LLM call fails for any reason
 * (missing/invalid key, rate limit, network outage), this falls back to a
 * zero-dependency keyword/regex classifier (lib/ruleClassifier.ts) rather
 * than surfacing an error — the core speak -> detect -> log loop should
 * keep working even when the LLM is unavailable.
 */
export async function classifyText(transcript: string): Promise<DetectedEntries> {
  if (!transcript.trim()) return [];

  try {
    return await classifyWithGroq(transcript);
  } catch (err) {
    console.error("classifyWithGroq failed, falling back to rule-based classifier:", err);
    try {
      return ruleBasedClassify(transcript);
    } catch (fallbackErr) {
      console.error("ruleBasedClassify failed:", fallbackErr);
      return [];
    }
  }
}
