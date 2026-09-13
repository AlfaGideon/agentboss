import {
  REQUEST_TIMEOUT_MS,
  UA,
  browserHeaders,
  describeNetError,
  httpGet,
  isIpAddress,
} from "./net";

export { REQUEST_TIMEOUT_MS, UA };

export class BookError extends Error {}

/** Итог попытки по одному адресу — показывается в «Настройках» для разбора */
export type TriedEndpoint = {
  url: string;
  ok: boolean;
  error?: string;
  /** как нашли адрес: системный DNS, DNS 8.8.8.8, Яндекс (DNS-over-HTTPS) */
  dnsVia?: string;
  /** сертификат подменили, соединение прошло без проверки */
  insecure?: boolean;
};

export type Loaded<T> = {
  data: T;
  url: string;
  dnsVia?: string;
  insecure?: boolean;
  tried: TriedEndpoint[];
};

export type JsonOptions = {
  timeoutMs?: number;
  retries?: number;
  /** запретить резервный DNS (нужен, например, чтобы проверить только системный) */
  noDnsFallback?: boolean;
  /** метод запроса: POST нужен Лиге Ставок (eventsList) */
  method?: "GET" | "POST";
  /** тело запроса для POST */
  body?: string;
};

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
};

const short = (s: string, n = 110) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Убираем повтор имени хоста: в списке адрес и так указан целиком */
const withoutHost = (url: string, msg: string) => msg.split(` — ${hostOf(url)}`).join("");

/**
 * Один JSON-запрос. Если DNS не находит адрес, имя разрешается через резервные
 * серверы (UDP и DNS-over-HTTPS) — см. net.ts.
 */
export async function getJson<T>(
  url: string,
  signal: AbortSignal,
  headers: Record<string, string> = {},
  opts: JsonOptions = {}
): Promise<T> {
  const timeoutMs = opts.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const retries = opts.retries ?? 1;
  let lastErr: unknown = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (signal?.aborted) throw new BookError("Запрос отменён");

    try {
      const res = await httpGet(url, {
        headers: browserHeaders(url, headers),
        timeoutMs,
        signal,
        noDnsFallback: opts.noDnsFallback,
        method: opts.method,
        body: opts.body,
      });

      if (res.status < 200 || res.status >= 300) {
        const body = res.text.replace(/\s+/g, " ").slice(0, 120);
        const err = new BookError(`HTTP ${res.status}${body ? ` — ${body}` : ""}`);
        if (res.status >= 500 && attempt < retries) {
          lastErr = err;
          continue;
        }
        throw err;
      }

      try {
        return JSON.parse(res.text) as T;
      } catch {
        const ct = res.headers["content-type"] || "тип не указан";
        throw new BookError(
          `Ответ не JSON (${ct}) — «${res.text.replace(/\s+/g, " ").slice(0, 80)}»`
        );
      }
    } catch (e) {
      lastErr = e;
      if (e instanceof BookError) throw e;
      if ((e as any)?.code === "ABORTED" || /abort/i.test(String((e as any)?.name || ""))) {
        throw new BookError(describeNetError(e, timeoutMs));
      }
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 250));
        continue;
      }
      throw new BookError(describeNetError(e, timeoutMs));
    }
  }

  throw lastErr instanceof BookError
    ? lastErr
    : new BookError(describeNetError(lastErr, timeoutMs));
}

/** Кэш рабочего зеркала: не дёргаем «мёртвые» адреса на каждом обновлении */
const winnerCache = new Map<string, { url: string; ts: number }>();
const WINNER_TTL_MS = 10 * 60 * 1000;

export function forgetEndpoint(key: string) {
  winnerCache.delete(key);
}

/**
 * Кэш распарсенного ответа и очередь параллельных запросов одного фида.
 *
 * Скан по нескольким видам спорта спрашивает у конторы одну и ту же полную
 * линию (Фонбет, Марафон, ПАРИ, Олимп, Леон отдают всё сразу). Чтобы не качать
 * мегабайтный фид восемь раз, ответ хранится DATA_TTL_MS, а одновременные
 * обращения ждут один и тот же запрос.
 */
const DATA_TTL_MS = 20 * 1000;
const dataCache = new Map<string, { data: unknown; url: string; dnsVia?: string; insecure?: boolean; ts: number }>();
const inFlight = new Map<string, Promise<Loaded<unknown>>>();

export function forgetFeeds() {
  dataCache.clear();
}

/**
 * Опрос нескольких адресов-зеркал одной конторы.
 *
 * Адреса проверяются параллельно, берётся первый, который ответил валидными
 * данными; остальные запросы отменяются. Рабочий адрес запоминается на 10 минут,
 * поэтому обычные обновления линии идут в один запрос, а не перебирают зеркала
 * по очереди с таймаутами.
 *
 * Ошибка выдаётся одна на контору и перечисляет причины по каждому адресу —
 * в интерфейсе видно, что именно случилось, а не «DNS: адрес не найден»
 * от последнего адреса в списке.
 */
