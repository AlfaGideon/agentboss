#!/usr/bin/env node
/**
 * Диагностика доступа к линиям букмекеров.
 * Запуск:  node Диагностика.mjs
 * Никаких зависимостей — только встроенные модули Node.js.
 *
 * Что делает для каждого адреса:
 *   DNS  — резолвится ли хост: системный DNS, затем резервные (UDP) и DNS-over-HTTPS
 *   TCP  — соединяемся ли на 443
 *   TLS  — проходит ли рукопожатие, какой протокол и центр сертификации
 *   HTTP — статус, content-type, первые байты ответа
 * Соединение выполняется по найденному адресу с правильным SNI и Host, поэтому
 * проверка проходит даже тогда, когда системный DNS адрес не отдаёт.
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
  { book: "Фонбет", host: "line01i.bkfon-resources.com", path: "/line/currentLine/ru/0.json.gz" },
  { book: "Фонбет", host: "line02i.bkfon-resources.com", path: "/line/currentLine/ru/0.json.gz" },
  { book: "Фонбет", host: "fon.bet", path: "/" },
  { book: "Лига Ставок", host: "api.ligastavok.ru", path: "/api/v1/line/events?sportIds=1&limit=5" },
  { book: "Лига Ставок", host: "ligastavok.ru", path: "/api/v1/line/events?sportIds=1&limit=5" },
  { book: "Лига Ставок", host: "www.ligastavok.ru", path: "/" },
  { book: "Winline", host: "wl-nsk.winline.ru", path: "/betting/api/v1/line/sport/1/events" },
  { book: "Winline", host: "winline.ru", path: "/betting/api/v1/line/sport/1/events" },
  { book: "Winline", host: "winline.ru", path: "/" },
  { book: "Олимп", host: "olimp.bet", path: "/api/v3/line/sports" },
  { book: "Олимп", host: "www.olimp.bet", path: "/api/v3/line/sports" },
  { book: "Олимп", host: "olimp.bet", path: "/" },
  { book: "БетБум", host: "betboom.ru", path: "/api/v2/line/events?sportId=1" },
  { book: "БетБум", host: "betboom.ru", path: "/api/line/sport/1" },
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

/* ── DNS: системный, а если он не нашёл — резервные серверы и DNS-over-HTTPS ── */

const UDP_SERVERS = ["8.8.8.8", "1.1.1.1", "77.88.8.8", "9.9.9.9"];
const DOH_PROVIDERS = [
  { name: "Яндекс.DNS", host: "common.dot.dns.yandex.net", ips: ["77.88.8.8", "77.88.8.1"] },
  { name: "AdGuard DNS", host: "dns.adguard-dns.com", ips: ["94.140.14.14", "94.140.15.15"] },
  { name: "Google DNS", host: "dns.google", ips: ["8.8.8.8", "8.8.4.4"] },
  { name: "Cloudflare", host: "cloudflare-dns.com", ips: ["1.1.1.1", "1.0.0.1"] },
];

function systemLookup(host) {
  return new Promise((resolve, reject) => {
    dns.lookup(host, { all: true }, (err, addrs) => {
      if (err) return reject(err);
      if (!addrs?.length) return reject(new Error("нет записей"));
      const v4 = addrs.find((a) => a.family === 4);
      resolve({ ip: (v4 ?? addrs[0]).address, all: addrs.map((a) => a.address) });
    });
  });
}

function udpLookup(host, server) {
  return new Promise((resolve, reject) => {
    const resolver = new dns.Resolver({ timeout: 2000, tries: 1 });
    try {
      resolver.setServers([server]);
    } catch (e) {
      return reject(e);
    }
    resolver.resolve4(host, (err, addrs) => {
      if (!err && addrs?.length) return resolve(addrs[0]);
      resolver.resolve6(host, (err6, addrs6) => {
        if (!err6 && addrs6?.length) return resolve(addrs6[0]);
        reject(new Error(err?.code || err6?.code || "нет записей"));
      });
    });
  });
}

/** Запрос к DoH-сервису идёт на его IP, поэтому DNS для него не нужен */
function dohLookup(host, provider, ip) {
  return new Promise((resolve, reject) => {
    const path = provider.host.includes("cloudflare")
      ? `/dns-query?name=${encodeURIComponent(host)}&type=A`
      : `/resolve?name=${encodeURIComponent(host)}&type=A`;
    const req = https.request(
      {
        host: ip,
        port: 443,
        path,
        servername: provider.host,
        rejectUnauthorized: false,
        headers: {
          Host: provider.host,
          Accept: "application/dns-json",
          "User-Agent": UA,
        },
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          try {
            const j = JSON.parse(data);
            const a = (j.Answer || []).find((x) => x.type === 1 || x.type === 28);
            if (a?.data) return resolve(a.data);
            reject(j.Status === 3 ? new Error("NXDOMAIN") : new Error("нет записи A"));
          } catch (e) {
            reject(new Error("ответ не JSON"));
          }
        });
      }
    );
    req.setTimeout(TIMEOUT, () => req.destroy(new Error("таймаут")));
    req.once("error", (e) => reject(new Error(e.code || e.message)));
    req.end();
  });
}

