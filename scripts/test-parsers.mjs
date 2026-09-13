/**
 * Офлайн-тесты парсеров на фикстурах — схемы ответов официальных фидов
 * (платформа Фонбета, Лига Ставок eventsList, Олимп api/v4, Зенит printer/react,
 * Леон api-2). Запуск: node scripts/test-parsers.mjs (после npm run build:parsers).
 */
import assert from "node:assert";

const B = "../.testbuild/lib/books/";
const { mergeEvents } = await import(B + "index.js");
const { marketViews } = await import(B + "analyze.js");
const { parsePlatformLine } = await import(B + "platform.js");
const { parseItem: parseLs, parseOutcomes: parseLsOutcomes } = await import(B + "ligastavok.js");
const { parseSections: parseOlimp } = await import(B + "olimp.js");
const { parseLine: parseZenit } = await import(B + "zenit.js");
const { parseEvent: parseLeon } = await import(B + "leon.js");

const cfg = { key: "test", title: "Тест", eventUrl: () => "https://example.com" };
let passed = 0;
const ok = (name, cond) => {
  if (!cond) throw new Error("ТЕСТ ПРОВАЛЕН: " + name);
  passed++;
  console.log("  ✓", name);
};

/* ─────────── Платформа (Фонбет / Марафон / ПАРИ / Беттери) ─────────── */
console.log("Платформа линии (Фонбет и общая)");
{
  const feed = {
    sports: [
      { id: 1, name: "Футбол" },
      { id: 100, name: "Россия. Премьер-лига", parentId: 1 },
      { id: 2, name: "Хоккей" },
      { id: 200, name: "КХЛ", parentId: 2 },
    ],
    events: [
      {
        id: 11,
        sportId: 100,
        team1: "Зенит",
        team2: "Спартак",
        startTime: 1770000000,
        customFactors: undefined,
      },
      {
        id: 12,
        sportId: 100,
        team1: "ЦСКА",
        team2: "Локомотив",
        startTime: 1770003600,
        place: "live",
      },
      { id: 13, sportId: 200, team1: "СКА", team2: "Динамо Мск", startTime: 1770007200 },
      { id: 14, sportId: 100, team1: "Сет 1", team2: "", startTime: 1770010000, parentId: 12 },
    ],
    customFactors: [
      { e: 12, factors: [{ f: 921, v: 2.1 }, { f: 922, v: 3.4 }, { f: 923, v: 3.1 }] },
      {
        e: 13,
        factors: [
          { f: 921, v: 1.9 },
          { f: 923, v: 3.6 },
          // тотал: pt — готовая линия
          { f: 930, v: 1.85, pt: 5.5 },
          { f: 931, v: 1.95, pt: 5.5 },
          // фора через p (p = линия × 100), коды 927/928
          { f: 927, v: 1.75, p: -150 },
          { f: 928, v: 2.10, p: 150 },
        ],
      },
    ],
  };
  const football = parsePlatformLine(feed, cfg, "football", false);
  ok("футбол: 1 событие с факторами (лайв из фида currentLine)", football.length === 1);
  ok("лига из дерева sports", football[0].league === "Россия. Премьер-лига");
  ok("исходы П1/Х/П2", football[0].markets.moneyline.home === 2.1 && football[0].markets.moneyline.draw === 3.4 && football[0].markets.moneyline.away === 3.1);
  ok("place=live распознаётся", football[0].live === true);

  const hockey = parsePlatformLine(feed, cfg, "hockey", false);
  ok("хоккей: 1 событие", hockey.length === 1);
  ok("тотал 5.5 собран из pt", hockey[0].markets.totals.length === 1 && hockey[0].markets.totals[0].line === 5.5);
  ok("фора -1.5 собрана из p/100", hockey[0].markets.handicaps.length === 1 && hockey[0].markets.handicaps[0].line === -1.5);

  const empty = parsePlatformLine({ sports: [], events: [] }, cfg, "football", false);
  ok("пустой фид — пустой результат", empty.length === 0);
}

