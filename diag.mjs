#!/usr/bin/env node
/**
 * Диагностика доступа к линиям букмекеров.
 * Запуск:  node Диагностика.mjs
 * Никаких зависимостей — только встроенные модули Node.js.
 *
 * Что делает для каждого адреса:
 *   DNS  — резолвится ли хост и за сколько
 *   TCP  — соединяемся ли на 443
 *   TLS  — проходит ли рукопожатие, какой протокол и центр сертификации
 *   HTTP — статус, content-type, первые байты ответа
 * Дополнительно проверяет тот же адрес через fetch() (undici), как его
 * дергает само приложение, и сравнивает результат.
 */

import dns from "node:dns";
import net from "node:net";
import tls from "node:tls";
import https from "node:https";
import zlib from "node:zlib";
import { writeFileSync } from "node:fs";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const TIMEOUT = 8000;

/** Адреса, которые реально используются в приложении (src/lib/books/*) */
const TARGETS = [
  { book: "контроль", host: "api.github.com", path: "/" },
  { book: "Фонбет", host: "line-static01.bkfon-resources.com", path: "/line/currentLine/ru/0.json" },
  { book: "Фонбет", host: "line11.bkfon-resources.com", path: "/line/currentLine/ru/0.json" },
  { book: "Фонбет", host: "line.bkfon-resources.com", path: "/line/currentLine/ru/0.json" },
  { book: "Фонбет", host: "line-static01.bkfon-resources.com", path: "/line/currentLine/ru/0.json.gz" },
  { book: "Фонбет", host: "fon.bet", path: "/" },
  { book: "Лига Ставок", host: "api.ligastavok.ru", path: "/api/v1/line/events?sportIds=1&limit=5" },
  { book: "Лига Ставок", host: "ligastavok.ru", path: "/api/v1/line/events?sportIds=1&limit=5" },
  { book: "Лига Ставок", host: "www.ligastavok.ru", path: "/" },
  { book: "Winline", host: "wl-nsk.winline.ru", path: "/betting/api/v1/line/sport/1/events" },
  { book: "Winline", host: "winline.ru", path: "/betting/api/v1/line/sport/1/events" },
  { book: "Winline", host: "winline.ru", path: "/" },
  { book: "Олимп", host: "api.olimp.bet", path: "/api/v3/line/sports" },
  { book: "Олимп", host: "olimp.bet", path: "/api/v3/line/sports" },
  { book: "Олимп", host: "olimp.bet", path: "/" },
  { book: "БетБум", host: "betboom.ru", path: "/api/v2/line/events?sportId=1" },
  { book: "БетБум", host: "api.betboom.ru", path: "/v1/line/sport/1/events" },
  { book: "БетБум", host: "betboom.ru", path: "/" },
  { book: "Марафон", host: "www.marathonbet.ru", path: "/su/betting/json/sport/8" },
  { book: "Марафон", host: "www.marathonbet.ru", path: "/" },
  { book: "ПАРИ", host: "pari.ru", path: "/api/v1/line/sport/1/events" },
  { book: "ПАРИ", host: "pari.ru", path: "/" },
  { book: "Зенитбет", host: "zenit.win", path: "/api/v1/line/sport/1/events" },
  { book: "Зенитбет", host: "zenit.win", path: "/" },
];

const out = [];
const log = (s = "") => {
  out.push(s);
  try {
    console.log(s);
  } catch {}
};

const withTimeout = (p, ms, label) =>
  Promise.race([
    p,
    new Promise((_, rej) => setTimeout(() => rej(new Error(`таймаут ${ms} мс (${label})`)), ms)),
  ]);

function dnsLookup(host) {
  const t0 = Date.now();
  return withTimeout(
    new Promise((resolve) => {
      dns.lookup(host, { all: true }, (err, addrs) => {
        if (err) return resolve({ ok: false, ms: Date.now() - t0, error: err.code || err.message });
        resolve({
          ok: true,
          ms: Date.now() - t0,
          addrs: addrs.map((a) => `${a.address}${a.family === 6 ? " (IPv6)" : ""}`),
        });
      });
    }),
    TIMEOUT,
    "DNS"
  ).catch((e) => ({ ok: false, ms: Date.now() - t0, error: e.message }));
}