/** Системный DNS → публичные DNS по UDP → DNS-over-HTTPS */
async function resolveTarget(host) {
  const t0 = Date.now();
  const errors = [];

  try {
    const sys = await withTimeout(systemLookup(host), TIMEOUT, "DNS");
    return { ok: true, ms: Date.now() - t0, ip: sys.ip, addrs: sys.all, via: "системный DNS", errors };
  } catch (e) {
    errors.push(`системный DNS: ${e.code || e.message}`);
  }

  const udp = await Promise.all(
    UDP_SERVERS.map((srv) =>
      withTimeout(udpLookup(host, srv), TIMEOUT, `UDP ${srv}`)
        .then((ip) => ({ ip, via: `DNS ${srv}` }))
        .catch((e) => {
          errors.push(`DNS ${srv}: ${e.code || e.message}`);
          return null;
        })
    )
  );
  const udpWin = udp.find(Boolean);
  if (udpWin) return { ok: true, ms: Date.now() - t0, ip: udpWin.ip, via: udpWin.via, errors };

  const doh = await Promise.all(
    DOH_PROVIDERS.flatMap((p) =>
      p.ips.map((ip) =>
        withTimeout(dohLookup(host, p, ip), TIMEOUT, `DoH ${p.name}`)
          .then((addr) => ({ ip: addr, via: `${p.name} (DNS-over-HTTPS)` }))
          .catch((e) => {
            errors.push(`${p.name} (DoH): ${e.message}`);
            return null;
          })
      )
    )
  );
  const dohWin = doh.find(Boolean);
  if (dohWin) return { ok: true, ms: Date.now() - t0, ip: dohWin.ip, via: dohWin.via, errors };

  return { ok: false, ms: Date.now() - t0, error: "адрес не найден ни одним способом", errors };
}

function tcpConnect(ip, port = 443) {
  const t0 = Date.now();
  return new Promise((resolve) => {
    const s = net.connect({ host: ip, port });
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

function tlsProbe(host, ip, rejectUnauthorized = true) {
  const t0 = Date.now();
  return new Promise((resolve) => {
    const s = tls.connect({ host: ip, port: 443, servername: host, rejectUnauthorized });
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

function httpsGet(host, ip, path) {
  const t0 = Date.now();
  return new Promise((resolve) => {
    const req = https.request(
      {
        host: ip,
        path,
        method: "GET",
        port: 443,
        servername: host,
        headers: {
          Host: host,
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
  const d = await resolveTarget(t.host);
  const line = { book: t.book, host: t.host, path: t.path, dns: d };

  if (!d.ok) {
    line.result = `НЕТ ДОСТУПА: DNS — ${d.error}`;
    return line;
  }
  const tcp = await tcpConnect(d.ip);
  line.tcp = tcp;
  if (!tcp.ok) {
    line.result = `НЕТ ДОСТУПА: TCP — ${tcp.error}`;
    return line;
  }
  const tlsInfo = await tlsProbe(t.host, d.ip);
  line.tls = tlsInfo;
  if (!tlsInfo.ok) {
    let extra = "";
    if (/CERT|VERIFY|SIGNATURE|SELF_SIGNED|DEPTH_ZERO|UNABLE_TO_VERIFY/i.test(tlsInfo.error)) {
      const inc = await tlsProbe(t.host, d.ip, false);
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
  const http = await httpsGet(t.host, d.ip, t.path);
  line.http = http;
  // fetch() из Node ходит только через системный DNS — сравниваем, что было бы без резерва
  line.fetch = d.via === "системный DNS" ? await fetchProbe(url) : { skipped: true };

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
    const dns = r.dns?.ok
      ? `dns ${r.dns.ms}мс → ${r.dns.ip}  (${r.dns.via})`
      : `DNS: ${r.dns?.error}${r.dns?.errors?.length ? " | " + r.dns.errors.slice(0, 4).join("; ") : ""}`;
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
    if (r.fetch && !r.fetch.skipped)
      log(
        `     fetch() ${r.fetch.ok ? `${r.fetch.ms}мс статус ${r.fetch.status} ${r.fetch.len} байт` : r.fetch.error}`
      );
    log(`     ► ${r.result}`);
  }

  const backup = results.filter((r) => r.dns?.ok && r.dns.via && r.dns.via !== "системный DNS");
  if (backup.length) {
    log("\n  Адреса, которые системный DNS не отдал (найдены резервом):");
    for (const r of backup) log(`    ${r.host} → ${r.dns.ip}  (${r.dns.via})`);
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
  } else if (bad.every((r) => /DNS — /.test(r.result || ""))) {
    log("  Эти адреса не находит ни системный DNS, ни публичные серверы (8.8.8.8, 1.1.1.1,");
    log("  77.88.8.8), ни DNS-over-HTTPS. Значит имена блокируются в самой сети:");
    log("  попробуйте другую сеть или мобильный интернет. Свой DNS можно указать в Windows:");
    log("  параметры сети → DNS → 8.8.8.8 / 1.1.1.1.");
  } else {
    log("  Соединение есть, но конторы отвечают не так, как ожидает приложение.");
    log("  Ниже — статусы по каждому адресу, по ним поправим адреса/заголовки.");
  }
  log("\n  Отчёт сохранён в файл: diag-report.txt (его можно прислать в поддержку)");
  log("════════════════════════════════════════════════════════════════════\n");

  writeFileSync("diag-report.txt", "﻿" + out.join("\n"), "utf8");
})();