/* ─────────── Лига Ставок (eventsList) ─────────── */
console.log("Лига Ставок");
{
  const item = {
    id: 555001,
    event: {
      team1: "Реал Мадрид",
      team2: "Барселона",
      gameTitle: "Футбол",
      categoryTitle: "Испания",
      tournamentTitle: "Примера",
      startDate: 1770000000000,
      ns: "prematch",
    },
    outcomes: {
      a: { title: "1", value: "2.20" },
      b: { title: "X", value: "3.40" },
      c: { title: "2", value: "3.10" },
      d: { title: "Бол", value: "1.85", adValue: "2.5" },
      e: { title: "Мен", value: "1.95", adValue: "2.5" },
      f: { title: "Ф1", value: "1.75", adValue: "-1" },
      g: { title: "Ф2", value: "2.05", adValue: "1" },
    },
  };
  const ev = parseLs(item, "football");
  ok("событие разобрано", ev !== null);
  ok("турнир и команды", ev.league === "Примера" && ev.home === "Реал Мадрид" && ev.away === "Барселона");
  ok("исходы", ev.markets.moneyline.home === 2.2 && ev.markets.moneyline.draw === 3.4 && ev.markets.moneyline.away === 3.1);
  ok("тотал 2.5", ev.markets.totals.length === 1 && ev.markets.totals[0].line === 2.5 && ev.markets.totals[0].over === 1.85);
  ok("фора -1 у хозяев", ev.markets.handicaps.length === 1 && ev.markets.handicaps[0].line === -1);
  ok("прематч, не лайв", ev.live === false);

  const wrongSport = parseLs({ ...item, event: { ...item.event, gameTitle: "Теннис" } }, "football");
  ok("фильтр по виду спорта", wrongSport === null);

  const liveItem = { id: 1, event: { ...item.event, ns: "live" }, outcomes: item.outcomes };
  ok("ns=live распознаётся", parseLs(liveItem, "football").live === true);

  // форма GET-ответа: поля события прямо в элементе
  const getItem = {
    id: 7,
    team1: "А",
    team2: "Б",
    gameTitle: "Футбол",
    tournament: "Кубок",
    startTime: 1770000000000,
    ns: "prematch",
    outcomes: { x: { title: "1", value: 2.0 }, y: { title: "2", value: 3.5 } },
  };
  const got = parseLs(getItem, "football");
  ok("GET-форма ответа тоже разбирается", got !== null && got.league === "Кубок" && got.markets.moneyline.home === 2);
}

/* ─────────── Олимп (api/v4) ─────────── */
console.log("Олимп");
{
  const sections = [
    {
      payload: {
        sport: { id: "1", name: "Футбол" },
        competitionsWithEvents: [
          {
            name: "Лига Чемпионов UEFA",
            events: [
              {
                id: "998877",
                team1Name: "ПСЖ",
                team2Name: "Арсенал",
                startDateTime: "2026-04-30T19:00:00Z",
                sportName: "Футбол",
                competitionName: "Лига Чемпионов UEFA",
                outcomes: [
                  { shortName: "П1", probability: "2.10", tableType: "RESULT" },
                  { shortName: "Х", probability: "3.40", tableType: "RESULT" },
                  { shortName: "П2", probability: "3.10", tableType: "RESULT" },
                  { shortName: "ТБ", probability: "1.85", param: 2.5, tableType: "TOTAL" },
                  { shortName: "ТМ", probability: "1.95", param: 2.5, tableType: "TOTAL" },
                  { shortName: "Ф1", probability: "1.75", param: -1, tableType: "HANDICAP" },
                  { shortName: "Ф2", probability: "2.05", param: 1, tableType: "HANDICAP" },
                ],
              },
            ],
          },
        ],
      },
    },
    {
      payload: {
        sport: { id: "5", name: "Теннис" },
        competitionsWithEvents: [{ name: "ATP", events: [{ id: "1", team1Name: "X", team2Name: "Y", startDateTime: "2026-04-30T10:00:00Z" }] }],
      },
    },
  ];
  const football = parseOlimp(sections, "football", false);
  ok("футбол: 1 событие", football.length === 1);
  const ev = football[0];
  ok("команды и лига", ev.home === "ПСЖ" && ev.away === "Арсенал" && ev.league === "Лига Чемпионов UEFA");
  ok("исходы из probability", ev.markets.moneyline.home === 2.1 && ev.markets.moneyline.draw === 3.4 && ev.markets.moneyline.away === 3.1);
  ok("тотал 2.5", ev.markets.totals.length === 1 && ev.markets.totals[0].line === 2.5);
  ok("фора -1", ev.markets.handicaps.length === 1 && ev.markets.handicaps[0].line === -1);
  ok("время RFC3339", ev.startTime === "2026-04-30T19:00:00.000Z");
  ok("секция другого вида спорта отфильтрована", parseOlimp(sections, "hockey", false).length === 0);

  const epoch = parseOlimp(
    [{ payload: { sport: { name: "Футбол" }, competitionsWithEvents: [{ name: "L", events: [{ id: "2", team1Name: "A", team2Name: "B", startDateTime: 1770000000, outcomes: [{ shortName: "П1", probability: "1.9" }] }] }] } }],
    "football",
    true
  );
  ok("эпоха в секундах тоже разбирается", epoch.length === 1 && epoch[0].live === true);
}

