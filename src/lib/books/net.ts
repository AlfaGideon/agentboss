/**
 * Сетевой слой для запросов к фидам контор.
 *
 * Зачем свой слой вместо обычного fetch():
 *
 *  1) Свой резолвер адресов. Если DNS провайдера не находит имя конторы
 *     (ошибка ENOTFOUND), оно разрешается через резерв: системный DNS →
 *     обычный DNS по UDP (8.8.8.8, 1.1.1.1, 77.88.8.8, 9.9.9.9) →
 *     DNS-over-HTTPS по жёстко прописанным IP (Яндекс, AdGuard, Google,
 *     Cloudflare). Ошибка «адрес не найден» больше не приговор: приложение
 *     само находит адрес и сообщает, через какой резолвер это вышло.
 *
 *  2) Соединение выполняется по найденному IP, но с правильным SNI и Host,
 *     поэтому сайты контор видят обычный запрос.
 *
 *  3) Антивирусы (Касперский, Dr.Web, ESET) и корпоративные прокси
 *     подменяют сертификат сайта. Если проверка сертификата не прошла,
 *     запрос повторяется без проверки — данные всё равно публичные
 *     котировки. Отключается переменной BOOKS_INSECURE_FALLBACK=0.
 */

import dns from "node:dns";
import https from "node:https";
import { AsyncLocalStorage } from "node:async_hooks";
import { gunzipSync, inflateSync, brotliDecompressSync } from "node:zlib";

export const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

/** Сколько ждём ответа от одного адреса (мс) */
export const REQUEST_TIMEOUT_MS = 8000;

/** Сколько ждём системный DNS, прежде чем идти в резервные (мс) */
const SYSTEM_DNS_TIMEOUT_MS = 2000;
const UDP_DNS_TIMEOUT_MS = 2500;
const DOH_TIMEOUT_MS = 3500;

/** Жёсткие IP-адреса DNS-over-HTTPS: их не нужно резолвить, они и есть резерв */
const DOH_PROVIDERS: { name: string; host: string; ips: string[]; path: (name: string, type: string) => string }[] = [
  {
    name: "Яндекс.DNS",
    host: "common.dot.dns.yandex.net",
    ips: ["77.88.8.8", "77.88.8.1"],
    path: (n, t) => `/resolve?name=${encodeURIComponent(n)}&type=${t}`,
  },
  {
    name: "AdGuard DNS",
    host: "dns.adguard-dns.com",
    ips: ["94.140.14.14", "94.140.15.15"],
    path: (n, t) => `/resolve?name=${encodeURIComponent(n)}&type=${t}`,
  },
  {
    name: "Google DNS",
    host: "dns.google",
    ips: ["8.8.8.8", "8.8.4.4"],
    path: (n, t) => `/resolve?name=${encodeURIComponent(n)}&type=${t}`,
  },
  {
    name: "Cloudflare",
    host: "cloudflare-dns.com",
    ips: ["1.1.1.1", "1.0.0.1"],
    path: (n, t) => `/dns-query?name=${encodeURIComponent(n)}&type=${t}`,
  },
];

/** Резервные DNS-серверы для обычного UDP-запроса */
const UDP_SERVERS = ["8.8.8.8", "1.1.1.1", "77.88.8.8", "9.9.9.9"];

const OK_TTL_MS = 5 * 60 * 1000;
const FAIL_TTL_MS = 60 * 1000;

/**
 * Настройки на время одного HTTP-запроса к API приложения (например,
 * «проверять только системный DNS»). Передаются через AsyncLocalStorage,
 * чтобы не протаскивать параметр через каждый адаптер конторы.
 */
type NetContext = { noDnsFallback?: boolean };
const netContext = new AsyncLocalStorage<NetContext>();

export function withNetOptions<T>(opts: NetContext, fn: () => Promise<T>): Promise<T> {
  return netContext.run(opts, fn);
}

