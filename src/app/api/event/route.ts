import { NextResponse } from "next/server";
import { getEventOdds } from "@/lib/odds-api";
import { bestPrices, bookmakerMargin, marketLabel, shinProbs } from "@/lib/math";
import { errorResponse } from "../_util";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const sport = sp.get("sport");
  const eventId = sp.get("eventId");
  const markets = sp.get("markets") || "h2h,spreads,totals";
  if (!sport || !eventId)
    return NextResponse.json({ error: "sport и eventId обязательны" }, { status: 400 });
  try {
    const r = await getEventOdds({ sport, eventId, markets });
    const ev = r.data;
    const breakdown = markets.split(",").map((mk) => {
      const best = bestPrices(ev, mk);
      const fair = shinProbs(best.map((b) => b.price));
      return {
        market: mk,
        label: marketLabel(mk),
        best: best.map((b, i) => ({ ...b, fairProb: fair[i] ?? null })),
        overround: best.length > 1 ? bookmakerMargin(best.map((b) => b.price)) * 100 : null,
      };
    });
    return NextResponse.json({ event: ev, breakdown, quota: r.quota, fetchedAt: r.fetchedAt });
  } catch (e) {
    return errorResponse(e);
  }
}