/* ─────────── Зенит (printer/react) ─────────── */
console.log("Зенит");
{
  const feed = {
    games: {
      "1001": {
        c1_id: "11",
        c2_id: "22",
        tid: "3",
        sid: 1,
        date: "2026-05-01 19:00:00",
        hd: [{ n: "1" }, { n: "X" }, { n: "2" }, { n: "Б" }, { n: "М" }],
        f_l: [
          { o: "1", h: "2.10" },
          { o: "2", h: "3.40" },
          { o: "3", h: "3.10" },
          { o: "5", h: "2.5" },
          { o: "10", h: "1.85" },
          { o: "9", h: "1.95" },
        ],
      },
      "1002": { c1_id: "33", c2_id: "44", tid: "3", date: "2026-05-01 20:00:00", f_l: [{ o: "1", h: "1.90" }, { o: "3", h: "2.10" }] },
    },
    dict: {
      cmd: { "11": "Краснодар", "22": "Ростов", "33": "Урал", "44": "Сочи" },
      tournament: { "3": { name: "РПЛ" } },
    },
  };
  const events = parseZenit(feed, "football", false);
  ok("2 события", events.length === 2);
  const ev = events[0];
  ok("команды из dict.cmd", ev.home === "Краснодар" && ev.away === "Ростов");
  ok("лига из dict.tournament", ev.league === "РПЛ");
  ok("П1/Х/П2 по кодам 1/2/3", ev.markets.moneyline.home === 2.1 && ev.markets.moneyline.draw === 3.4 && ev.markets.moneyline.away === 3.1);
  ok("тотал: линия из соседнего элемента", ev.markets.totals.length === 1 && ev.markets.totals[0].line === 2.5 && ev.markets.totals[0].over === 1.85 && ev.markets.totals[0].under === 1.95);
  ok("москва-время конвертируется в ISO", ev.startTime === "2026-05-01T16:00:00.000Z");

  // двухисходный спорт: код 2 = П2, если заголовок не X
  const twoWay = {
    games: {
      "2001": { c1_id: "1", c2_id: "2", tid: "9", date: "2026-05-01 15:00:00", hd: [{ n: "1" }, { n: "2" }], f_l: [{ o: "1", h: "1.85" }, { o: "2", h: "2.05" }] },
    },
    dict: { cmd: { "1": "Игрок А", "2": "Игрок Б" }, tournament: { "9": { name: "ATP" } } },
  };
  const tennis = parseZenit(twoWay, "tennis", false);
  ok("двухисходный теннис: П1/П2 без ничьей", tennis.length === 1 && tennis[0].markets.moneyline.home === 1.85 && tennis[0].markets.moneyline.away === 2.05 && !tennis[0].markets.moneyline.draw);
}

