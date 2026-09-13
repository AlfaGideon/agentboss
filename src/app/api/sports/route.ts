import { NextResponse } from "next/server";
import { getSports } from "@/lib/odds-api";
import { errorResponse } from "../_util";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const all = new URL(req.url).searchParams.get("all") === "true";
  try {
    const r = await getSports(all);
    return NextResponse.json({
      sports: r.data.filter((s) => !s.has_outrights || all),
      quota: r.quota,
      fetchedAt: r.fetchedAt,
    });
  } catch (e) {
    return errorResponse(e);
  }
}
