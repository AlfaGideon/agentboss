import { NextResponse } from "next/server";
import { fetchAllBooks, mergeEvents } from "@/lib/books";
import { findRuValue } from "@/lib/books/analyze";
import type { SportKey } from "@/lib/books/types";
import { fail, NO_BOOKS_HINT } from "../_util";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const sports = (sp.get("sports") || "football").split(",").filter(Boolean) as SportKey[];
  const books = (sp.get("books") || "fonbet,ligastavok,winline,olimp").split(",").filter(Boolean);
  const minEdge = Number(sp.get("minEdge") ?? 2);
  const minBooks = Number(sp.get("minBooks") ?? 3);
  const method = (sp.get("method") as "shin" | "multiplicative") || "shin";

  try {
    const perSport = await Promise.all(
      sports.slice(0, 4).map(async (s) => {
        const results = await fetchAllBooks(s, books);
        return { results, merged: mergeEvents(results) };
      })
    );
    const merged = perSport.flatMap((p) => p.merged);
    const anyOk = perSport.some((p) => p.results.some((r) => r.ok && r.events.length));
    const sources = perSport[0]?.results ?? [];

    return NextResponse.json({
      bets: findRuValue(merged, { minEdge, minBooks, method }),
      eventsScanned: merged.length,
      comparable: merged.filter((m) => m.books.length >= minBooks).length,
      sources: sources.map((r) => ({ book: r.bookTitle, key: r.bookKey, ok: r.ok, error: r.error })),
      hint: anyOk ? undefined : NO_BOOKS_HINT,
      fetchedAt: new Date().toISOString(),
    });
  } catch (e) {
    return fail(e);
  }
}
