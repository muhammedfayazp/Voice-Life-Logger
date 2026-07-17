export const CATEGORIES = [
  "food",
  "mood",
  "meds",
  "exercise",
  "prayer",
  "expenses",
] as const;

export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_META: Record<Category, { emoji: string; label: string }> = {
  food: { emoji: "🍽️", label: "Food" },
  mood: { emoji: "🙂", label: "Mood" },
  meds: { emoji: "💊", label: "Meds" },
  exercise: { emoji: "🏃", label: "Exercise" },
  prayer: { emoji: "🕌", label: "Prayer" },
  expenses: { emoji: "💰", label: "Expenses" },
};

// Rough default clock times used only when the category implies a
// conventional time of day (currently just meals) and the user didn't
// give an explicit time. Everything else is logged at "now".
export const MEAL_TIME_HINTS: Record<string, string> = {
  breakfast: "08:00",
  lunch: "13:00",
  dinner: "19:30",
  snack: "16:00",
};