function tcpConnect(host, port = 443) {
  const t0 = Date.now();
  return new Promise((resolve) => {
    const s = net.connect({ host, port });
    const done = (r) => {
      s.destroy();
      resolve({ ...r, ms: Date.now() - t0 });
    };
    s.setTimeout(TIMEOUT);
    s.once("connect", () => done({ ok: true }));
    s.once("timeout", () => done({ ok: false, error: `таймаут ${TIMEOUT} мс` }));
    s.once("error", (e) => done({ ok: false, error: e.code || e.message }));
  });
}

function tlsProbe(host, rejectUnauthorized = true) {
  const t0 = Date.now();
  return new Promise((resolve) => {
    const s = tls.connect({ host, port: 443, servername: host, rejectUnauthorized });
    const done = (r) => {
      s.destroy();
      resolve({ ...r, ms: Date.now() - t0 });
    };
    s.setTimeout(TIMEOUT);
    s.once("secureConnect", () => {
      const cert = s.getPeerCertificate(true);
      done({
        ok: true,
        authorized: s.authorized,
        authError: s.authorizationError || undefined,
        proto: s.getProtocol(),
        issuer: cert?.issuer?.O || cert?.issuer?.CN || "",
        cn: cert?.subject?.CN || "",
      });
    });
    s.once("timeout", () => done({ ok: false, error: `таймаут ${TIMEOUT} мс` }));
    s.once("error", (e) => done({ ok: false, error: `${e.code || ""} ${e.message}`.trim() }));
  });
}

function httpsGet(host, path) {
  const t0 = Date.now();
  return new Promise((resolve) => {
    const req = https.request(
      {
        host,
        path,
        method: "GET",
        port: 443,
        headers: {
          "User-Agent": UA,
          Accept: "application/json, text/plain, */*",
          "Accept-Language": "ru-RU,ru;q=0.9",
          "Accept-Encoding": "gzip, deflate",
          Referer: `https://${host}/`,
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => {
          if (chunks.length < 64) chunks.push(c);
        });
        res.on("end", () =>
          resolve({
            ok: true,
            ms: Date.now() - t0,
            status: res.statusCode,
            type: res.headers["content-type"] || "",
                encoding: res.headers["content-encoding"] || "",
            server: res.headers["server"] || "",
            chunk: decode(Buffer.concat(chunks), res.headers["content-encoding"]),
          })
        );
      }
    );
    req.setTimeout(TIMEOUT, () => req.destroy(new Error(`таймаут ${TIMEOUT} мс`)));
    req.once("error", (e) =>
      resolve({ ok: false, ms: Date.now() - t0, error: `${e.code ? e.code + " " : ""}${e.message}` })
    );
    req.end();
  });
}

function decode(buf, enc) {
  try {
    if (enc === "gzip") return zlib.gunzipSync(buf).toString("utf8").slice(0, 160);
    if (enc === "deflate") return zlib.inflateSync(buf).toString("utf8").slice(0, 160);
    if (enc === "br" && zlib.brotliDecompressSync) return zlib.brotliDecompressSync(buf).toString("utf8").slice(0, 160);
  } catch {}
  // сервер мог отдать .gz без заголовка Content-Encoding
  if (buf[0] === 0x1f && buf[1] === 0x8b) {
    try {
      return "gzip-файл: " + zlib.gunzipSync(buf).toString("utf8").slice(0, 120);
    } catch {
      return "gzip-файл (не распаковался)";
    }
  }
  return buf.toString("utf8").slice(0, 160);
}

async function fetchProbe(url) {
  const t0 = Date.now();
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        "User-Agent": UA,
        Accept: "application/json, text/plain, */*",
        "Accept-Language": "ru-RU,ru;q=0.9",
      },
      cache: "no-store",
    });
    const text = await res.text();
    clearTimeout(timer);
    return { ok: true, ms: Date.now() - t0, status: res.status, len: text.length, head: text.slice(0, 60) };
  } catch (e) {
    const cause = e.cause || {};
    return {
      ok: false,
      ms: Date.now() - t0,
      error: `${e.name}: ${e.message}${cause.code ? " [" + cause.code + "]" : ""}`,
    };
  }
}