const contextNoFallback = (explicit?: boolean): boolean =>
  explicit ?? netContext.getStore()?.noDnsFallback ?? false;

export const DNS_FALLBACK_DISABLED = process.env.BOOKS_DNS_FALLBACK === "0";
const INSECURE_ALLOWED = process.env.BOOKS_INSECURE_FALLBACK !== "0";

export class NetError extends Error {
  code: string;
  host?: string;
  details?: string;
  tried?: string[];
  constructor(code: string, message: string, extra: { host?: string; details?: string; tried?: string[] } = {}) {
    super(message);
    this.name = "NetError";
    this.code = code;
    this.host = extra.host;
    this.details = extra.details;
    this.tried = extra.tried;
  }
}

const isIpAddress = (h: string) =>
  /^\d{1,3}(\.\d{1,3}){3}$/.test(h) || (h.includes(":") && /^[0-9a-fA-F:.]+$/.test(h));

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout;
  return Promise.race([
    p,
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new NetError("ETIMEDOUT", `${label}: таймаут ${ms} мс`)), ms);
    }),
  ]).finally(() => clearTimeout(timer)) as Promise<T>;
}

/* ─────────────────────────── DNS ─────────────────────────── */

export type Resolved = { ip: string; via: string };

const resolveCache = new Map<string, { ans: Resolved | null; ts: number }>();

/** Системный резолвер (тот же, что у браузера: /etc/hosts, DNS провайдера, VPN) */
function systemLookup(host: string): Promise<string> {
  return new Promise((resolve, reject) => {
    dns.lookup(host, { all: true }, (err, addrs) => {
      if (err) return reject(err);
      if (!addrs?.length) return reject(new NetError("ENOTFOUND", `системный DNS не нашёл ${host}`));
      const v4 = addrs.find((a) => a.family === 4);
      resolve((v4 ?? addrs[0]).address);
    });
  });
}

/** Обычный DNS по UDP через конкретный сервер */
function udpLookup(host: string, server: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const resolver = new dns.Resolver({ timeout: 2000, tries: 1 });
    try {
      resolver.setServers([server]);
    } catch (e) {
      return reject(e as Error);
    }
    let done = false;
    const finish = (fn: () => void) => {
      if (done) return;
      done = true;
      try {
        resolver.cancel();
      } catch {}
      fn();
    };
    resolver.resolve4(host, (err, addrs) => {
      if (!err && addrs?.length) return finish(() => resolve(addrs[0]));
      resolver.resolve6(host, (err6, addrs6) => {
        if (!err6 && addrs6?.length) return finish(() => resolve(addrs6[0]));
        const code = (err?.code || err6?.code || "ENOTFOUND") as string;
        finish(() => reject(new NetError(code, `UDP ${server} не нашёл ${host}`)));
      });
    });
  });
}

type DohAnswer = { Status?: number; Answer?: { type: number; data: string }[] };

