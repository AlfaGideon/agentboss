"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePrefs, qs } from "@/lib/prefs";
import { MarketToggle, MultiSportSelect, RegionToggle } from "@/components/controls";
import { Badge, ErrorBox, Spinner, Stat, fmtTime, money, pct, timeUntil } from "@/components/ui";
import type { TrackedBet, ValueBet } from "@/lib/types";

type SortKey = "edge" | "ev" | "kelly" | "time" | "price";

export default function ValuePage() {
  const [prefs, setPrefs] = usePrefs();
  const [bets, setBets] = useState<ValueBet[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updated, setUpdated] = useState<string | null>(null);
  const [scanned, setScanned] = useState(0);
  const [sort, setSort] = useState<SortKey>("edge");
  const [maxOdds, setMaxOdds] = useState(15);
  const [saved, setSaved] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(
        `/api/value?${qs({
          sports: prefs.sports.join(","),
          markets: prefs.markets.join(","),
          regions: prefs.regions.join(","),
          minEdge: prefs.minEdge,
          minBooks: prefs.minBooks,
          method: prefs.method,
        })}`
      );
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setBets(d.bets || []);
      setScanned(d.eventsScanned || 0);
      setUpdated(d.fetchedAt);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setLoading(false);
    }
  }, [prefs.sports, prefs.markets, prefs.regions, prefs.minEdge, prefs.minBooks, prefs.method]);

  useEffect(() => {
    load();
  }, [load]);

  const rows = useMemo(() => {
    const f = bets.filter((b) => b.price <= maxOdds);
    const s = [...f];
    s.sort((a, b) => {
      if (sort === "edge") return b.edgePct - a.edgePct;
      if (sort === "ev") return b.evPer100 - a.evPer100;
      if (sort === "kelly") return b.kelly - a.kelly;
      if (sort === "price") return b.price - a.price;
      return +new Date(a.commenceTime) - +new Date(b.commenceTime);
    });
    return s;
  }, [bets, sort, maxOdds]);

  const addToTracker = (v: ValueBet, stake: number) => {
    const bet: TrackedBet = {
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      eventDate: v.commenceTime,
      sport: v.sportTitle,
      match: v.match,
      market: v.marketLabel,
      selection: `${v.outcome}${v.point !== undefined ? ` ${v.point}` : ""}`,
      bookmaker: v.bookmaker,
      odds: v.price,
      stake,
      status: "pending",
      tags: ["value", `edge ${v.edgePct.toFixed(1)}%`],
    };
    try {
      const raw = localStorage.getItem("betscope.bets");
      const list: TrackedBet[] = raw ? JSON.parse(raw) : [];
      list.push(bet);
      localStorage.setItem("betscope.bets", JSON.stringify(list));
      setSaved(v.eventId + v.outcome);
      setTimeout(() => setSaved(null), 2000);
    } catch {
      /* ignore */
    }
  };

  const totalEv = rows.reduce((a, b) => a + b.evPer100, 0);

  return (
    <div className="space-y-5">
      <div className="card-pad grid gap-4 lg:grid-cols-3">
        <div>
          <label className="label">Лиги (до 6)</label>
          <MultiSportSelect
            value={prefs.sports}
            onChange={(s) => setPrefs({ ...prefs, sports: s })}
          />
        </div>
        <div className="space-y-4">
          <div>
            <label className="label">Рынки</label>
            <MarketToggle value={prefs.markets} onChange={(m) => setPrefs({ ...prefs, markets: m })} />
          </div>
          <div>
            <label className="label">Регионы</label>
            <RegionToggle value={prefs.regions} onChange={(r) => setPrefs({ ...prefs, regions: r })} />
          </div>
          <div>
            <label className="label">Метод расчёта справедливой цены</label>
            <select
              className="input"
              value={prefs.method}
              onChange={(e) =>
                setPrefs({ ...prefs, method: e.target.value as "shin" | "multiplicative" })
              }
            >
              <option value="shin">Shin (учёт инсайд-торговли)</option>
              <option value="multiplicative">Пропорциональное снятие маржи</option>
            </select>
          </div>
        </div>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="label">Мин. перевес, %</label>
              <input
                type="number"
                step="0.5"
                className="input"
                value={prefs.minEdge}
                onChange={(e) => setPrefs({ ...prefs, minEdge: Number(e.target.value) })}
              />
            </div>
            <div>
              <label className="label">Мин. букмекеров</label>
              <input
                type="number"
                className="input"
                value={prefs.minBooks}
                onChange={(e) => setPrefs({ ...prefs, minBooks: Number(e.target.value) })}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="label">Макс. коэффициент</label>
              <input
                type="number"
                className="input"
                value={maxOdds}
                onChange={(e) => setMaxOdds(Number(e.target.value))}
              />
            </div>
            <div>
              <label className="label">Сортировка</label>
              <select className="input" value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
                <option value="edge">По перевесу</option>
                <option value="ev">По EV</option>
                <option value="kelly">По Kelly</option>
                <option value="price">По коэффициенту</option>
                <option value="time">По времени начала</option>
              </select>
            </div>
          </div>
          <button className="btn-primary w-full" onClick={load} disabled={loading}>
            {loading ? "Анализирую…" : "Найти value-ставки"}
          </button>
        </div>
      </div>

      {error && <ErrorBox error={error} onRetry={load} />}

      <div className="grid gap-4 sm:grid-cols-4">
        <Stat label="Событий" value={String(scanned)} sub={updated ? fmtTime(updated) : ""} />
        <Stat label="Сигналов" value={String(rows.length)} tone={rows.length ? "warn" : "neutral"} />
        <Stat
          label="Сумма EV"
          value={rows.length ? `${totalEv.toFixed(1)}` : "—"}
          sub="на 100 ед. ставки каждая"
          tone={totalEv > 0 ? "good" : "neutral"}
        />
        <Stat
          label="Банк / Kelly"
          value={`${(prefs.kellyFraction * 100).toFixed(0)}%`}
          sub={`банкролл ${money(prefs.bankroll, prefs.currency)}`}
        />
      </div>

      {loading && <Spinner label="Считаю консенсус рынка и ищу перевес…" />}

      {!loading && rows.length === 0 && !error && (
        <div className="card-pad text-sm text-slate-400">
          <p className="mb-2 text-slate-200">Ставок с перевесом не найдено.</p>
          <p className="text-slate-500">
            Понизьте минимальный перевес, уменьшите требуемое число букмекеров или добавьте лиги.
            Метод сравнивает цену конкретной конторы с бездорожным консенсусом рынка.
          </p>
        </div>
      )}

      <div className="space-y-3">
        {rows.map((v, i) => {
          const stakeSuggestion = prefs.bankroll * v.kelly * prefs.kellyFraction;
          const key = v.eventId + v.outcome;
          return (
            <article key={`${key}-${i}`} className="card-pad">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium text-white">{v.match}</p>
                    <Badge>{v.sportTitle}</Badge>
                    <Badge>{v.marketLabel}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    {fmtTime(v.commenceTime)} · {timeUntil(v.commenceTime)} · консенсус по{" "}
                    {v.booksCount} букмекерам
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <span className="chip">
                      Ставка: <b className="text-slate-100">
                        {v.outcome}
                        {v.point !== undefined ? ` ${v.point > 0 ? "+" : ""}${v.point}` : ""}
                      </b>
                    </span>
                    <span className="chip">
                      Контора: <b className="text-slate-100">{v.bookmaker}</b>
                    </span>
                    <span className="chip">
                      Коэф: <b className="text-accent">{v.price.toFixed(2)}</b>
                    </span>
                    <span className="chip">
                      Справедливый: <b className="text-slate-300">{v.fairPrice.toFixed(2)}</b>
                    </span>
                    <span className="chip">
                      Вероятность: <b className="text-slate-300">{(v.fairProb * 100).toFixed(1)}%</b>
                    </span>
                  </div>
                </div>
                <div className="grid min-w-[220px] gap-2 text-right">
                  <div>
                    <p className="text-xs text-slate-500">Перевес</p>
                    <p className="text-2xl font-semibold text-warn tabular-nums">
                      {pct(v.edgePct)}
                    </p>
                  </div>
                  <div className="flex justify-end gap-4 text-xs text-slate-400">
                    <span>
                      EV на 100: <b className="text-good">{v.evPer100.toFixed(1)}</b>
                    </span>
                    <span>
                      Kelly: <b className="text-slate-200">{(v.kelly * 100).toFixed(1)}%</b>
                    </span>
                  </div>
                  <div className="rounded-lg border border-edge bg-slate-900/60 p-2 text-xs">
                    <p className="text-slate-500">Рекомендуемая ставка</p>
                    <p className="text-base font-medium text-slate-100">
                      {money(stakeSuggestion, prefs.currency)}
                    </p>
                    <p className="text-[10px] text-slate-600">
                      {(prefs.kellyFraction * 100).toFixed(0)}% Kelly от банка
                    </p>
                  </div>
                  <button
                    className="btn text-xs"
                    onClick={() => addToTracker(v, Math.round(stakeSuggestion))}
                  >
                    {saved === key ? "✓ добавлено" : "В мои ставки"}
                  </button>
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
