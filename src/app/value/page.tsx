"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePrefs, qs, dnsParam } from "@/lib/prefs";
import { BookToggle, SportToggle, SourceStatus } from "@/components/controls";
import { Badge, ErrorBox, Spinner, Stat, fmtTime, money, pct, timeUntil } from "@/components/ui";
import { sportTitle } from "@/lib/books/types";
import type { TrackedBet } from "@/lib/types";

type Val = {
  eventId: string;
  sport: string;
  league: string;
  match: string;
  startTime: string;
  live: boolean;
  marketLabel: string;
  outcome: string;
  book: string;
  bookKey: string;
  url?: string;
  price: number;
  fairPrice: number;
  fairProb: number;
  edgePct: number;
  evPer100: number;
  kelly: number;
  booksCount: number;
};

export default function ValuePage() {
  const [prefs, setPrefs] = usePrefs();
  const [bets, setBets] = useState<Val[]>([]);
  const [sources, setSources] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | undefined>();
  const [scanned, setScanned] = useState(0);
  const [comparable, setComparable] = useState(0);
  const [updated, setUpdated] = useState<string | null>(null);
  const [sort, setSort] = useState<"edge" | "ev" | "kelly" | "time">("edge");
  const [maxOdds, setMaxOdds] = useState(15);
  const [saved, setSaved] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(
        `/api/value?${qs({
          sports: prefs.sports.join(","),
          books: prefs.books.join(","),
          minEdge: prefs.minEdge,
          minBooks: prefs.minBooks,
          method: prefs.method,
          dns: dnsParam(prefs),
        })}`
      );
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setBets(d.bets || []);
      setSources(d.sources || []);
      setScanned(d.eventsScanned || 0);
      setComparable(d.comparable || 0);
      setHint(d.hint);
      setUpdated(d.fetchedAt);
      if (d.hint) setError("Не удалось получить котировки ни от одной конторы");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setLoading(false);
    }
  }, [prefs.sports, prefs.books, prefs.minEdge, prefs.minBooks, prefs.method]);

  useEffect(() => {
    load();
  }, [load]);

  const rows = useMemo(() => {
    const f = bets.filter((b) => b.price <= maxOdds);
    return [...f].sort((a, b) => {
      if (sort === "edge") return b.edgePct - a.edgePct;
      if (sort === "ev") return b.evPer100 - a.evPer100;
      if (sort === "kelly") return b.kelly - a.kelly;
      return +new Date(a.startTime) - +new Date(b.startTime);
    });
  }, [bets, sort, maxOdds]);

  const addToTracker = (v: Val, stake: number) => {
    const bet: TrackedBet = {
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      eventDate: v.startTime,
      sport: sportTitle(v.sport),
      match: v.match,
      market: v.marketLabel,
      selection: v.outcome,
      bookmaker: v.book,
      odds: v.price,
      stake,
      status: "pending",
      tags: ["value", `перевес ${v.edgePct.toFixed(1)}%`],
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

  return (
    <div className="space-y-5">
      <div className="card-pad grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <div>
            <label className="label">Виды спорта (все доступны)</label>
            <SportToggle value={prefs.sports} onChange={(s) => setPrefs({ ...prefs, sports: s })} />
          </div>
          <div>
            <label className="label">Букмекеры</label>
            <BookToggle value={prefs.books} onChange={(b) => setPrefs({ ...prefs, books: b })} />
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
              <label className="label">Мин. контор</label>
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
              <label className="label">Макс. коэф.</label>
              <input
                type="number"
                className="input"
                value={maxOdds}
                onChange={(e) => setMaxOdds(Number(e.target.value))}
              />
            </div>
            <div>
              <label className="label">Сортировка</label>
              <select className="input" value={sort} onChange={(e) => setSort(e.target.value as any)}>
                <option value="edge">По перевесу</option>
                <option value="ev">По прибыли</option>
                <option value="kelly">По Келли</option>
                <option value="time">По времени</option>
              </select>
            </div>
          </div>
          <button className="btn-primary w-full" onClick={load} disabled={loading}>
            {loading ? "Анализирую…" : "Найти перевес"}
          </button>
        </div>
      </div>

      <SourceStatus sources={sources} />
      {error && <ErrorBox error={error} hint={hint} onRetry={load} />}

      <div className="grid gap-4 sm:grid-cols-4">
        <Stat label="Матчей" value={String(scanned)} sub={updated ? fmtTime(updated) : ""} />
        <Stat label={`Сравнимо (${prefs.minBooks}+ контор)`} value={String(comparable)} tone="accent" />
        <Stat label="Сигналов" value={String(rows.length)} tone={rows.length ? "warn" : "neutral"} />
        <Stat
          label="Банк / доля Келли"
          value={`${(prefs.kellyFraction * 100).toFixed(0)}%`}
          sub={money(prefs.bankroll, prefs.currency)}
        />
      </div>

      {loading && <Spinner label="Считаю консенсус российских контор…" />}

      {!loading && rows.length === 0 && !error && (
        <div className="card-pad text-sm text-slate-400">
          <p className="mb-2 text-slate-200">Ставок с перевесом не найдено.</p>
          <p className="text-slate-500">
            Снизьте минимальный перевес или требуемое число контор. Для консенсуса нужно, чтобы один
            матч нашёлся минимум в {prefs.minBooks} конторах одновременно.
          </p>
        </div>
      )}

      <div className="space-y-3">
        {rows.map((v, i) => {
          const suggestion = prefs.bankroll * v.kelly * prefs.kellyFraction;
          const key = v.eventId + v.outcome;
          return (
            <article key={`${key}-${i}`} className="card-pad">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    {v.live && <Badge tone="bad">ЛАЙВ</Badge>}
                    <p className="font-medium text-white">{v.match}</p>
                    <Badge>{sportTitle(v.sport)}</Badge>
                    <Badge>{v.marketLabel}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    {v.league} · {fmtTime(v.startTime)} · {timeUntil(v.startTime)} · консенсус по{" "}
                    {v.booksCount} конторам
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <span className="chip">
                      Ставка: <b className="text-slate-100">{v.outcome}</b>
                    </span>
                    <span className="chip">
                      Контора:{" "}
                      {v.url ? (
                        <a href={v.url} target="_blank" rel="noreferrer" className="text-accent underline">
                          {v.book}
                        </a>
                      ) : (
                        <b className="text-slate-100">{v.book}</b>
                      )}
                    </span>
                    <span className="chip">
                      Коэф: <b className="text-good">{v.price.toFixed(2)}</b>
                    </span>
                    <span className="chip">
                      Справедливый: <b className="text-slate-300">{v.fairPrice.toFixed(2)}</b>
                    </span>
                    <span className="chip">
                      Вероятность: <b className="text-slate-300">{(v.fairProb * 100).toFixed(1)}%</b>
                    </span>
                  </div>
                </div>
                <div className="grid min-w-[210px] gap-2 text-right">
                  <div>
                    <p className="text-xs text-slate-500">Перевес</p>
                    <p className="text-2xl font-semibold tabular-nums text-warn">{pct(v.edgePct)}</p>
                  </div>
                  <div className="flex justify-end gap-4 text-xs text-slate-400">
                    <span>
                      Прибыль/100: <b className="text-good">{v.evPer100.toFixed(1)}</b>
                    </span>
                    <span>
                      Келли: <b className="text-slate-200">{(v.kelly * 100).toFixed(1)}%</b>
                    </span>
                  </div>
                  <div className="rounded-lg border border-edge bg-slate-900/60 p-2 text-xs">
                    <p className="text-slate-500">Рекомендуемая ставка</p>
                    <p className="text-base font-medium text-slate-100">
                      {money(suggestion, prefs.currency)}
                    </p>
                  </div>
                  <button className="btn text-xs" onClick={() => addToTracker(v, Math.round(suggestion))}>
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
