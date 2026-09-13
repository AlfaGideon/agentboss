import { NextResponse } from "next/server";
import { OddsApiError } from "@/lib/odds-api";

export function errorResponse(e: unknown) {
  if (e instanceof OddsApiError) {
    return NextResponse.json(
      { error: e.message, needsKey: e.status === 503 || e.status === 401 },
      { status: e.status === 401 ? 401 : e.status }
    );
  }
  const msg = e instanceof Error ? e.message : "Неизвестная ошибка";
  return NextResponse.json({ error: msg }, { status: 500 });
}

export const dynamic = "force-dynamic";
