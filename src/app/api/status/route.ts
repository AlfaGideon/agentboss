import { NextResponse } from "next/server";
import { getSports, hasApiKey, defaultRegions } from "@/lib/odds-api";
import { errorResponse } from "../_util";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!hasApiKey()) {
    return NextResponse.json({
      connected: false,
      regions: defaultRegions(),
      message:
        "Ключ The Odds API не задан. Создайте .env.local с ODDS_API_KEY=... и перезапустите приложение.",
    });
  }
  try {
    const r = await getSports();
    return NextResponse.json({
      connected: true,
      regions: defaultRegions(),
      quota: r.quota,
      sportsCount: r.data.length,
      fetchedAt: r.fetchedAt,
    });
  } catch (e) {
    return errorResponse(e);
  }
}