/** DNS-over-HTTPS: запрос идёт прямо на IP сервиса, поэтому DNS для него не нужен */
async function dohLookup(
  host: string,
  provider: (typeof DOH_PROVIDERS)[number],
  depth = 0
): Promise<{ ip: string; via: string; nxdomain?: boolean }> {
  let lastErr: unknown = new Error("нет ответа");
  for (const ip of provider.ips) {
    for (const type of ["A", "AAAA"]) {
      try {
        const res = await httpGet(`https://${provider.host}${provider.path(host, type)}`, {
          connectIp: ip,
          timeoutMs: DOH_TIMEOUT_MS,
          headers: { Accept: "application/dns-json" },
          maxRedirects: 0,
        });
        const data = JSON.parse(res.text) as DohAnswer;
        if (data?.Status === 3) {
          return { ip: "", via: provider.name, nxdomain: true };
        }
        const answers = data?.Answer || [];
        const a = answers.find((x) => x.type === 1);
        if (a?.data) return { ip: a.data, via: provider.name };
        const aaaa = answers.find((x) => x.type === 28);
        if (aaaa?.data) return { ip: aaaa.data, via: provider.name };
        const cname = answers.find((x) => x.type === 5);
        if (cname?.data && depth < 3) {
          const next = await dohLookup(cname.data.replace(/\.$/, ""), provider, depth + 1);
          if (next.ip) return next;
          if (next.nxdomain) return next;
        }
        lastErr = new Error(`${provider.name}: запись не найдена (${type})`);
      } catch (e) {
        lastErr = e;
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/**
 * Найти адрес хоста. Сначала системный DNS (быстро), затем — если он не смог —
 * UDP-серверы и DNS-over-HTTPS. Результат кэшируется.
 */
export async function resolveHost(
  host: string,
  opts: { fallback?: boolean; fresh?: boolean } = {}
): Promise<Resolved> {
  if (isIpAddress(host)) return { ip: host, via: "IP" };

  const fallback = opts.fallback ?? (!DNS_FALLBACK_DISABLED && !contextNoFallback());
  const key = `${host}|${fallback ? "f" : "s"}`;
  const cached = resolveCache.get(key);
  if (cached && !opts.fresh) {
    const ttl = cached.ans ? OK_TTL_MS : FAIL_TTL_MS;
    if (Date.now() - cached.ts < ttl) {
      if (cached.ans) return cached.ans;
      throw new NetError("ENOTFOUND", `Адрес ${host} не найден (повторная проверка не раньше, чем через минуту)`);
    }
  }

  // 1. системный DNS
  try {
    const ip = await withTimeout(systemLookup(host), SYSTEM_DNS_TIMEOUT_MS, "системный DNS");
    const ans = { ip, via: "системный DNS" };
    resolveCache.set(key, { ans, ts: Date.now() });
    return ans;
  } catch {
    /* идём в резерв */
  }

  if (fallback) {
    // 2. обычный DNS по UDP к публичным серверам (все параллельно, кто первый)
    try {
      const winner = await firstSuccess(
        UDP_SERVERS.map((s) => () =>
          withTimeout(udpLookup(host, s), UDP_DNS_TIMEOUT_MS, `UDP ${s}`).then((ip) => ({
            ip,
            via: `DNS ${s}`,
          }))
        )
      );
      resolveCache.set(key, { ans: winner, ts: Date.now() });
      return winner;
    } catch {
      /* идём в DoH */
    }

    // 3. DNS-over-HTTPS по IP
    try {
      const winner = await firstSuccess(
        DOH_PROVIDERS.map((p) => async () => {
          const r = await dohLookup(host, p);
          if (r.nxdomain || !r.ip) throw new NetError("ENOTFOUND", `${p.name}: адрес ${host} не существует`);
          return { ip: r.ip, via: `${p.name} (DNS-over-HTTPS)` };
        })
      );
      resolveCache.set(key, { ans: winner, ts: Date.now() });
      return winner;
    } catch {
      /* ниже общая ошибка */
    }
  }

  resolveCache.set(key, { ans: null, ts: Date.now() });
  throw new NetError("ENOTFOUND", `DNS: адрес не найден (ENOTFOUND) — ${host}`, {
    host,
    details: fallback
      ? "проверено: системный DNS, " +
        UDP_SERVERS.join(", ") +
        ", DNS-over-HTTPS (Яндекс, AdGuard, Google, Cloudflare)"
      : "резервный DNS выключен — проверен только системный DNS",
  });
}

/** Первый успешный результат из списка задач, остальные отменяются */
async function firstSuccess<T>(tasks: (() => Promise<T>)[]): Promise<T> {
  if (!tasks.length) throw new Error("нет задач");
  return new Promise<T>((resolve, reject) => {
    let pending = tasks.length;
    const errors: unknown[] = [];
    for (const task of tasks) {
      task().then(resolve, (e) => {
        errors.push(e);
        if (--pending === 0) reject(errors[0] ?? new Error("все проверки не удались"));
      });
    }
  });
}

/* ─────────────────────────── HTTP(S) ─────────────────────────── */

export type HttpResult = {
  status: number;
  text: string;
  headers: Record<string, any>;
  /** финальный адрес после редиректов */
  url: string;
  /** адрес, с которым соединились */
  ip: string;
  /** как найден адрес: системный DNS / DNS 8.8.8.8 / Яндекс (DNS-over-HTTPS) */
  dnsVia: string;
  /** соединение прошло без проверки сертификата (перехват антивирусом) */
  insecure: boolean;
};

export type HttpOptions = {
  headers?: Record<string, string>;
  timeoutMs?: number;
  signal?: AbortSignal;
  /** соединиться с этим IP, минуя DNS */
  connectIp?: string;
  /** запретить резервный DNS для этого запроса */
  noDnsFallback?: boolean;
  maxRedirects?: number;
};

function decodeBody(buf: Buffer, enc: string): string {
  try {
    if (enc === "gzip") return gunzipSync(buf).toString("utf8");
    if (enc === "deflate") return inflateSync(buf).toString("utf8");
    if (enc === "br") return brotliDecompressSync(buf).toString("utf8");
  } catch {}
  // сервер мог отдать .gz файлом, без заголовка Content-Encoding
  if (buf.length > 2 && buf[0] === 0x1f && buf[1] === 0x8b) {
    try {
      return gunzipSync(buf).toString("utf8");
    } catch {}
  }
  return buf.toString("utf8");
}

const isCertError = (e: unknown) => {
  const anyE = e as any;
  const code = anyE?.code || "";
  const msg = String(anyE?.message || "");
  return /CERT|VERIFY|SIGNATURE|SELF_SIGNED|DEPTH_ZERO|UNABLE_TO_VERIFY/i.test(`${code} ${msg}`);
};

let insecureWarned = false;

/** Один запрос без редиректов: соединение по IP, SNI и Host — по имени */
function requestOnce(
  target: URL,
  ip: string,
  headers: Record<string, string>,
  timeoutMs: number,
  signal: AbortSignal | undefined,
  rejectUnauthorized: boolean
): Promise<{ status: number; headers: Record<string, any>; buf: Buffer; insecure: boolean }> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const req = https.request(
      {
        host: ip,
        port: target.port ? Number(target.port) : 443,
        path: `${target.pathname}${target.search}`,
        method: "GET",
        servername: target.hostname,
        rejectUnauthorized,
        headers: { Host: target.host, ...headers },
        agent: false,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c as Buffer));
        res.on("end", () => {
          if (settled) return;
          settled = true;
          resolve({
            status: res.statusCode || 0,
            headers: res.headers as Record<string, any>,
            buf: Buffer.concat(chunks),
            insecure: !rejectUnauthorized,
          });
        });
        res.on("error", (e) => {
          if (settled) return;
          settled = true;
          reject(e);
        });
      }
    );

    const fail = (e: unknown) => {
      if (settled) return;
      settled = true;
      req.destroy();
      reject(e);
    };

    req.setTimeout(timeoutMs, () => fail(new NetError("ETIMEDOUT", `Таймаут ${Math.round(timeoutMs / 1000)} с`)));
    req.once("error", fail);
    const onAbort = () => fail(new NetError("ABORTED", "Запрос отменён"));
    if (signal) {
      if (signal.aborted) return fail(new NetError("ABORTED", "Запрос отменён"));
      signal.addEventListener("abort", onAbort, { once: true });
      req.once("close", () => signal.removeEventListener("abort", onAbort));
    }
    req.end();
  });
}

