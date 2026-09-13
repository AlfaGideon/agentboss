import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export function fail(e: unknown, status = 500) {
  const msg = e instanceof Error ? e.message : "Неизвестная ошибка";
  return NextResponse.json({ error: msg }, { status });
}

/** Подсказка пользователю, когда ни одна контора не ответила */
export const NO_BOOKS_HINT =
  "Ни одна контора не ответила. Скорее всего, сервер не имеет прямого доступа к сайтам букмекеров: запустите приложение локально на российском интернете без VPN.";
