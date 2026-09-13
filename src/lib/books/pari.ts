import { makePlatformAdapter } from "./platform";

/**
 * ПАРИ (бывш. Parimatch Россия). Линия работает на платформе Фонбета:
 * фиды lineNN.pb06e2-resources.com (scopeMarket=2300).
 */
export const pari = makePlatformAdapter({
  key: "pari",
  title: "ПАРИ",
  site: "https://pari.ru",
  scopeMarket: 2300,
  hosts: [
    "line-lb01-w.pb06e2-resources.com",
    "line01.pb06e2-resources.com",
    "line02.pb06e2-resources.com",
    "line03.pb06e2-resources.com",
    "line04.pb06e2-resources.com",
    "line31.pb06e2-resources.com",
    "line32.pb06e2-resources.com",
    "line51.pb06e2-resources.com",
    "line52.pb06e2-resources.com",
  ],
  eventUrl: () => "https://pari.ru",
});
