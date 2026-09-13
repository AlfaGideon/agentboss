import { NextResponse } from "next/server";
import { getScores } from "@/lib/odds-api";
import { errorResponse } from "../_util";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const sport = sp.get("sport") || "soccer_epl";
  const daysFrom = Number(sp.get("daysFrom") ?? 2);
  try {
    const r = await getScores(sport, daysFrom);
    return NextResponse.json({ scores: r.data, quota: r.quota, fetchedAt: r.fetchedAt });
  } catch (e) {
    return errorResponse(e);
  }
}