export async function getJsonFirst<T>(
  urls: string[],
  signal: AbortSignal,
  opts: {
    headers?: Record<string, string>;
    timeoutMs?: number;
    isValid?: (d: T) => boolean;
    cacheKey?: string;
    noDnsFallback?: boolean;
    method?: "GET" | "POST";
    body?: string;
    /** не использовать кэш данных (для принудительного обновления) */
    noDataCache?: boolean;
  } = {}
): Promise<Loaded<T>> {
  const timeoutMs = opts.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const list = [...new Set(urls.filter(Boolean))];
  if (!list.length) throw new BookError("Не задан ни один адрес источника");

  const valid = (d: T) => {
    if (d == null) return false;
    if (opts.isValid) return opts.isValid(d);
    if (Array.isArray(d)) return d.length > 0;
    return true;
  };

  // 0. недавний ответ того же фида — не качаем повторно
  const cacheKey = opts.cacheKey
    ? opts.method === "POST"
      ? `${opts.cacheKey}#${opts.body ?? ""}`
      : opts.cacheKey
    : undefined;
  if (cacheKey && !opts.noDataCache) {
    const hit = dataCache.get(cacheKey);
    if (hit && Date.now() - hit.ts < DATA_TTL_MS) {
      return { data: hit.data as T, url: hit.url, dnsVia: hit.dnsVia, insecure: hit.insecure, tried: [] };
    }
    // параллельный запрос того же фида уже идёт — ждём его, а не плодим копии
    const going = inFlight.get(cacheKey);
    if (going) {
      const res = (await going) as Loaded<T>;
      if (valid(res.data)) return res;
    }
  }

  const doFetch = async (): Promise<Loaded<T>> => {
  const tried: TriedEndpoint[] = [];

  const attempt = async (url: string, ctrl: AbortController): Promise<Loaded<T>> => {
    try {
      const res = await httpGet(url, {
        headers: browserHeaders(url, opts.headers),
        timeoutMs,
        signal: ctrl.signal,
        noDnsFallback: opts.noDnsFallback,
        method: opts.method,
        body: opts.body,
      });
      if (res.status < 200 || res.status >= 300) {
        const body = res.text.replace(/\s+/g, " ").slice(0, 100);
        throw new Error(`HTTP ${res.status}${body ? ` — ${body}` : ""}`);
      }
      let data: T;
      try {
        data = JSON.parse(res.text) as T;
      } catch {
        const ct = res.headers["content-type"] || "тип не указан";
        throw new Error(`Ответ не JSON (${ct}) — «${res.text.replace(/\s+/g, " ").slice(0, 60)}»`);
      }
      if (!valid(data)) throw new Error("Ответ пустой (нет событий)");
      tried.push({ url, ok: true, dnsVia: res.dnsVia, insecure: res.insecure });
      if (cacheKey) winnerCache.set(cacheKey, { url, ts: Date.now() });
      return { data, url, dnsVia: res.dnsVia, insecure: res.insecure, tried };
    } catch (e) {
      // в список «проверено адресов» идёт короткая причина без повторов имени хоста
      const msg = e instanceof Error && (e as any).code === "ENOTFOUND" ? e.message : describeNetError(e, timeoutMs);
      const compact = withoutHost(url, msg);
      tried.push({ url, ok: false, error: compact });
      throw new Error(compact);
    }
  };

  // 1. быстрый путь: недавно рабочий адрес
  const known = cacheKey ? winnerCache.get(cacheKey) : undefined;
  if (known && Date.now() - known.ts < WINNER_TTL_MS && list.includes(known.url)) {
    const ctrl = new AbortController();
    const onAbort = () => ctrl.abort();
    signal?.addEventListener?.("abort", onAbort, { once: true });
    try {
      return await attempt(known.url, ctrl);
    } catch {
      winnerCache.delete(cacheKey!);
      tried.length = 0;
    } finally {
      signal?.removeEventListener?.("abort", onAbort);
    }
  }

  // 2. параллельная проверка всех зеркал
  const ctrls = list.map(() => new AbortController());
  const onAbort = () => ctrls.forEach((c) => c.abort());
  signal?.addEventListener?.("abort", onAbort, { once: true });

  try {
    const result = await new Promise<Loaded<T>>((resolve, reject) => {
      let pending = list.length;
      list.forEach((url, i) => {
        attempt(url, ctrls[i]).then(
          (ok) => {
            ctrls.forEach((c, j) => j !== i && c.abort());
            resolve(ok);
          },
          () => {
            if (--pending === 0) reject(new Error("все адреса недоступны"));
          }
        );
      });
    });
    return result;
  } catch {
    if (signal?.aborted) throw new BookError("Запрос отменён (общий таймаут)");
    const failed = tried.filter((t) => !t.ok);
    const parts = failed.map((t) => {
      const host = hostOf(t.url);
      const reason = short(t.error || "ошибка", 70);
      return reason.includes(host) ? reason : `${host} — ${reason}`;
    });
    const reasons = [...new Set(parts)].slice(0, 3).join("; ");
    const allDns = failed.length > 0 && failed.every((t) => /адрес не найден/i.test(t.error || ""));
    const err = new BookError(
      `Ни один адрес не ответил (${list.length}): ${short(reasons, 240)}` +
        (allDns ? ". Адрес не нашли ни системный DNS, ни резервные (8.8.8.8, 1.1.1.1, 77.88.8.8), ни DNS-over-HTTPS" : "")
    ) as BookError & { tried?: TriedEndpoint[] };
    err.tried = tried.slice();
    throw err;
  } finally {
    ctrls.forEach((c) => c.abort());
    signal?.removeEventListener?.("abort", onAbort);
  }
  };

  // кэш/дедупликация: несколько видов спорта в одном скане делят один ответ фида
  if (!cacheKey || opts.noDataCache) return doFetch();
  const p = doFetch().then(
    (res) => {
      dataCache.set(cacheKey, {
        data: res.data,
        url: res.url,
        dnsVia: res.dnsVia,
        insecure: res.insecure,
        ts: Date.now(),
      });
      inFlight.delete(cacheKey);
      return res;
    },
    (e) => {
      inFlight.delete(cacheKey);
      throw e;
    }
  );
  inFlight.set(cacheKey, p as Promise<Loaded<unknown>>);
  return p;
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

export { isIpAddress, describeNetError as describeFetchError };
