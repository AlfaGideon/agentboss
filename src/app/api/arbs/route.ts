import { NextResponse } from "next/server";
import { getOdds } from "@/lib/odds-api";
import { findArbs } from "@/lib/math";
import { errorResponse } from "../_util";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const sports = (sp.get("sports") || "soccer_epl").split(",").filter(Boolean).slice(0, 6);
  const markets = (sp.get("markets") || "h2h").split(",").filter(Boolean);
  const minProfit = Number(sp.get("minProfit") ?? 0);
  const regions = sp.get("regions") || undefined;

  try {
    const results = await Promise.allSettled(
      sports.map((s) => getOdds({ sport: s, markets: markets.join(","), regions }))
    );
    const events = results.flatMap((r) => (r.status === "fulfilled" ? r.value.data : []));
    const failed = results
      .map((r, i) => (r.status === "rejected" ? sports[i] : null))
      .filter(Boolean);
    const firstOk = results.find((r) => r.status === "fulfilled");
    if (!firstOk && results.length) {
      const rej = results[0] as PromiseRejectedResult;
      throw rej.reason;
    }
    const quota =
      firstOk && firstOk.status === "fulfilled" ? firstOk.value.quota : null;
    return NextResponse.json({
      arbs: findArbs(events, markets, minProfit),
      eventsScanned: events.length,
      failedSports: failed,
      quota,
      fetchedAt: new Date().toISOString(),
    });
  } catch (e) {
    return errorResponse(e);
  }
}