async function probe(t) {
  const url = `https://${t.host}${t.path}`;
  const d = await dnsLookup(t.host);
  const line = { book: t.book, host: t.host, path: t.path, dns: d };

  if (!d.ok) {
    line.result = `НЕТ ДОСТУПА: DNS — ${d.error}`;
    return line;
  }
  const tcp = await tcpConnect(t.host);
  line.tcp = tcp;
  if (!tcp.ok) {
    line.result = `НЕТ ДОСТУПА: TCP — ${tcp.error}`;
    return line;
  }
  const tlsInfo = await tlsProbe(t.host);
  line.tls = tlsInfo;
  if (!tlsInfo.ok) {
    let extra = "";
    if (/CERT|VERIFY|SIGNATURE|SELF_SIGNED|DEPTH_ZERO/i.test(tlsInfo.error)) {
      const inc = await tlsProbe(t.host, false);
      if (inc.ok) {
        extra = ` | БЕЗ ПРОВЕРКИ СЕРТИФИКАТА СОЕДИНЕНИЕ ПРОХОДИТ (кем выпущен: ${inc.issuer}). ` +
          `Это значит, что трафик перехватывает антивирус или корпоративный прокси, а Node его ` +
          `корневому сертификату не доверяет. Лечится: выключить «проверку защищённых соединений» ` +
          `в антивирусе либо указать его сертификат через переменную NODE_EXTRA_CA_CERTS.`;
      }
    }
    line.result = `НЕТ ДОСТУПА: TLS — ${tlsInfo.error}${extra}`;
    return line;
  }
  if (!tlsInfo.authorized) {
    line.mitm = true;
  }
  const http = await httpsGet(t.host, t.path);
  line.http = http;
  line.fetch = await fetchProbe(url);

  if (http.ok && http.status === 200) {
    const looksJson = /^[\s\r\n]*[[{]/.test(http.chunk || "");
    line.result = looksJson
      ? `OK: JSON получен${tlsInfo.authorized ? "" : " (НО сертификат не доверен!)"}`
      : `ОТВЕТ НЕ JSON: ${http.type || "нет content-type"} — «${(http.chunk || "").replace(/\s+/g, " ").slice(0, 80)}»`;
  } else if (http.ok) {
    line.result = `HTTP ${http.status} (${http.server || "?"}) — «${(http.chunk || "").replace(/\s+/g, " ").slice(0, 80)}»`;
  } else {
    line.result = `НЕТ ДОСТУПА: запрос — ${http.error}`;
  }
  return line;
}

async function pool(items, limit, fn) {
  const res = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        res[idx] = await fn(items[idx]);
      }
    })
  );
  return res;
}

