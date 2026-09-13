/**
 * Офлайн-тесты сборщика экспрессов (src/lib/books/express.ts) на синтетической
 * линии: без сети. Запуск: node scripts/test-express.mjs (после npm run build:parsers).
 */
import assert from "node:assert";
import { candidateLegs, buildExpresses } from "../.testbuild/lib/books/express.js";

let passed = 0;
const ok = (name, cond) => {
  if (!cond) throw new Error("ТЕСТ ПРОВАЛЕН: " + name);
  passed++;
  console.log("  ✓", name);
};

/* ─────────── Фикстура: 3 конторы, 7 матчей ─────────── */

const B1 = { key: "b1", title: "Бук-1" };
const B2 = { key: "b2", title: "Бук-2" };
const B3 = { key: "b3", title: "Бук-3" };
const T0 = "2026-09-14T16:00:00Z";
const T1 = "2026-09-14T18:30:00Z";

const book = (b, id, home, away, t, live, markets) => ({
  bookKey: b.key,
  bookTitle: b.title,
  bookEventId: `${b.key}-${id}`,
  sport: "football",
  league: "Тест. Лига",
  home,
  away,
  startTime: t,
  live,
  url: `https://example.com/${b.key}/${id}`,
  markets,
});

const ml = (home, draw, away) => ({ home, draw, away });
const ev = (id, home, away, t, live, perBook) => ({
  id: `football:${id}`,
  sport: "football",
  league: "Тест. Лига",
  home,
  away,
  startTime: t,
  live,
  books: [B1, B2, B3].map((b) => book(b, id, home, away, t, live, perBook[b.key])),
});

/**
 * А — явный фаворит (~0.90), Б — фаворит (~0.88), Е — фаворит с запасной
 * ногой «Обе забьют: Нет» (~0.72), В — средний фаворит (~0.75),
 * Д — равная игра, Ж — только 2 конторы (должна отсечься по minBooks).
 */
