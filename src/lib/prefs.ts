"use client";

import { useLocalStorage } from "@/components/ui";
import type { SportKey } from "@/lib/books/types";

export type Prefs = {
  books: string[];
  sports: SportKey[];
  bankroll: number;
  currency: string;
  kellyFraction: number;
  minEdge: number;
  minArbProfit: number;
  minBooks: number;
  method: "shin" | "multiplicative";
  autoRefreshSec: number;
};

export const DEFAULT_PREFS: Prefs = {
  books: ["fonbet", "ligastavok", "winline", "olimp"],
  sports: ["football"],
  bankroll: 100000,
  currency: "₽",
  kellyFraction: 0.25,
  minEdge: 2,
  minArbProfit: 0.5,
  minBooks: 3,
  method: "shin",
  autoRefreshSec: 0,
};

export function usePrefs() {
  const [prefs, setPrefs, loaded] = useLocalStorage<Prefs>("betscope.prefs.ru", DEFAULT_PREFS);
  const merged = { ...DEFAULT_PREFS, ...prefs };
  return [merged, setPrefs, loaded] as const;
}

export const qs = (o: Record<string, string | number | undefined>) =>
  Object.entries(o)
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join("&");
