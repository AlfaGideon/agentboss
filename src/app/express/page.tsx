"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePrefs, qs, dnsParam } from "@/lib/prefs";
import { BookToggle, SportToggle, SourceStatus } from "@/components/controls";
import { Badge, ErrorBox, Spinner, Stat, fmtTime, money, timeUntil } from "@/components/ui";
import type { TrackedBet } from "@/lib/types";

type Leg = {
  eventId: string;
  sport: string;
  league: string;
  match: string;
  startTime: string;
  live: boolean;
  market: string;
  marketLabel: string;
  outcome: string;
  book: string;
  bookKey: string;
  url?: string;
  price: number;
  fairProb: number;
  booksCount: number;
};

type Express = {
  legs: Leg[];
  totalOdds: number;
  guaranteedPct: number;
  minLegProbPct: number;
  payout100: number;
  profit100: number;
};

const WINLINE_URL = "https://winline.ru";

export default function ExpressPage() {
  const [prefs, setPrefs] = usePrefs();
  const [expresses, setExpresses] = useState<Express[]>([]);
  const [nearMisses, setNearMisses] = useState<Express[]>([]);
  const [sources, setSources] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | undefined>();
  const [updated, setUpdated] = useState<string | null>(null);
  const [scanned, setScanned] = useState(0);
  const [comparable, setComparable] = useState(0);
  const [candidateLegs, setCandidateLegs] = useState(0);

  // настройки сборщика
  const [guarantee, setGuarantee] = useState(80);
  const [minLegs, setMinLegs] = useState(2);
  const [maxLegs, setMaxLegs] = useState(5);
  const [minLegProb, setMinLegProb] = useState(50); // %
  const [minTotalOdds, setMinTotalOdds] = useState(1.1);
  const [maxTotalOdds, setMaxTotalOdds] = useState(30);
  const [days, setDays] = useState(3);
  const [withLive, setWithLive] = useState(false);
  const [stake, setStake] = useState(1000);
  const [sort, setSort] = useState<"guarantee" | "odds" | "time">("guarantee");
  const [saved, setSaved] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(
        `/api/express?${qs({
          sports: prefs.sports.join(","),
          books: prefs.books.join(","),
          minGuarantee: guarantee,
          minLegs,
          maxLegs: Math.max(maxLegs, minLegs),
          minLegProb: minLegProb / 100,
          minTotalOdds,
          maxTotalOdds,
          minBooks: prefs.minBooks,
          method: prefs.method,
          days,
          live: withLive ? "1" : "0",
          dns: dnsParam(prefs),
        })}`
      );
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setExpresses(d.expresses || []);
      setNearMisses(d.nearMisses || []);
      setSources(d.sources || []);
      setScanned(d.stats?.eventsScanned || 0);
      setComparable(d.stats?.comparable || 0);
      setCandidateLegs(d.stats?.candidateLegs || 0);
      setHint(d.hint);
      setUpdated(d.fetchedAt);
      if (d.hint) setError("Не удалось получить котировки ни от одной конторы");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setLoading(false);
    }
  }, [
    prefs.sports,
    prefs.books,
    prefs.minBooks,
    prefs.method,
    guarantee,
    minLegs,
    maxLegs,
    minLegProb,
    minTotalOdds,
    maxTotalOdds,
    days,
    withLive,
  ]);

  useEffect(() => {
    load();
  }, [load]);

  const rows = useMemo(() => {
    const f = [...expresses];
    f.sort((a, b) => {
      if (sort === "odds") return b.totalOdds - a.totalOdds;
      if (sort === "time") {
        const at = (e: Express) => Math.min(...e.legs.map((l) => +new Date(l.startTime)));
        return at(a) - at(b);
      }
      return b.guaranteedPct - a.guaranteedPct;
    });
    return f;
  }, [expresses, sort]);

  const keyOf = (e: Express) =>
    e.legs
      .map((l) => `${l.eventId}|${l.market}|${l.outcome}`)
      .sort()
      .join(";");

  const addToTracker = (e: Express) => {
    const bet: TrackedBet = {
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      eventDate: e.legs[0].startTime,
      sport: "Экспресс",
      match: `Экспресс Winline (${e.legs.length} ног)`,
      market: "Экспресс",
      selection: e.legs.map((l) => l.outcome).join(" + "),
      bookmaker: "Winline",
      odds: e.totalOdds,
      stake: Math.round(stake),
      status: "pending",
      tags: ["winline-express", `гарантия ${e.guaranteedPct.toFixed(1)}%`],
    };
    try {
      const raw = localStorage.getItem("betscope.bets");
      const list: TrackedBet[] = raw ? JSON.parse(raw) : [];
      list.push(bet);
      localStorage.setItem("betscope.bets", JSON.stringify(list));
      setSaved(keyOf(e));
      setTimeout(() => setSaved(null), 2000);
    } catch {
      /* ignore */
    }
  };

  const renderLeg = (l: Leg, i: number) => (
    <li key={`${l.eventId}-${l.market}-${i}`} className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <span className="w-4 text-right text-xs text-slate-600">{i + 1}</span>
      <div className="min-w-0 flex-1">
        <p className="text-sm">
          <b className="text-slate-100">{l.outcome}</b>
          <span className="text-slate-500"> · {l.marketLabel}</span>
        </p>
        <p className="truncate text-xs text-slate-500">
          {l.match}
          {l.league ? ` · ${l.league}` : ""} · {fmtTime(l.startTime)} · {timeUntil(l.startTime)}
        </p>
      </div>
      <div className="flex items-center gap-3 text-xs tabular-nums">
        <span className="text-slate-500">
          {l.url ? (
            <a href={l.url} target="_blank" rel="noreferrer" className="text-accent underline">
              {l.book}
            </a>
          ) : (
            l.book
          )}
        </span>
        <span className="chip w-14 justify-end">
          <b className="text-good">{l.price.toFixed(2)}</b>
        </span>
        <span className="chip w-16 justify-end" title="Справедливая вероятность с удалённой маржей">
          {(l.fairProb * 100).toFixed(0)}%
        </span>
      </div>
    </li>
  );

  const renderExpress = (e: Express, i: number, isMiss = false) => {
    const ok = e.guaranteedPct >= guarantee;
    const payout = stake * e.totalOdds;
    const profit = stake * (e.totalOdds - 1);
    return (
      <article key={keyOf(e) + i} className={`card-pad ${isMiss ? "opacity-70" : ""}`}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <Badge tone={ok ? "good" : "warn"}>
                {e.legs.length} ног
              </Badge>
              <Badge tone="accent">Winline</Badge>
              {e.legs.some((l) => l.live) && <Badge tone="bad">ЛАЙВ</Badge>}
              <p className="text-sm text-slate-400">
                первая нога: {timeUntil(e.legs[0].startTime)}
              </p>
            </div>
            <ul className="space-y-2">{e.legs.map((l, j) => renderLeg(l, j))}</ul>
          </div>
          <div className="grid min-w-[220px] gap-2 text-right">
            <div className="flex items-end justify-end gap-4">
              <div>
                <p className="text-xs text-slate-500">Коэффициент</p>
                <p className="text-2xl font-semibold tabular-nums text-white">
                  {e.totalOdds.toFixed(2)}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Гарантия</p>
                <p
                  className={`text-2xl font-semibold tabular-nums ${
                    ok ? "text-good" : "text-warn"
                  }`}
                >
                  {e.guaranteedPct.toFixed(1)}%
                </p>
              </div>
            </div>
            <p className="text-xs text-slate-400">
              слабая нога: <b className="text-slate-200">{e.minLegProbPct.toFixed(0)}%</b>
            </p>
            <div className="rounded-lg border border-edge bg-slate-900/60 p-2 text-xs">
              <p className="text-slate-500">Выигрыш при {money(stake, prefs.currency)}</p>
              <p className="text-base font-medium tabular-nums text-slate-100">
                {money(payout, prefs.currency)}{" "}
                <span className="text-good">+{money(profit, prefs.currency)}</span>
              </p>
            </div>
            <div className="flex justify-end gap-2">
              <a
                className="btn-primary text-xs"
                href={WINLINE_URL}
                target="_blank"
                rel="noreferrer"
              >
                Собрать в Winline ↗
              </a>
              <button className="btn text-xs" onClick={() => addToTracker(e)}>
                {saved === keyOf(e) ? "✓ добавлено" : "В мои ставки"}
              </button>
            </div>
          </div>
        </div>
      </article>
    );
  };

  return (
    <div className="space-y-5">
      <div className="card-pad grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <div>
            <p className="text-sm text-slate-300">
              <b className="text-white">Экспрессы под Винлайн.</b> Собираются из лучших цен рынка:
              нога — самый вероятный исход матча (маржа снята), в экспрессе максимум одна нога на
              матч. Показаны только экспрессы, у которых вероятность прохода не ниже заданной
              гарантии (по умолчанию <b className="text-good">80%</b>).
            </p>
            <p className="mt-1 text-xs text-slate-500">
              У Винлайна нет публичного фида линии: коэффициент в списке — лучшая цена среди контор
              сканера, реальная цена Winline обычно в пределах ±2–3%. Ставку вы ставите вручную на{" "}
              <a href={WINLINE_URL} target="_blank" rel="noreferrer" className="text-accent underline">
                winline.ru
              </a>
              .
            </p>
          </div>
          <div>
            <label className="label">Виды спорта (все доступные)</label>
            <SportToggle value={prefs.sports} onChange={(s) => setPrefs({ ...prefs, sports: s })} />
          </div>
          <div>
            <label className="label">Букмекеры (источники цен)</label>
            <BookToggle value={prefs.books} onChange={(b) => setPrefs({ ...prefs, books: b })} />
          </div>
        </div>
        <div className="space-y-3">
          <div>
            <div className="flex items-center justify-between">
              <label className="label mb-0">Гарантия (мин. вероятность)</label>
              <span className="text-lg font-semibold tabular-nums text-good">
                ≥ {guarantee}%
              </span>
            </div>
            <input
              type="range"
              min={50}
              max={95}
              step={1}
              value={guarantee}
              onChange={(e) => setGuarantee(Number(e.target.value))}
              className="mt-1 w-full accent-emerald-400"
            />
            <p className="text-[10px] text-slate-500">
              80% за 2 ноги ≈ 89% на ногу, за 3 ноги ≈ 93% — чем больше ног, тем выше планка
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="label">Ноги: минимум</label>
              <select
                className="input"
                value={minLegs}
                onChange={(e) => setMinLegs(Math.min(Number(e.target.value), maxLegs - 1))}
              >
                {[2, 3, 4, 5, 6, 7].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Ноги: максимум</label>
              <select
                className="input"
                value={maxLegs}
                onChange={(e) => setMaxLegs(Math.max(Number(e.target.value), minLegs + 1))}
              >
                {[3, 4, 5, 6, 7, 8].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="label">Мин. вероятность ноги, %</label>
              <input
                type="number"
                min={30}
                max={95}
                className="input"
                value={minLegProb}
                onChange={(e) => setMinLegProb(Number(e.target.value))}
              />
            </div>
            <div>
              <label className="label">Мин. коэф. экспресса</label>
              <input
                type="number"
                step="0.1"
                min={1}
                className="input"
                value={minTotalOdds}
                onChange={(e) => setMinTotalOdds(Number(e.target.value))}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="label">Макс. коэф. экспресса</label>
              <input
                type="number"
                step="1"
                min={2}
                className="input"
                value={maxTotalOdds}
                onChange={(e) => setMaxTotalOdds(Number(e.target.value))}
              />
            </div>
            <div>
              <label className="label">Горизонт, дней</label>
              <select className="input" value={days} onChange={(e) => setDays(Number(e.target.value))}>
                <option value={1}>1</option>
                <option value={3}>3</option>
                <option value={7}>7</option>
                <option value={0}>вся линия</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="label">Сумма ставки</label>
              <input
                type="number"
                min={0}
                className="input"
                value={stake}
                onChange={(e) => setStake(Number(e.target.value))}
              />
            </div>
            <div>
              <label className="label">Сортировка</label>
              <select className="input" value={sort} onChange={(e) => setSort(e.target.value as any)}>
                <option value="guarantee">По гарантии</option>
                <option value="odds">По коэффициенту</option>
                <option value="time">По времени</option>
              </select>
            </div>
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-400">
            <input
              type="checkbox"
              checked={withLive}
              onChange={(e) => setWithLive(e.target.checked)}
              className="accent-emerald-400"
            />
            включать лайв-матчи (в прематче цены спокойнее)
          </label>
          <button className="btn-primary w-full" onClick={load} disabled={loading}>
            {loading ? "Собираю экспрессы…" : "Найти экспрессы"}
          </button>
        </div>
      </div>

      <SourceStatus sources={sources} />
      {error && <ErrorBox error={error} hint={hint} onRetry={load} />}

      <div className="grid gap-4 sm:grid-cols-4">
        <Stat label="Матчей в линии" value={String(scanned)} sub={updated ? fmtTime(updated) : ""} />
        <Stat
          label={`Сравнимо (${prefs.minBooks}+ контор)`}
          value={String(comparable)}
          tone="accent"
        />
        <Stat label="Ног-кандидатов" value={String(candidateLegs)} tone="neutral" />
        <Stat
          label={`Найдено (≥ ${guarantee}%)`}
          value={String(rows.length)}
          tone={rows.length ? "good" : "neutral"}
        />
      </div>

      <div className="card-pad border-l-2 border-l-amber-400/60 text-xs leading-relaxed text-slate-400">
        «Гарантия» — произведение справедливых вероятностей ног (консенсус {prefs.minBooks}+
        контор, метод {prefs.method === "shin" ? "Shin" : "нормализация"}). Это оценка вероятности
        прохода, а не реальная гарантия: результаты матчей независимы, но не детерминированы.
        Экспресс — инструмент повышенного риска, ставьте сумму, которую готовы потерять полностью.
      </div>

      {loading && <Spinner label="Считаю вероятности и собираю экспрессы…" />}

      {!loading && rows.length === 0 && !error && (
        <div className="card-pad text-sm text-slate-400">
          <p className="mb-2 text-slate-200">
            Экспрессов с гарантией ≥ {guarantee}% сейчас нет.
          </p>
          <p className="text-slate-500">
            Чем выше гарантия, тем больше ног в экспрессе и тем выше требуется вероятность каждой
            ноги. Попробуйте: снизить гарантию (см. «Чуть ниже порога» ниже), разрешить больше ног
            или взять больший горизонт событий.
          </p>
        </div>
      )}

      <div className="space-y-3">
        {rows.map((e, i) => renderExpress(e, i))}
      </div>

      {nearMisses.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-medium text-slate-300">
            Чуть ниже порога (&lt; {guarantee}%)
          </h2>
          {nearMisses.map((e, i) => renderExpress(e, i, true))}
        </div>
      )}
    </div>
  );
}
