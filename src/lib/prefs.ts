"use client";

import { useLocalStorage } from "@/components/ui";
import { BOOK_LIST, type SportKey } from "@/lib/books/types";

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
  /** период показа событий в «Сравнении линий»: 0 — все */
  lineDays: number;
  /**
   * Как искать адреса контор:
   *  auto   — системный DNS, а если он не находит — резервные (8.8.8.8, 1.1.1.1, DNS-over-HTTPS);
   *  system — только системный DNS.
   */
  dnsMode: "auto" | "system";
};

export const DEFAULT_PREFS: Prefs = {
  books: BOOK_LIST.map((b) => b.key),
  sports: ["football"],
  bankroll: 100000,
  currency: "₽",
  kellyFraction: 0.25,
  minEdge: 2,
  minArbProfit: 0.5,
  minBooks: 3,
  method: "shin",
  autoRefreshSec: 0,
  lineDays: 7,
  dnsMode: "auto",
};

/**
 * Миграция сохранённых настроек: конторы без публичного фида (Винлайн,
 * БетБум) заменены на рабочие источники (Леон, Беттери).
 */
function migrateBooks(books: string[] | undefined): string[] | undefined {
  if (!books || !Array.isArray(books)) return books;
  const known = new Set(BOOK_LIST.map((b) => b.key));
  const retired = new Set(["winline", "betboom"]);
  if (!books.some((b) => retired.has(b))) return books;
  const migrated = books.filter((b) => !retired.has(b));
  for (const key of ["leon", "bettery"]) {
    if (!migrated.includes(key)) migrated.push(key);
  }
  const valid = migrated.filter((b) => known.has(b));
  return valid.length ? valid : DEFAULT_PREFS.books;
}

export function usePrefs() {
  const [prefs, setPrefs, loaded] = useLocalStorage<Prefs>("betscope.prefs.ru", DEFAULT_PREFS);
  const merged: Prefs = { ...DEFAULT_PREFS, ...prefs };
  const books = migrateBooks(merged.books) ?? DEFAULT_PREFS.books;
  const sports = merged.sports?.length ? merged.sports : DEFAULT_PREFS.sports;
  return [{ ...merged, books, sports }, setPrefs, loaded] as const;
}

/** Значение параметра dns для API: undefined — режим «автоматически» */
export const dnsParam = (prefs: Pick<Prefs, "dnsMode">) =>
  prefs.dnsMode === "system" ? "system" : undefined;

export const qs = (o: Record<string, string | number | undefined>) =>
  Object.entries(o)
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join("&");
