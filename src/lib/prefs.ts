"use client";

import { useLocalStorage } from "@/components/ui";

export type Prefs = {
  regions: string[];
  sports: string[];
  markets: string[];
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
  regions: ["eu", "uk"],
  sports: ["soccer_epl", "basketball_nba"],
  markets: ["h2h"],
  bankroll: 100000,
  currency: "₽",
  kellyFraction: 0.25,
  minEdge: 2,
  minArbProfit: 0.5,
  minBooks: 4,
  method: "shin",
  autoRefreshSec: 0,
};

export function usePrefs() {
  const [prefs, setPrefs, loaded] = useLocalStorage<Prefs>("betscope.prefs", DEFAULT_PREFS);
  const merged = { ...DEFAULT_PREFS, ...prefs };
  return [merged, setPrefs, loaded] as const;
}

export const qs = (o: Record<string, string | number | undefined>) =>
  Object.entries(o)
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join("&");