const events = [
  ev("A", "Фаворит А", "Соперник А1", T0, false, {
    b1: { moneyline: ml(1.04, 16, 19), doubleChance: { homeDraw: 1.06, homeAway: 9, drawAway: 9 }, btts: { yes: 2.2, no: 1.65 }, totals: [{ line: 2.5, over: 1.95, under: 1.85 }] },
    b2: { moneyline: ml(1.03, 15, 20), doubleChance: { homeDraw: 1.07, homeAway: 9.5, drawAway: 9.5 }, btts: { yes: 2.25, no: 1.6 }, totals: [{ line: 2.5, over: 2.0, under: 1.8 }] },
    b3: { moneyline: ml(1.05, 17, 18), doubleChance: { homeDraw: 1.05, homeAway: 8.5, drawAway: 8.5 }, btts: { yes: 2.15, no: 1.68 }, totals: [{ line: 2.5, over: 1.9, under: 1.9 }] },
  }),
  ev("B", "Фаворит Б", "Соперник Б1", T0, false, {
    b1: { moneyline: ml(1.06, 15, 18), doubleChance: { homeDraw: 1.09, homeAway: 8, drawAway: 8 }, btts: { yes: 2.0, no: 1.8 }, totals: [{ line: 2.5, over: 1.85, under: 1.95 }] },
    b2: { moneyline: ml(1.07, 14, 19), doubleChance: { homeDraw: 1.10, homeAway: 8.5, drawAway: 8.5 }, btts: { yes: 2.05, no: 1.75 }, totals: [{ line: 2.5, over: 1.9, under: 1.9 }] },
    b3: { moneyline: ml(1.05, 16, 17.5), doubleChance: { homeDraw: 1.08, homeAway: 7.5, drawAway: 7.5 }, btts: { yes: 1.95, no: 1.85 }, totals: [{ line: 2.5, over: 1.8, under: 2.0 }] },
  }),
  ev("E", "Фаворит Е", "Соперник Е1", T0, false, {
    b1: { moneyline: ml(1.10, 12, 22), doubleChance: { homeDraw: 1.15, homeAway: 6, drawAway: 7 }, btts: { yes: 2.6, no: 1.5 }, totals: [{ line: 2.5, over: 1.7, under: 2.1 }] },
    b2: { moneyline: ml(1.11, 11.5, 23), doubleChance: { homeDraw: 1.16, homeAway: 6.5, drawAway: 7.5 }, btts: { yes: 2.65, no: 1.48 }, totals: [{ line: 2.5, over: 1.75, under: 2.05 }] },
    b3: { moneyline: ml(1.09, 12.5, 21), doubleChance: { homeDraw: 1.14, homeAway: 5.5, drawAway: 6.5 }, btts: { yes: 2.55, no: 1.52 }, totals: [{ line: 2.5, over: 1.65, under: 2.15 }] },
  }),
  ev("C", "Средний В", "Соперник В1", T1, false, {
    b1: { moneyline: ml(1.25, 4.8, 10), doubleChance: { homeDraw: 1.35, homeAway: 3.5, drawAway: 5.5 }, btts: { yes: 1.8, no: 1.95 }, totals: [{ line: 2.5, over: 1.9, under: 1.9 }] },
    b2: { moneyline: ml(1.26, 4.9, 9.5), doubleChance: { homeDraw: 1.36, homeAway: 3.4, drawAway: 5.4 }, btts: { yes: 1.85, no: 1.9 }, totals: [{ line: 2.5, over: 1.95, under: 1.85 }] },
    b3: { moneyline: ml(1.24, 4.7, 10.5), doubleChance: { homeDraw: 1.34, homeAway: 3.6, drawAway: 5.6 }, btts: { yes: 1.78, no: 1.98 }, totals: [{ line: 2.5, over: 1.85, under: 1.95 }] },
  }),
  ev("D", "Равная Д", "Соперник Д1", T1, false, {
    b1: { moneyline: ml(2.2, 3.3, 3.2), doubleChance: { homeDraw: 1.5, homeAway: 3.8, drawAway: 4.0 }, btts: { yes: 1.7, no: 2.1 }, totals: [{ line: 2.5, over: 1.95, under: 1.85 }] },
    b2: { moneyline: ml(2.25, 3.4, 3.15), doubleChance: { homeDraw: 1.52, homeAway: 3.7, drawAway: 3.9 }, btts: { yes: 1.72, no: 2.08 }, totals: [{ line: 2.5, over: 2.0, under: 1.8 }] },
    b3: { moneyline: ml(2.15, 3.35, 3.25), doubleChance: { homeDraw: 1.48, homeAway: 3.9, drawAway: 4.1 }, btts: { yes: 1.68, no: 2.12 }, totals: [{ line: 2.5, over: 1.9, under: 1.9 }] },
  }),
  {
    id: "football:G",
    sport: "football",
    league: "Тест. Лига",
    home: "Лайв Г",
    away: "Соперник Г1",
    startTime: T0,
    live: true,
    books: [B1, B2, B3].map((b) =>
      book(b, "G", "Лайв Г", "Соперник Г1", T0, true, {
        moneyline: ml(1.12, 12, 15),
      })
    ),
  },
  {
    // Ж — всего 2 конторы: при minBooks=3 ноги отсюда быть не должно
    id: "football:Z",
    sport: "football",
    league: "Тест. Лига",
    home: "Мало Ж",
    away: "Соперник Ж1",
    startTime: T0,
    live: false,
    books: [
      book(B1, "Z", "Мало Ж", "Соперник Ж1", T0, false, { moneyline: ml(1.03, 14, 20) }),
      book(B2, "Z", "Мало Ж", "Соперник Ж1", T0, false, { moneyline: ml(1.04, 15, 19) }),
    ],
  },
];

const keyOf = (e) =>
  e.legs
    .map((l) => `${l.eventId}|${l.market}|${l.outcome}`)
    .sort()
    .join(";");

/* ─────────── Ноги-кандидаты ─────────── */

console.log("Ноги-кандидаты (candidateLegs)");
{
  const legs = candidateLegs(events, "shin", 3);
  ok("ног найдено достаточно", legs.length >= 12);
  ok("у каждой ноги вероятность в (0.02, 0.99)", legs.every((l) => l.fairProb > 0.02 && l.fairProb < 0.99));
  ok("консенсус не меньше minBooks", legs.every((l) => l.booksCount >= 3));
  ok("матч с 2 конторами отсечён", !legs.some((l) => l.eventId === "football:Z"));
  ok("лине передан флаг лайва", legs.some((l) => l.eventId === "football:G" && l.live === true));

  const aWin = legs.find((l) => l.eventId === "football:A" && l.market === "moneyline" && l.outcome.startsWith("П1"));
  ok("у явного фаворита вероятность ~90%", aWin && aWin.fairProb > 0.8 && aWin.fairProb < 0.96);
  ok("цена ноги — лучшая среди контор", aWin && Math.abs(aWin.price - 1.05) < 1e-9);
  const dWin = legs.find((l) => l.eventId === "football:D" && l.market === "moneyline" && l.outcome.startsWith("П1"));
  ok("у равной игры вероятность ниже, чем у фаворита", dWin && dWin.fairProb < aWin.fairProb - 0.2);
}

/* ─────────── Сборка экспрессов ─────────── */

