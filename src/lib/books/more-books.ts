import { makeAdapter, RU_SPORT_MATCH } from "./generic";
import type { SportKey } from "./types";

/** Дополнительные российские букмекеры с лицензией ФНС */

const SPORT_ID: Record<string, Partial<Record<SportKey, number>>> = {
  betboom: { football: 1, hockey: 2, tennis: 3, basketball: 4, volleyball: 5, table_tennis: 21, mma: 13, esports: 40 },
  marathon: { football: 8, hockey: 12, tennis: 22, basketball: 3, volleyball: 24, table_tennis: 382, mma: 1004, esports: 1085 },
  pari: { football: 1, hockey: 2, tennis: 4, basketball: 3, volleyball: 6, table_tennis: 25, mma: 12, esports: 30 },
  zenit: { football: 1, hockey: 2, tennis: 3, basketball: 4, volleyball: 5, table_tennis: 21, mma: 13, esports: 40 },
};

/** БетБум (бывш. БингоБум) */
export const betboom = makeAdapter({
  key: "betboom",
  title: "БетБум",
  site: "https://betboom.ru",
  sportMatch: RU_SPORT_MATCH,
  endpoints: (s) => {
    const id = SPORT_ID.betboom[s];
    return [
      `https://betboom.ru/api/v2/line/events?sportId=${id}`,
      `https://api.betboom.ru/v1/line/sport/${id}/events`,
      `https://betboom.ru/api/line/sport/${id}`,
    ];
  },
  eventUrl: (id) => `https://betboom.ru/event/${id}`,
});

/** Марафон */
export const marathon = makeAdapter({
  key: "marathon",
  title: "Марафон",
  site: "https://www.marathonbet.ru",
  sportMatch: RU_SPORT_MATCH,
  endpoints: (s) => {
    const id = SPORT_ID.marathon[s];
    return [
      `https://www.marathonbet.ru/su/betting/json/sport/${id}`,
      `https://www.marathonbet.ru/su/betting?rg=${id}&format=json`,
      `https://www.marathonbet.ru/en/betting/json/sport/${id}`,
    ];
  },
  eventUrl: () => "https://www.marathonbet.ru",
});

/** PARI (бывш. Parimatch Россия) */
export const pari = makeAdapter({
  key: "pari",
  title: "ПАРИ",
  site: "https://pari.ru",
  sportMatch: RU_SPORT_MATCH,
  endpoints: (s) => {
    const id = SPORT_ID.pari[s];
    return [
      `https://pari.ru/api/v1/line/sport/${id}/events`,
      `https://pari.ru/api/betting/line/events?sportId=${id}`,
      `https://api.pari.ru/v1/line/sport/${id}`,
    ];
  },
  eventUrl: (id) => `https://pari.ru/event/${id}`,
});

/** Зенитбет */
export const zenit = makeAdapter({
  key: "zenit",
  title: "Зенитбет",
  site: "https://zenit.win",
  sportMatch: RU_SPORT_MATCH,
  endpoints: (s) => {
    const id = SPORT_ID.zenit[s];
    return [
      `https://zenit.win/api/v1/line/sport/${id}/events`,
      `https://zenit.win/api/line/events?sportId=${id}`,
    ];
  },
  eventUrl: () => "https://zenit.win",
});
