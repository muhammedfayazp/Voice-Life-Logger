import type { DetectedEntry } from "./schema";

/**
 * A dependency-free, zero-cost keyword/regex classifier. This exists as a
 * fallback so the core speak -> detect -> log loop keeps working even when
 * the LLM call fails (quota exhaustion, network outage, missing/invalid
 * API key) — see classifyText() in classify.ts, which tries the LLM first
 * and falls back to this only on failure. It intentionally does NOT try to
 * out-do an LLM on vague/ambiguous phrasing; it's a safety net, not the
 * primary detection strategy.
 */

interface RuleMatch {
  category: DetectedEntry["category"];
  title: string;
  detail: string;
}

const MEAL_WORDS = ["breakfast", "lunch", "dinner", "snack"];

function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function matchFood(clause: string): RuleMatch | null {
  const m = clause.match(
    /\b(?:had|ate|eating|drank|drinking)\s+(.+)/i
  );
  if (!m) return null;
  let detail = m[1].trim().replace(/[.!?]+$/, "");

  const mealMatch = detail.match(
    new RegExp(`\\bfor\\s+(${MEAL_WORDS.join("|")})\\b`, "i")
  );
  const meal = mealMatch ? mealMatch[1].toLowerCase() : null;

  // Strip the "for lunch/dinner/..." tail out of the food detail itself.
  const foodOnly = detail.replace(/\s*\bfor\s+(?:breakfast|lunch|dinner|snack)\b/i, "").trim();

  return {
    category: "food",
    title: meal ? `${titleCase(meal)} — ${foodOnly}` : `Food — ${foodOnly}`,
    detail: foodOnly || detail,
  };
}

function matchMood(clause: string): RuleMatch | null {
  const m = clause.match(
    /\b(?:feeling|feel|felt)\s+(?:pretty\s+|really\s+|very\s+|so\s+|quite\s+)?(\w+(?:\s+\w+)?)/i
  );
  if (!m) return null;
  const detail = m[1].trim().replace(/[.!?]+$/, "");
  return {
    category: "mood",
    title: `Mood — ${detail}`,
    detail,
  };
}

const MEDS_HINTS = /vitamin|pill|medication|\bmed\b|meds\b|tablet|dose|supplement|ibuprofen|aspirin|insulin|antibiotic|prescription/i;

function matchMeds(clause: string): RuleMatch | null {
  const m = clause.match(/\btook\s+(?:my\s+)?(.+)/i);
  if (!m) return null;
  if (!MEDS_HINTS.test(m[1])) return null;
  const detail = m[1].trim().replace(/[.!?]+$/, "");
  return {
    category: "meds",
    title: `Meds — ${detail}`,
    detail,
  };
}

function matchExercise(clause: string): RuleMatch | null {
  const m = clause.match(
    /\b((?:ran|run|running|jog(?:ged|ging)?|work(?:ed)?\s*out|exercised|swam|swimming|cycled|cycling|did\s+yoga|yoga)[^.,]*)/i
  );
  if (!m) return null;
  const detail = m[1].trim().replace(/[.!?]+$/, "");
  return {
    category: "exercise",
    title: `Exercise — ${detail}`,
    detail,
  };
}

const PRAYER_NAMES = ["fajr", "dhuhr", "zuhr", "asr", "maghrib", "isha", "jummah"];

function matchPrayer(clause: string): RuleMatch | null {
  const nameMatch = clause.match(new RegExp(`\\b(${PRAYER_NAMES.join("|")})\\b`, "i"));
  const genericMatch = clause.match(/\b(prayed|prayer)\b/i);
  if (!nameMatch && !genericMatch) return null;

  const name = nameMatch ? titleCase(nameMatch[1].toLowerCase()) : null;
  return {
    category: "prayer",
    title: name ? `${name} Prayer` : "Prayer",
    detail: name ?? "prayer",
  };
}

const CURRENCY_CODES: Record<string, string> = {
  dirham: "AED",
  dirhams: "AED",
  aed: "AED",
  dollar: "USD",
  dollars: "USD",
  usd: "USD",
  rupee: "INR",
  rupees: "INR",
  inr: "INR",
  pound: "GBP",
  pounds: "GBP",
  gbp: "GBP",
  euro: "EUR",
  euros: "EUR",
};

function matchExpenses(clause: string): RuleMatch | null {
  const m =
    clause.match(
      /\bspent\s+([\d,.]+)\s*(dirhams?|aed|dollars?|usd|rupees?|inr|pounds?|gbp|euros?)\b(?:\s+on\s+(.+))?/i
    ) || clause.match(/\$\s?([\d,.]+)(?:\s+on\s+(.+))?/i);
  if (!m) return null;

  const amount = m[1];
  const currency = m[2] ? CURRENCY_CODES[m[2].toLowerCase()] ?? m[2].toUpperCase() : "USD";
  const onWhat = (m[3] ?? "").trim().replace(/[.!?]+$/, "");
  const detail = onWhat ? `${amount} ${currency} on ${onWhat}` : `${amount} ${currency}`;

  return {
    category: "expenses",
    title: onWhat ? `Expense — ${onWhat}` : "Expense",
    detail,
  };
}

const MATCHERS = [matchFood, matchMood, matchMeds, matchExercise, matchPrayer, matchExpenses];

/**
 * Splits an utterance into rough clauses (on "and"/commas/periods) and runs
 * every category matcher against every clause, collecting one entry per
 * (category, clause) match. This is how a single utterance with several
 * loggable moments still gets multiple entries without an LLM.
 */
export function ruleBasedClassify(transcript: string): DetectedEntry[] {
  const clauses = transcript
    .split(/\.\s*|,\s*|\band\b/i)
    .map((c) => c.trim())
    .filter(Boolean);

  const entries: DetectedEntry[] = [];
  const seen = new Set<string>();

  for (const clause of clauses) {
    for (const matcher of MATCHERS) {
      const result = matcher(clause);
      if (!result) continue;
      const key = `${result.category}:${result.detail}`;
      if (seen.has(key)) continue;
      seen.add(key);
      entries.push(result);
    }
  }

  return entries;
}
