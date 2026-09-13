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
  /**
   * Как искать адреса контор:
   *  auto   — системный DNS, а если он не находит — резервные (8.8.8.8, 1.1.1.1, DNS-over-HTTPS);
   *  system — только системный DNS.
   */
  dnsMode: "auto" | "system";
};

export const DEFAULT_PREFS: Prefs = {
  books: ["fonbet", "ligastavok", "winline", "olimp", "betboom", "marathon", "pari", "zenit"],
  sports: ["football"],
  bankroll: 100000,
  currency: "₽",
  kellyFraction: 0.25,
  minEdge: 2,
  minArbProfit: 0.5,
  minBooks: 3,
  method: "shin",
  autoRefreshSec: 0,
  dnsMode: "auto",
};

export function usePrefs() {
  const [prefs, setPrefs, loaded] = useLocalStorage<Prefs>("betscope.prefs.ru", DEFAULT_PREFS);
  const merged = { ...DEFAULT_PREFS, ...prefs };
  return [merged, setPrefs, loaded] as const;
}

/** Значение параметра dns для API: undefined — режим «автоматически» */
export const dnsParam = (prefs: Pick<Prefs, "dnsMode">) =>
  prefs.dnsMode === "system" ? "system" : undefined;

export const qs = (o: Record<string, string | number | undefined>) =>
  Object.entries(o)
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join("&");
