import { NextResponse } from "next/server";
import { withNetOptions } from "@/lib/books/net";
import type { BookFetchResult } from "@/lib/books/types";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export function fail(e: unknown, status = 500) {
  const msg = e instanceof Error ? e.message : "Неизвестная ошибка";
  return NextResponse.json({ error: msg }, { status });
}

/** Что показать, когда ни одна контора не ответила */
export const NO_BOOKS_HINT =
  "Ни одна контора не ответила. В списке источников выше видно, чем закончился каждый адрес: " +
  "адрес не найден, нет соединения или контора не отдала линию. Приложение само проверяет " +
  "адреса через резервные DNS-серверы, так что чаще всего причина в блокировке на стороне сети.";

/**
 * Человеческая причина сбоя — чтобы в интерфейсе не пугать сырым текстом ошибки.
 * dns      — адрес не найден ни системным, ни резервными серверами;
 * blocked  — адрес есть, но соединение не проходит (блокировка, прокси, антивирус);
 * http     — контора ответила отказом (защита от ботов);
 * empty    — ответ получен, но событий в линии нет;
 * other    — всё остальное.
 */
export type FailureKind = "dns" | "blocked" | "http" | "empty" | "other" | undefined;

function classify(r: BookFetchResult): FailureKind {
  if (r.ok) return undefined;
  const attempts = (r.tried ?? []).map((t) => t.error || "");
  if (!attempts.length && !r.error) return "other";

  // берём причину, которая повторилась у большинства адресов
  const score: Record<string, number> = {
    dns: attempts.filter((e) => /адрес не найден/i.test(e)).length,
    blocked: attempts.filter((e) => /сброшено|таймаут|отклонено|перехват|сертификат/i.test(e)).length,
    http: attempts.filter((e) => /HTTP \d{3}/.test(e)).length,
    empty: attempts.filter((e) => /пусто|без событий|не JSON/i.test(e)).length,
  };
  const best = Object.entries(score).sort((a, b) => b[1] - a[1])[0];
  if (best && best[1] > 0) return best[0] as FailureKind;

  const all = [...attempts, r.error || ""].join(" | ");
  if (/адрес не найден/i.test(all)) return "dns";
  if (/HTTP \d{3}/.test(all)) return "http";
  if (/сброшено|таймаут|отклонено|перехват|сертификат/i.test(all)) return "blocked";
  return "other";
}

/** Отдаём наружу разбор по каждому адресу: виден в «Настройках» */
export function sourceView(r: BookFetchResult) {
  return {
    errorKind: classify(r),
    book: r.bookTitle,
    key: r.bookKey,
    ok: r.ok,
    count: r.events.length,
    error: r.error,
    endpoint: r.endpoint,
    rawCount: r.rawCount,
    ms: r.ms,
    dnsVia: r.dnsVia,
    insecure: r.insecure,
    tried: r.tried,
  };
}

/**
 * Выполняет запрос с учётом настроек сети из строки запроса.
 * `dns=system` — проверять только системный DNS, без резервных серверов.
 */
export function withNetwork<T>(req: Request, fn: () => Promise<T>): Promise<T> {
  const mode = new URL(req.url).searchParams.get("dns") || "auto";
  return withNetOptions({ noDnsFallback: mode === "system" }, fn);
}