/** GET с разбором редиректов, сжатия и ошибок сертификата */
export async function httpGet(rawUrl: string, opts: HttpOptions = {}): Promise<HttpResult> {
  const timeoutMs = opts.timeoutMs ?? REQUEST_TIMEOUT_MS;
  let url = new URL(rawUrl);
  let maxRedirects = opts.maxRedirects ?? 3;
  let dnsVia = "IP";
  let insecure = false;
  let ip = opts.connectIp || "";

  for (;;) {
    if (url.protocol !== "https:") {
      throw new NetError("EPROTO", `Небезопасный адрес: ${url.href}`);
    }
    if (!ip) {
      const resolved = await resolveHost(url.hostname, { fallback: !contextNoFallback(opts.noDnsFallback) });
      ip = resolved.ip;
      dnsVia = resolved.via;
    }

    const headers = { ...opts.headers };
    let res: { status: number; headers: Record<string, any>; buf: Buffer; insecure: boolean };
    try {
      res = await requestOnce(url, ip, headers, timeoutMs, opts.signal, true);
    } catch (e) {
      if (INSECURE_ALLOWED && isCertError(e)) {
        res = await requestOnce(url, ip, headers, timeoutMs, opts.signal, false);
        insecure = true;
        if (!insecureWarned) {
          insecureWarned = true;
          console.warn(
            "[books] ВНИМАНИЕ: сертификат не прошёл проверку — соединение выполнено без проверки. " +
              "Похоже, HTTPS перехватывает антивирус или прокси. Отключить обход: BOOKS_INSECURE_FALLBACK=0"
          );
        }
      } else {
        throw e;
      }
    }

    const location = res.headers?.location;
    if (location && [301, 302, 303, 307, 308].includes(res.status) && maxRedirects > 0) {
      const next = new URL(String(location), url);
      if (next.hostname !== url.hostname) {
        const resolved = await resolveHost(next.hostname, { fallback: !contextNoFallback(opts.noDnsFallback) });
        ip = resolved.ip;
        dnsVia = resolved.via;
      }
      url = next;
      maxRedirects--;
      continue;
    }

    const enc = String(res.headers?.["content-encoding"] || "").toLowerCase();
    return {
      status: res.status,
      text: decodeBody(res.buf, enc),
      headers: res.headers,
      url: url.href,
      ip,
      dnsVia,
      insecure: res.insecure,
    };
  }
}

