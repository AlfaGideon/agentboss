import { NextResponse } from "next/server";
import { getOdds } from "@/lib/odds-api";
import { findValueBets } from "@/lib/math";
import { errorResponse } from "../_util";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const sports = (sp.get("sports") || "soccer_epl").split(",").filter(Boolean).slice(0, 6);
  const markets = (sp.get("markets") || "h2h").split(",").filter(Boolean);
  const minEdge = Number(sp.get("minEdge") ?? 2);
  const minBooks = Number(sp.get("minBooks") ?? 4);
  const method = (sp.get("method") as "shin" | "multiplicative") || "shin";
  const regions = sp.get("regions") || undefined;

  try {
    const results = await Promise.allSettled(
      sports.map((s) => getOdds({ sport: s, markets: markets.join(","), regions }))
    );
    const events = results.flatMap((r) => (r.status === "fulfilled" ? r.value.data : []));
    const firstOk = results.find((r) => r.status === "fulfilled");
    if (!firstOk && results.length) throw (results[0] as PromiseRejectedResult).reason;
    const quota = firstOk && firstOk.status === "fulfilled" ? firstOk.value.quota : null;
    return NextResponse.json({
      bets: findValueBets(events, markets, { minEdgePct: minEdge, minBooks, method }),
      eventsScanned: events.length,
      quota,
      fetchedAt: new Date().toISOString(),
    });
  } catch (e) {
    return errorResponse(e);
  }
}
