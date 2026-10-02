import type { Category, Label } from "./types";

// The pills. "unsorted" (older live mail Atlas hasn't sorted) deliberately has none.
export const CATEGORIES: { id: Exclude<Category, "unsorted">; label: string; dot: string }[] = [
  { id: "action", label: "Action", dot: "bg-amber" },
  { id: "waiting", label: "Waiting on", dot: "bg-violet" },
  { id: "fyi", label: "FYI", dot: "bg-blue" },
  { id: "receipts", label: "Receipts", dot: "bg-muted" },
];

export const LABELS = ["Bricklaying", "Henty Lodge", "Trading", "Personal"] as const satisfies readonly Label[];

export function categoryLabel(id: Category) {
  return CATEGORIES.find((c) => c.id === id)?.label ?? "Not sorted";
}
