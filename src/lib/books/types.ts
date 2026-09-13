/** Единая модель линии российских букмекеров */

export type SportKey =
  | "football"
  | "hockey"
  | "tennis"
  | "basketball"
  | "volleyball"
  | "table_tennis"
  | "mma"
  | "esports";

export const SPORTS: { key: SportKey; title: string }[] = [
  { key: "football", title: "Футбол" },
  { key: "hockey", title: "Хоккей" },
  { key: "tennis", title: "Теннис" },
  { key: "basketball", title: "Баскетбол" },
  { key: "volleyball", title: "Волейбол" },
  { key: "table_tennis", title: "Настольный теннис" },
  { key: "mma", title: "ММА / Бокс" },
  { key: "esports", title: "Киберспорт" },
];

export const sportTitle = (k: string) => SPORTS.find((s) => s.key === k)?.title ?? k;

/** Исход рынка «Победитель» */
export type Moneyline = { home?: number; draw?: number; away?: number };

/** Тотал с линией */
export type TotalLine = { line: number; over?: number; under?: number };

/** Фора с линией (значение форы для хозяев) */
export type HandicapLine = { line: number; home?: number; away?: number };

export type EventMarkets = {
  moneyline?: Moneyline;
  /** Двойной шанс */
  doubleChance?: { homeDraw?: number; homeAway?: number; drawAway?: number };
  /** Обе забьют */
  btts?: { yes?: number; no?: number };
  totals?: TotalLine[];
  handicaps?: HandicapLine[];
};

/** Событие в линии одного букмекера */
export type BookEvent = {
  bookKey: string;
  bookTitle: string;
  /** id события внутри букмекера */
  bookEventId: string;
  sport: SportKey;
  league: string;
  home: string;
  away: string;
  /** ISO-время начала */
  startTime: string;
  live: boolean;
  url?: string;
  markets: EventMarkets;
};

/** Результат опроса одного букмекера */
export type BookFetchResult = {
  bookKey: string;
  bookTitle: string;
  ok: boolean;
  events: BookEvent[];
  endpoint?: string;
  error?: string;
  ms: number;
  /** Сколько событий пришло всего до фильтра по виду спорта */
  rawCount?: number;
};

export type BookAdapter = {
  key: string;
  title: string;
  site: string;
  /** Поддерживаемые виды спорта */
  sports: SportKey[];
  /** Забрать линию по виду спорта */
  fetchLine: (sport: SportKey, signal: AbortSignal) => Promise<{ events: BookEvent[]; endpoint: string; rawCount: number }>;
};

/** Объединённое по всем конторам событие */
export type MergedEvent = {
  id: string;
  sport: SportKey;
  league: string;
  home: string;
  away: string;
  startTime: string;
  live: boolean;
  /** Линия каждой конторы по этому событию */
  books: BookEvent[];
};

export type PriceRef = { book: string; bookKey: string; price: number; url?: string };

export type BestOutcome = {
  /** Человекочитаемое название исхода */
  label: string;
  /** ключ исхода для группировки */
  key: string;
  best: PriceRef;
  all: PriceRef[];
  fairProb?: number;
};

export type MarketView = {
  market: string;
  label: string;
  outcomes: BestOutcome[];
  overround: number | null;
};
