import { gunzipSync, inflateSync, brotliDecompressSync } from "node:zlib";
import https from "node:https";

export const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

export class BookError extends Error {}

/** Сколько ждём ответа от одного адреса (мс) */
export const REQUEST_TIMEOUT_MS = 8000;

/**
 * Заголовки «как у браузера». Большинство витрин российских контор
 * отвечают 403 или капчей на голый запрос без Referer/Origin/Accept.
 */
function browserHeaders(url: string, extra: Record<string, string> = {}) {
  let origin = "";
  try {
    origin = new URL(url).origin;
  } catch {}
  return {
    "User-Agent": UA,
    Accept: "application/json, text/plain, */*",
    "Accept-Language": "ru-RU,ru;q=0.9,en;q=0.8",
    "Accept-Encoding": "gzip, deflate",
    "Cache-Control": "no-cache",
    Pragma: "no-cache",
    ...(origin ? { Origin: origin, Referer: `${origin}/` } : {}),
    ...extra,
  };
}

/** Распаковка тела: undici сам снимает gzip только если сервер прислал Content-Encoding */
function decodeBody(buf: Buffer, enc: string): string {
  try {
    if (enc === "gzip") return gunzipSync(buf).toString("utf8");
    if (enc === "deflate") return inflateSync(buf).toString("utf8");
    if (enc === "br") return brotliDecompressSync(buf).toString("utf8");
  } catch {}
  // сервер мог отдать .gz файлом, без заголовка
  if (buf.length > 2 && buf[0] === 0x1f && buf[1] === 0x8b) {
    try {
      return gunzipSync(buf).toString("utf8");
    } catch {}
  }
  return buf.toString("utf8");
}

async function peekBody(res: Response): Promise<string> {
  try {
    const buf = Buffer.from(await res.arrayBuffer());
    const enc = (res.headers.get("content-encoding") || "").toLowerCase();
    return decodeBody(buf, enc)
      .replace(/\s+/g, " ")
      .slice(0, 120);
  } catch {
    return "";
  }
}

/**
 * Обход перехвата HTTPS: антивирусы (Касперский, Dr.Web, ESET) и корпоративные
 * прокси подменяют сертификат своим, а Node доверяет только своему хранилищу.
 * Если сертификат не принят, повторяем запрос без проверки — данные всё равно
 * публичные котировки. Отключается переменной BOOKS_INSECURE_FALLBACK=0.
 */
const INSECURE_ALLOWED = process.env.BOOKS_INSECURE_FALLBACK !== "0";
let insecureWarned = false;

const isCertError = (e: unknown) => {
  const anyE = e as any;
  const code = anyE?.cause?.code || anyE?.code || "";
  const msg = String(anyE?.message || "");
  return /CERT|VERIFY|SIGNATURE|SELF_SIGNED|DEPTH_ZERO|UNABLE_TO_VERIFY/i.test(`${code} ${msg}`);
};

function httpsGetText(url: string, timeoutMs: number, headers: Record<string, string>): Promise<string> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request(
      {
        host: u.hostname,
        path: `${u.pathname}${u.search}`,
        method: "GET",
        port: 443,
        rejectUnauthorized: false,
        headers,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () =>
          resolve(decodeBody(Buffer.concat(chunks), (res.headers["content-encoding"] || "").toLowerCase()))
        );
      }
    );
    req.setTimeout(timeoutMs, () => req.destroy(new Error("timeout")));
    req.once("error", reject);
    req.end();
  });
}

/** Человекочитаемое описание сетевой ошибки */
export function describeFetchError(e: unknown, timeoutMs = REQUEST_TIMEOUT_MS): string {
  const anyE = e as any;
  const name = anyE?.name || "";
  if (name === "AbortError" || /abort/i.test(name)) return `Таймаут ${Math.round(timeoutMs / 1000)} с`;
  const code = anyE?.cause?.code || anyE?.code || "";
  const msg = String(anyE?.message || e || "Неизвестная ошибка");
  if (/ENOTFOUND|EAI_AGAIN/.test(code + msg)) return `DNS: адрес не найден (${code || "ENOTFOUND"})`;
  if (/ECONNREFUSED/.test(code + msg)) return "Соединение отклонено (порт закрыт)";
  if (/ECONNRESET/.test(code + msg)) return "Соединение сброшено (похоже на блокировку)";
  if (/ETIMEDOUT|ESOCKETTIMEDOUT|UND_ERR_CONNECT_TIMEOUT|timeout/i.test(code + msg))
    return `Таймаут ${Math.round(timeoutMs / 1000)} с`;
  if (/CERT|VERIFY|SIGNATURE|SELF_SIGNED|DEPTH_ZERO/i.test(code + msg))
    return `Сертификат не принят (${code || msg}) — похоже, HTTPS перехватывает антивирус`;
  return msg.slice(0, 160);
}

export async function getJson<T>(
  url: string,
  signal: AbortSignal,
  headers: Record<string, string> = {},
  opts: { timeoutMs?: number; retries?: number } = {}
): Promise<T> {
  const timeoutMs = opts.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const retries = opts.retries ?? 1;
  let lastErr: unknown = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (signal?.aborted) throw new BookError("Запрос отменён");

    const ctrl = new AbortController();
    const onAbort = () => ctrl.abort();
    signal?.addEventListener?.("abort", onAbort, { once: true });
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);

    try {
      const res = await fetch(url, {
        signal: ctrl.signal,
        headers: browserHeaders(url, headers),
        cache: "no-store",
      });

      if (!res.ok) {
        const body = await peekBody(res);
        const err = new BookError(`HTTP ${res.status}${body ? ` — ${body}` : ""}`);
        if (res.status >= 500 && attempt < retries) {
          lastErr = err;
          continue;
        }
        throw err;
      }

      const buf = Buffer.from(await res.arrayBuffer());
      const enc = (res.headers.get("content-encoding") || "").toLowerCase();
      const text = decodeBody(buf, enc);

      try {
        return JSON.parse(text) as T;
      } catch {
        const ct = res.headers.get("content-type") || "тип не указан";
        throw new BookError(`Ответ не JSON (${ct}) — «${text.replace(/\s+/g, " ").slice(0, 80)}»`);
      }
    } catch (e) {
      lastErr = e;
      if (e instanceof BookError) throw e;

      // сертификат не принят — пробуем без проверки (перехват антивирусом)
      if (INSECURE_ALLOWED && isCertError(e)) {
        try {
          const text = await httpsGetText(url, timeoutMs, browserHeaders(url, headers));
          if (!insecureWarned) {
            insecureWarned = true;
            console.warn(
              "[books] ВНИМАНИЕ: сертификат конторы не прошёл проверку — соединение выполнено без проверки. " +
                "Похоже, HTTPS перехватывает антивирус или прокси. Отключить обход: BOOKS_INSECURE_FALLBACK=0"
            );
          }
          return JSON.parse(text) as T;
        } catch {
          /* ниже бросим обычную ошибку */
        }
      }

      const retryable = !/abort/i.test(String((e as any)?.name || ""));
      if (retryable && attempt < retries) {
        await new Promise((r) => setTimeout(r, 250));
        continue;
      }
      throw new BookError(describeFetchError(e, timeoutMs));
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener?.("abort", onAbort);
    }
  }

  throw lastErr instanceof BookError ? lastErr : new BookError(describeFetchError(lastErr, timeoutMs));
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
        if (t.length > 3 && u.length > 3 && (t.startsWith(u.slice(0, 4)) || u.startsWith(u.slice(0, 4)))) {
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
