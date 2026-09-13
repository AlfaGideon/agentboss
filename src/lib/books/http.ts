export const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

export class BookError extends Error {}

export async function getJson<T>(
  url: string,
  signal: AbortSignal,
  headers: Record<string, string> = {}
): Promise<T> {
  const res = await fetch(url, {
    signal,
    headers: {
      "User-Agent": UA,
      Accept: "application/json, text/plain, */*",
      "Accept-Language": "ru-RU,ru;q=0.9",
      ...headers,
    },
    cache: "no-store",
  });
  if (!res.ok) throw new BookError(`HTTP ${res.status}`);
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new BookError("Ответ не является JSON (вероятно, блокировка или капча)");
  }
}

/** Нормализация названия команды для сопоставления между конторами */
export function normTeam(s: string): string {
  return (s || "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/[^a-zа-я0-9 ]/gi, " ")
    .replace(
      /\b(фк|хк|бк|пфк|мфк|жфк|fc|hc|cf|sc|ac|afc|cd|club|team|команда|u\d{2}|мол|молодежная|ii|2)\b/g,
      " "
    )
    .replace(/\s+/g, " ")
    .trim();
}

/** Схожесть строк 0..1 (токенная + подстрочная) */
export function similarity(a: string, b: string): number {
  const A = normTeam(a);
  const B = normTeam(b);
  if (!A || !B) return 0;
  if (A === B) return 1;
  if (A.includes(B) || B.includes(A)) return 0.92;
  const ta = new Set(A.split(" ").filter((x) => x.length > 2));
  const tb = new Set(B.split(" ").filter((x) => x.length > 2));
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const t of ta) {
    if (tb.has(t)) inter++;
    else {
      for (const u of tb) {
        if (t.length > 3 && u.length > 3 && (t.startsWith(u.slice(0, 4)) || u.startsWith(t.slice(0, 4)))) {
          inter += 0.7;
          break;
        }
      }
    }
  }
  return inter / Math.max(ta.size, tb.size);
}

export const isoFrom = (secOrMs: number): string => {
  const n = secOrMs > 1e12 ? secOrMs : secOrMs * 1000;
  return new Date(n).toISOString();
};

/** Округление линии тотала/форы до 0.25 для сопоставления */
export const roundLine = (n: number) => Math.round(n * 4) / 4;