(async () => {
  log("════════════════════════════════════════════════════════════════════");
  log("  СТАВКА PRO — диагностика доступа к конторам");
  log("════════════════════════════════════════════════════════════════════");
  log(`  Дата:            ${new Date().toLocaleString("ru-RU")}`);
  log(`  Node.js:         ${process.version}  (${process.platform}/${process.arch})`);
  log(`  Таймаут:         ${TIMEOUT} мс`);
  const prox = ["HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy", "NO_PROXY"]
    .map((k) => (process.env[k] ? `${k}=${process.env[k]}` : null))
    .filter(Boolean);
  log(`  Прокси в окружении: ${prox.length ? prox.join(", ") : "нет (это нормально)"}`);
  log(`  NODE_TLS_REJECT_UNAUTHORIZED = ${process.env.NODE_TLS_REJECT_UNAUTHORIZED ?? "не задан"}`);
  log("");

  const results = await pool(TARGETS, 6, probe);

  let cur = "";
  for (const r of results) {
    if (r.book !== cur) {
      cur = r.book;
      log(`\n── ${cur} ${"─".repeat(Math.max(0, 60 - cur.length))}`);
    }
    const dns = r.dns?.ok ? `dns ${r.dns.ms}мс [${(r.dns.addrs || []).join(", ")}]` : `DNS: ${r.dns?.error}`;
    log(`   https://${r.host}${r.path}`);
    log(`     ${dns}`);
    if (r.tcp) log(`     tcp ${r.tcp.ok ? r.tcp.ms + "мс" : "ОШИБКА " + r.tcp.error}`);
    if (r.tls)
      log(
        `     tls ${r.tls.ok ? `${r.tls.ms}мс ${r.tls.proto} ${r.tls.issuer}${r.tls.authorized ? "" : " НЕ ДОВЕРЕН: " + r.tls.authError}` : "ОШИБКА " + r.tls.error}`
      );
    if (r.http)
      log(
        `     http ${r.http.ok ? `${r.http.ms}мс статус ${r.http.status} ${r.http.type}` : "ОШИБКА " + r.http.error}`
      );
    if (r.fetch)
      log(
        `     fetch() ${r.fetch.ok ? `${r.fetch.ms}мс статус ${r.fetch.status} ${r.fetch.len} байт` : r.fetch.error}`
      );
    log(`     ► ${r.result}`);
  }

  const bad = results.filter((r) => !/^OK/.test(r.result) && r.book !== "контроль");
  const good = results.filter((r) => /^OK/.test(r.result) && r.book !== "контроль");
  log("\n════════════════════════════════════════════════════════════════════");
  log(`  ИТОГ: рабочих адресов — ${good.length}, с ошибкой — ${bad.length}`);
  const errs = {};
  for (const r of bad) {
    const key = r.result.replace(/«[^»]*»/, "«…»").slice(0, 70);
    errs[key] = (errs[key] || 0) + 1;
  }
  for (const [k, v] of Object.entries(errs).sort((a, b) => b[1] - a[1])) log(`    ${v}× ${k}`);
  if (good.length) {
    log("\n  Рабочие адреса:");
    for (const r of good) log(`    https://${r.host}${r.path}`);
  }

  const control = results[0];
  const mitm = results.filter((r) => r.mitm || /НЕ ДОВЕРЕН/.test(r.result || ""));
  log("\n  ── ВЕРДИКТ ──────────────────────────────────────────────────────");
  if (!/^OK|^HTTP/.test(control.result || "")) {
    log("  Контрольный адрес (api.github.com) тоже недоступен. Значит дело не в конторах:");
    log("  из Node.js на этом компьютере нет нормального выхода в интернет.");
    log(`     причина: ${control.result}`);
  } else if (!bad.length) {
    log("  Всё доступно: линии должны подтягиваться. Если данных нет — смотрите парсеры.");
  } else if (mitm.length >= bad.length / 2 && mitm.length > 0) {
    log("  ПОХОЖЕ НА ПЕРЕХВАТ HTTPS (антивирус или прокси).");
    log("  Node не доверяет корневому сертификату, поэтому падают все конторы разом.");
    log("  Что делать: отключить проверку HTTPS в антивирусе (Касперский/Dr.Web/ESET —");
    log("  «Защищённые соединения» → «Не проверять») или экспортировать его корневой");
    log("  сертификат и прописать путь к нему в переменную окружения NODE_EXTRA_CA_CERTS.");
  } else if (bad.every((r) => /DNS — ENOTFOUND/.test(r.result || ""))) {
    log("  DNS не находит эти адреса. Проверьте интернет и DNS провайдера;");
    log("  попробуйте сменить DNS на 8.8.8.8 / 1.1.1.1 (но не включайте VPN).");
  } else {
    log("  Соединение есть, но конторы отвечают не так, как ожидает приложение.");
    log("  Ниже — статусы по каждому адресу, по ним поправим адреса/заголовки.");
  }
  log("\n  Отчёт сохранён в файл: diag-report.txt (его можно прислать в поддержку)");
  log("════════════════════════════════════════════════════════════════════\n");

  writeFileSync("diag-report.txt", "﻿" + out.join("\n"), "utf8");
})();
