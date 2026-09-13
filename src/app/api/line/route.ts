import { NextResponse } from "next/server";
import { fetchAllBooks, mergeEvents } from "@/lib/books";
import { marketViews } from "@/lib/books/analyze";
import type { SportKey } from "@/lib/books/types";
import { fail, NO_BOOKS_HINT, sourceView, withNetwork } from "../_util";

export const dynamic = "force-dynamic";

/** сколько событий отдаём наружу (прематч-линия большая — режем) */
const MAX_EVENTS = 400;

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const sport = (sp.get("sport") || "football") as SportKey;
  const books = (sp.get("books") || "fonbet,ligastavok,leon,olimp").split(",").filter(Boolean);
  const method = (sp.get("method") as "shin" | "multiplicative") || "shin";
  const live = sp.get("live");
  /** горизонт будущих событий в днях: 0/не задано — все */
  const days = Number(sp.get("days") ?? 0);

  return withNetwork(req, async () => {
    try {
      const results = await fetchAllBooks(sport, books);
      const ok = results.filter((r) => r.ok && r.events.length);
      let merged = mergeEvents(results);
      if (live === "1") merged = merged.filter((m) => m.live);
      if (live === "0") merged = merged.filter((m) => !m.live);
      if (days > 0) {
        const until = Date.now() + days * 24 * 60 * 60 * 1000;
        merged = merged.filter((m) => m.live || +new Date(m.startTime) <= until);
      }

      const events = merged.slice(0, MAX_EVENTS).map((ev) => ({
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
        totalMerged: merged.length,
        sources: results.map(sourceView),
        hint: ok.length ? undefined : NO_BOOKS_HINT,
        fetchedAt: new Date().toISOString(),
      });
    } catch (e) {
      return fail(e);
    }
  });
}
