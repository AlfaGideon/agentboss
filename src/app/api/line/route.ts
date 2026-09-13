import { NextResponse } from "next/server";
import { fetchAllBooks, mergeEvents } from "@/lib/books";
import { marketViews } from "@/lib/books/analyze";
import type { SportKey } from "@/lib/books/types";
import { fail, NO_BOOKS_HINT } from "../_util";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const sport = (sp.get("sport") || "football") as SportKey;
  const books = (sp.get("books") || "fonbet,ligastavok,winline,olimp").split(",").filter(Boolean);
  const method = (sp.get("method") as "shin" | "multiplicative") || "shin";
  const live = sp.get("live");

  try {
    const results = await fetchAllBooks(sport, books);
    const ok = results.filter((r) => r.ok && r.events.length);
    let merged = mergeEvents(results);
    if (live === "1") merged = merged.filter((m) => m.live);
    if (live === "0") merged = merged.filter((m) => !m.live);

    const events = merged.slice(0, 250).map((ev) => ({
      id: ev.id,
      sport: ev.sport,
      league: ev.league,
      home: ev.home,
      away: ev.away,
      startTime: ev.startTime,
      live: ev.live,
      bookCount: ev.books.length,
      books: ev.books.map((b) => ({ key: b.bookKey, title: b.bookTitle, url: b.url })),
      markets: marketViews(ev, method),
    }));

    return NextResponse.json({
      events,
      sources: results.map((r) => ({
        book: r.bookTitle,
        key: r.bookKey,
        ok: r.ok,
        count: r.events.length,
        error: r.error,
        endpoint: r.endpoint,
        rawCount: r.rawCount,
        ms: r.ms,
      })),
      totalMerged: merged.length,
      hint: ok.length ? undefined : NO_BOOKS_HINT,
      fetchedAt: new Date().toISOString(),
    });
  } catch (e) {
    return fail(e);
  }
}