console.log("Сборка экспрессов (buildExpresses)");
{
  const legs = candidateLegs(events, "shin", 3);
  // лучший исход каждого матча — для самокалибровки порога гарантии
  const bestByEvent = new Map();
  for (const l of legs) {
    const cur = bestByEvent.get(l.eventId);
    if (!cur || l.fairProb > cur.fairProb) bestByEvent.set(l.eventId, l);
  }
  const top = [...bestByEvent.values()].sort((a, b) => b.fairProb - a.fairProb);
  const [e1, e2, e3] = top;
  ok("рейтинг матчей начинается с фаворитов", e1.eventId === "football:A" && e2.eventId === "football:B");

  // порог чуть ниже произведения вероятностей топовых двух матчей → экспресс обязан найтись
  const g2 = e1.fairProb * e2.fairProb * 100 - 0.05;
  const r2 = buildExpresses(events, { minGuaranteePct: g2, minLegs: 2, maxLegs: 2 });
  ok(`экспресс на 2 ноги при пороге ${g2.toFixed(2)}% найден`, r2.expresses.length >= 1);
  const top2 = r2.expresses[0];
  ok("у топа-экспресса ровно 2 ноги из разных матчей", top2.legs.length === 2 && top2.legs[0].eventId !== top2.legs[1].eventId);
  ok("гарантия топа выше порога", top2.guaranteedPct >= g2);
  ok("коэффициент = произведение цен ног", Math.abs(top2.totalOdds - top2.legs.reduce((a, l) => a * l.price, 1)) < 1e-9);
  ok("гарантия = произведение вероятностей ног", Math.abs(top2.guaranteedPct - top2.legs.reduce((a, l) => a * l.fairProb, 1) * 100) < 1e-6);

  // 3 ноги
  const g3 = e1.fairProb * e2.fairProb * e3.fairProb * 100 - 0.05;
  const r3 = buildExpresses(events, { minGuaranteePct: g3, minLegs: 3, maxLegs: 3 });
  ok("экспресс на 3 ноги собран", r3.expresses.length >= 1 && r3.expresses[0].legs.length === 3);
  ok("в экспрессе нет двух ног одного матча", r3.expresses.every((e) => new Set(e.legs.map((l) => l.eventId)).size === e.legs.length));

  // недостижимый порог → пусто, но есть «чуть ниже порога»
  const rNone = buildExpresses(events, { minGuaranteePct: 99, minLegs: 2, maxLegs: 5 });
  ok("при пороге 99% экспрессов нет", rNone.expresses.length === 0);
  ok("«чуть ниже порога» не больше трёх", rNone.nearMisses.length >= 1 && rNone.nearMisses.length <= 3);
  ok("nearMisses всё равно ниже порога", rNone.nearMisses.every((e) => e.guaranteedPct < 99));

  // ограничения на ноги
  const rLimit = buildExpresses(events, { minGuaranteePct: 1, minLegs: 2, maxLegs: 3, limit: 2 });
  ok("limit respected", rLimit.expresses.length <= 2);
  ok("число ног в пределах [min, max]", rLimit.expresses.every((e) => e.legs.length >= 2 && e.legs.length <= 3));

  // minLegProb отсекает слабые ноги
  const weak = buildExpresses(events, { minGuaranteePct: 1, minLegs: 2, maxLegs: 5, minLegProb: 0.8 });
  ok("ноги ниже minLegProb не попали в экспрессы", weak.expresses.every((e) => e.legs.every((l) => l.fairProb >= 0.8)));

  // диапазон коэффициентов экспресса
  const rOdds = buildExpresses(events, { minGuaranteePct: 1, minLegs: 2, maxLegs: 5, minTotalOdds: 1.2, maxTotalOdds: 1.25 });
  ok("коэффициент экспресса в заданном диапазоне", rOdds.expresses.every((e) => e.totalOdds >= 1.2 - 1e-9 && e.totalOdds <= 1.25 + 1e-9));

  // дедупликация и сортировка
  const rAll = buildExpresses(events, { minGuaranteePct: 1, minLegs: 2, maxLegs: 5 });
  const keys = rAll.expresses.map(keyOf);
  ok("нет одинаковых экспрессов", new Set(keys).size === keys.length);
  const gs = rAll.expresses.map((e) => e.guaranteedPct);
  ok("сортировка по убыванию гарантии", gs.every((v, i) => i === 0 || gs[i - 1] >= v));
  ok(
    "stats посчитаны",
    rAll.stats.eventsScanned === events.length &&
      rAll.stats.comparable === events.length - 1 &&
      rAll.stats.candidateLegs > 0 &&
      rAll.stats.candidateLegs <= legs.length &&
      rAll.stats.combosChecked > 0
  );

  // пустой ввод
  const rEmpty = buildExpresses([]);
  ok("пустая линия → пусто и без ошибок", rEmpty.expresses.length === 0 && rEmpty.nearMisses.length === 0 && rEmpty.stats.eventsScanned === 0);
}

console.log(`\nЭкспрессы: ${passed} проверок — все прошли ✓`);
