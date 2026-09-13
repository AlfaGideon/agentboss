import { makePlatformAdapter } from "./platform";

/**
 * Марафон (российская лицензия). Линия работает на платформе Фонбета:
 * фиды lineNN.tf39be-resources.com (scopeMarket=3000).
 */
export const marathon = makePlatformAdapter({
  key: "marathon",
  title: "Марафон",
  site: "https://www.marathonbet.ru",
  scopeMarket: 3000,
  hosts: [
    "line51.tf39be-resources.com",
    "line52.tf39be-resources.com",
    "line01.tf39be-resources.com",
    "line02.tf39be-resources.com",
    "line31.tf39be-resources.com",
    "line32.tf39be-resources.com",
  ],
  eventUrl: () => "https://www.marathonbet.ru",
});