/* ─────────── Леон (api-2) ─────────── */
console.log("Леон");
{
  const e = {
    id: 314159,
    sport: { name: "Футбол" },
    league: { name: "Серия А" },
    kickoff: 1770000000,
    competitors: [
      { name: "Интер", homeAway: "home" },
      { name: "Милан", homeAway: "away" },
    ],
    markets: [
      {
        name: "Исход матча",
        runners: [
          { name: "1", price: 2.2 },
          { name: "X", price: 3.3 },
          { name: "2", price: 3.2 },
        ],
      },
      {
        name: "Тотал",
        runners: [
          { name: "Больше 2.5", price: 1.8 },
          { name: "Меньше 2.5", price: 2.0 },
        ],
      },
    ],
  };
  const ev = parseLeon(e, "football", false);
  ok("событие разобрано", ev !== null);
  ok("порядок команд по homeAway", ev.home === "Интер" && ev.away === "Милан");
  ok("лига", ev.league === "Серия А");
  ok("исходы", ev.markets.moneyline.home === 2.2 && ev.markets.moneyline.draw === 3.3 && ev.markets.moneyline.away === 3.2);
  ok("тотал из названия исхода", ev.markets.totals.length === 1 && ev.markets.totals[0].line === 2.5 && ev.markets.totals[0].under === 2);
  ok("kickoff в секундах", ev.startTime === new Date(1770000000000).toISOString());
  ok("фильтр вида спорта", parseLeon({ ...e, sport: { name: "Баскетбол" } }, "football", false) === null);

  const noDraw = parseLeon(
    {
      id: 1,
      sport: { name: "Теннис" },
      league: { name: "WTA" },
      kickoff: 1770000000,
      competitors: [{ name: "А" }, { name: "Б" }],
      markets: [{ name: "Победитель", runners: [{ name: "1", price: 1.9 }, { name: "2", price: 2.1 }] }],
    },
    "tennis",
    false
  );
  ok("двухисходный рынок", noDraw !== null && noDraw.markets.moneyline.home === 1.9 && noDraw.markets.moneyline.away === 2.1);
}

console.log(`\nВсе тесты пройдены: ${passed}`);


/* ─────────── Слияние: одна игра в двух конторах ─────────── */
console.log("Слияние линий контор");
{
  // Фонбет (платформа): Зенит — Спартак, 12:00
  const fonbetFeed = {
    sports: [
      { id: 1, name: "Футбол" },
      { id: 100, name: "Россия. Премьер-лига", parentId: 1 },
    ],
    events: [{ id: 500, sportId: 100, team1: "Зенит", team2: "Спартак", startTime: 1770022800 }],
    customFactors: [
      { e: 500, factors: [{ f: 921, v: 1.9 }, { f: 922, v: 3.6 }, { f: 923, v: 4.2 }] },
    ],
  };
  const fonbetCfg = { key: "fonbet", title: "Фонбет", eventUrl: () => "https://fon.bet" };
  const fonbetEvents = parsePlatformLine(fonbetFeed, fonbetCfg, "football", false);

  // Олимп: Зенит — Спартак, 12:00, коэффициенты выше → лучшая цена
  const olimpSections = [
    {
      payload: {
        sport: { id: "1", name: "Футбол" },
        competitionsWithEvents: [
          {
            name: "Россия. Премьер-лига",
            events: [
              {
                id: "900",
                team1Name: "Зенит",
                team2Name: "Спартак",
                startDateTime: "2026-02-02T09:00:00.000Z",
                outcomes: [
                  { shortName: "П1", probability: "2.05" },
                  { shortName: "Х", probability: "3.50" },
                  { shortName: "П2", probability: "4.50" },
                ],
              },
            ],
          },
        ],
      },
    },
  ];
  const olimpEvents = parseOlimp(olimpSections, "football", false);

  const merged = mergeEvents([
    { bookKey: "fonbet", bookTitle: "Фонбет", ok: true, events: fonbetEvents, ms: 10 },
    { bookKey: "olimp", bookTitle: "Олимп", ok: true, events: olimpEvents, ms: 10 },
  ]);
  ok("матчи двух контор объединены в один", merged.length === 1 && merged[0].books.length === 2);

  const views = marketViews(merged[0], "shin");
  const ml = views.find((v) => v.market === "moneyline");
  ok("рынок исходов собран", ml !== undefined && ml.outcomes.length === 3);
  const home = ml.outcomes.find((o) => o.key === "1");
  ok("лучшая цена П1 — Олимп (2.05)", home.best.price === 2.05 && home.best.bookKey === "olimp");
  ok("обе конторы в списке котировок", home.all.length === 2);
}
