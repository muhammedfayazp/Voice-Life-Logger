import { z } from "zod";
import { CATEGORIES } from "./categories";

// One detected log entry, as produced by the classifier and consumed by
// the calendar-writing code. Kept intentionally small: just enough to
// build a calendar event title/description.
export const DetectedEntrySchema = z.object({
  category: z.enum(CATEGORIES),
  // Short human title WITHOUT emoji, e.g. "Lunch — chicken salad"
  title: z.string().min(1).max(120),
  // The key extracted detail, e.g. "chicken salad", "vitamin D", "40 AED"
  detail: z.string().min(1).max(200),
  // Optional free-text note the model wants to preserve (kept short)
  note: z.string().max(300).optional(),
});

export type DetectedEntry = z.infer<typeof DetectedEntrySchema>;

export const DetectedEntriesSchema = z.array(DetectedEntrySchema).max(6);

export type DetectedEntries = z.infer<typeof DetectedEntriesSchema>;
