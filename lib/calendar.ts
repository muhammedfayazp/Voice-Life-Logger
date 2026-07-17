import { CATEGORY_META, MEAL_TIME_HINTS } from "./categories";
import type { DetectedEntry } from "./schema";

const EVENT_DURATION_MINUTES = 15;

/**
 * Decides the start time for a calendar event. Everything logs as a
 * short, point-in-time event "now" (a 15-minute block), except food
 * entries that mention a conventional meal name (breakfast/lunch/dinner/
 * snack) with no other time information available from speech, in which
 * case we anchor to a typical clock time for that meal *today* — this
 * reads better on a calendar than always using "now" for a lunch someone
 * mentions in passing at 4pm.
 */
export function resolveEventTime(entry: DetectedEntry, now: Date = new Date()): Date {
  if (entry.category === "food") {
    const haystack = `${entry.title} ${entry.detail} ${entry.note ?? ""}`.toLowerCase();
    for (const [meal, hhmm] of Object.entries(MEAL_TIME_HINTS)) {
      if (haystack.includes(meal)) {
        const [h, m] = hhmm.split(":").map(Number);
        const d = new Date(now);
        d.setHours(h, m, 0, 0);
        return d;
      }
    }
  }
  return now;
}

export interface CalendarEventDraft {
  summary: string;
  description: string;
  start: { dateTime: string };
  end: { dateTime: string };
}

export function buildEventDraft(
  entry: DetectedEntry,
  now: Date = new Date()
): CalendarEventDraft {
  const meta = CATEGORY_META[entry.category];
  const start = resolveEventTime(entry, now);
  const end = new Date(start.getTime() + EVENT_DURATION_MINUTES * 60 * 1000);

  return {
    summary: `${meta.emoji} ${entry.title}`,
    description: [
      `Category: ${meta.label}`,
      `Detail: ${entry.detail}`,
      entry.note ? `Note: ${entry.note}` : null,
      "Logged automatically by Voice Life-Logger.",
    ]
      .filter(Boolean)
      .join("\n"),
    start: { dateTime: start.toISOString() },
    end: { dateTime: end.toISOString() },
  };
}

export interface CreatedEvent {
  entry: DetectedEntry;
  htmlLink?: string;
  error?: string;
}

/**
 * Creates one Google Calendar event via a direct REST call using the
 * signed-in user's OAuth access token. Uses fetch directly rather than the
 * googleapis SDK to keep the dependency footprint small for this scope of
 * app; the REST surface for a single insert call is tiny.
 */
export async function createCalendarEvent(
  accessToken: string,
  entry: DetectedEntry,
  now: Date = new Date()
): Promise<CreatedEvent> {
  const draft = buildEventDraft(entry, now);

  const res = await fetch(
    "https://www.googleapis.com/calendar/v3/calendars/primary/events",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(draft),
    }
  );

  if (!res.ok) {
    const body = await res.text();
    return { entry, error: `Calendar API error (${res.status}): ${body}` };
  }

  const json = (await res.json()) as { htmlLink?: string };
  return { entry, htmlLink: json.htmlLink };
}
