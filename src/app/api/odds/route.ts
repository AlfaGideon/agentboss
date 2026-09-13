import { NextResponse } from "next/server";
import { getOdds } from "@/lib/odds-api";
import { bestPrices, bookmakerMargin, marketLabel, shinProbs } from "@/lib/math";
import { errorResponse } from "../_util";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const sport = sp.get("sport") || "soccer_epl";
  const markets = sp.get("markets") || "h2h";
  const regions = sp.get("regions") || undefined;
  try {
    const r = await getOdds({ sport, markets, regions });
    const enriched = r.data.map((ev) => {
      const mkeys = markets.split(",");
      const summary = mkeys.map((mk) => {
        const best = bestPrices(ev, mk);
        const prices = best.map((b) => b.price);
        const fair = shinProbs(prices);
        return {
          market: mk,
          label: marketLabel(mk),
          best: best.map((b, i) => ({ ...b, fairProb: fair[i] ?? null })),
          overround:
            best.length > 1
              ? bookmakerMargin(best.map((b) => b.price)) * 100
              : null,
        };
      });
      const margins = (ev.bookmakers || [])
        .map((bk) => {
          const m = bk.markets?.find((x) => x.key === mkeys[0]);
          if (!m || m.outcomes.length < 2) return null;
          return {
            bookmaker: bk.title,
            key: bk.key,
            margin: bookmakerMargin(m.outcomes.map((o) => o.price)) * 100,
            lastUpdate: bk.last_update,
          };
        })
        .filter(Boolean);
      return { ...ev, summary, margins, bookmakerCount: ev.bookmakers?.length || 0 };
    });
    return NextResponse.json({ events: enriched, quota: r.quota, fetchedAt: r.fetchedAt });
  } catch (e) {
    return errorResponse(e);
  }
}
