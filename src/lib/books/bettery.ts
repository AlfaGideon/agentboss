import { makePlatformAdapter } from "./platform";

/**
 * Беттери. Линия работает на платформе Фонбета:
 * фиды lineNN.at58f5-resources.com (scopeMarket=501).
 */
export const bettery = makePlatformAdapter({
  key: "bettery",
  title: "Беттери",
  site: "https://bettery.ru",
  scopeMarket: 501,
  hosts: [
    "line51.at58f5-resources.com",
    "line01.at58f5-resources.com",
    "line02.at58f5-resources.com",
    "line31.at58f5-resources.com",
  ],
  eventUrl: () => "https://bettery.ru",
});
