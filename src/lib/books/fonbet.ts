import type { BookAdapter } from "./types";
import { fetchPlatformLine } from "./platform";

/**
 * Фонбет. Официальные публичные фиды линии — те же, которыми пользуется
 * сайт fon.bet:
 *
 *  • старый полный фид currentLine (прематч + лайв одним файлом, .json.gz);
 *  • новая платформа bk6bba-resources.com: /events/listBase (прематч)
 *    и /events/list (лайв), scopeMarket=1600.
 *
 * Схема и коды факторов общие для всей платформы — см. platform.ts.
 */

/** Зеркала старого фида currentLine (вся линия одним файлом) */
const CURRENT_LINE = [
  "https://line-static01.bkfon-resources.com/line/currentLine/ru/0.json.gz",
  "https://line11.bkfon-resources.com/line/currentLine/ru/0.json",
  "https://line-static01.bkfon-resources.com/line/currentLine/ru/0.json",
  "https://line01i.bkfon-resources.com/line/currentLine/ru/0.json.gz",
  "https://line02i.bkfon-resources.com/line/currentLine/ru/0.json.gz",
];

/** Зеркала новой платформы Фонбета */
const HOSTS = [
  "line-lb61-w.bk6bba-resources.com",
  "api-lb32.bk6bba-resources.com",
  "line02w.bk6bba-resources.com",
  "line04w.bk6bba-resources.com",
  "line32w.bk6bba-resources.com",
  "line51w.bk6bba-resources.com",
  "line52w.bk6bba-resources.com",
  "line53w.bk6bba-resources.com",
  "line54w.bk6bba-resources.com",
  "line55w.bk6bba-resources.com",
];

const fonbetConfig = {
  key: "fonbet",
  title: "Фонбет",
  site: "https://fon.bet",
  scopeMarket: 1600,
  hosts: HOSTS,
  extraPreUrls: CURRENT_LINE,
  // часть зеркал отдаёт фид с префиксом /ma
  pathPrefixes: ["", "/ma"],
  eventUrl: (sportId: number, id: number) => `https://fon.bet/sports/${sportId}/${id}`,
};

async function fetchLine(sport: Parameters<BookAdapter["fetchLine"]>[0], signal: AbortSignal) {
  return fetchPlatformLine(fonbetConfig, sport, signal);
}

export const fonbet: BookAdapter = {
  key: "fonbet",
  title: "Фонбет",
  site: "https://fon.bet",
  sports: ["football", "hockey", "tennis", "basketball", "volleyball", "table_tennis", "mma", "esports"],
  fetchLine,
};