/** Заголовки «как у браузера»: витрины контор отвечают 403 на голый запрос */
export function browserHeaders(url: string, extra: Record<string, string> = {}): Record<string, string> {
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

/** Человекочитаемое описание сетевой ошибки */
export function describeNetError(e: unknown, timeoutMs = REQUEST_TIMEOUT_MS): string {
  const anyE = e as any;
  if (e instanceof NetError && e.code === "ABORTED") return "Запрос отменён (общий таймаут)";
  const name = anyE?.name || "";
  if (name === "AbortError" || /abort/i.test(name)) return `Таймаут ${Math.round(timeoutMs / 1000)} с`;

  if (e instanceof NetError && e.code === "ENOTFOUND") {
    return e.details ? `${e.message} — ${e.details}` : e.message;
  }

  const code = anyE?.code || anyE?.cause?.code || "";
  const msg = String(anyE?.message || e || "Неизвестная ошибка");
  if (/ENOTFOUND|EAI_AGAIN/.test(code + msg)) return `DNS: адрес не найден (${code || "ENOTFOUND"})`;
  if (/ECONNREFUSED/.test(code + msg)) return "Соединение отклонено (порт закрыт)";
  if (/ECONNRESET/.test(code + msg)) return "Соединение сброшено (похоже на блокировку)";
  if (/EPROTO|EPROTOTYPE/.test(code)) return "Небезопасный адрес (нужен https)";
  if (/ETIMEDOUT|ESOCKETTIMEDOUT|UND_ERR_CONNECT_TIMEOUT|timeout/i.test(code + msg))
    return `Таймаут ${Math.round(timeoutMs / 1000)} с`;
  if (/CERT|VERIFY|SIGNATURE|SELF_SIGNED|DEPTH_ZERO/i.test(code + msg))
    return `Сертификат не принят (${code || msg}) — похоже, HTTPS перехватывает антивирус`;
  return msg.slice(0, 200);
}

export { isIpAddress };
