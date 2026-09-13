"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePrefs, qs } from "@/lib/prefs";
import { BookToggle, SportSelect, SourceStatus } from "@/components/controls";
import { Badge, ErrorBox, Spinner, fmtTime, timeUntil } from "@/components/ui";
import type { MarketView, SportKey } from "@/lib/books/types";

type Ev = {
  id: string;
  league: string;
  home: string;
  away: string;
  startTime: string;
  live: boolean;
  bookCount: number;
  books: { key: string; title: string; url?: string }[];
  markets: MarketView[];
};

type Src = { book: string; key: string; ok: boolean; count?: number; error?: string; ms?: number };

export default function LinePage() {
  const [prefs, setPrefs] = usePrefs();
  const [sport, setSport] = useState<SportKey>("football");
  const [events, setEvents] = useState<Ev[]>([]);
  const [sources, setSources] = useState<Src[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | undefined>();
  const [q, setQ] = useState("");
  const [onlyComparable, setOnlyComparable] = useState(true);
  const [liveFilter, setLiveFilter] = useState<"all" | "1" | "0">("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const [updated, setUpdated] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(
        `/api/line?${qs({
          sport,
          books: prefs.books.join(","),
          method: prefs.method,
          live: liveFilter === "all" ? undefined : liveFilter,
        })}`
      );
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setEvents(d.events || []);
      setSources(d.sources || []);
      setHint(d.hint);
      setUpdated(d.fetchedAt);
      if (d.hint) setError("Не удалось получить котировки ни от одной конторы");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setLoading(false);
    }
  }, [sport, prefs.books, prefs.method, liveFilter]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!prefs.autoRefreshSec) return;
    const t = setInterval(load, prefs.autoRefreshSec * 1000);
    return () => clearInterval(t);
  }, [prefs.autoRefreshSec, load]);

  const filtered = useMemo(
    () =>
      events.filter((e) => {
        if (onlyComparable && e.bookCount < 2) return false;
        const s = `${e.home} ${e.away} ${e.league}`.toLowerCase();
        return s.includes(q.toLowerCase());
      }),
    [events, q, onlyComparable]
  );

  return (
    <div className="space-y-5">
      <div className="card-pad space-y-4">
        <div className="grid gap-4 lg:grid-cols-3">
          <div>
            <label className="label">Вид спорта</label>
            <SportSelect value={sport} onChange={setSport} />
          </div>
          <div className="lg:col-span-2">
            <label className="label">Букмекеры</label>
            <BookToggle value={prefs.books} onChange={(b) => setPrefs({ ...prefs, books: b })} />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <input
            className="input max-w-xs"
            placeholder="Поиск команды или турнира…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <select
            className="input max-w-[170px]"
            value={liveFilter}
            onChange={(e) => setLiveFilter(e.target.value as "all" | "1" | "0")}
          >
            <option value="all">Все матчи</option>
            <option value="0">Только прематч</option>
            <option value="1">Только лайв</option>
          </select>
          <label className="flex items-center gap-2 text-sm text-slate-400">
            <input
              type="checkbox"
              checked={onlyComparable}
              onChange={(e) => setOnlyComparable(e.target.checked)}
              className="accent-cyan-400"
            />
            только матчи в 2+ конторах
          </label>
          <button className="btn-primary" onClick={load} disabled={loading}>
            {loading ? "Загружаю…" : "Обновить"}
          </button>
          {updated && <span className="text-xs text-slate-500">обновлено {fmtTime(updated)}</span>}
        </div>
        <SourceStatus sources={sources} />
      </div>

      {error && <ErrorBox error={error} hint={hint} onRetry={load} />}
      {loading && <Spinner label="Опрашиваю линии букмекеров…" />}

      {!loading && !error && filtered.length === 0 && (
        <p className="card-pad text-sm text-slate-500">
          Матчей не найдено. Снимите галку «только матчи в 2+ конторах» или выберите другой вид
          спорта.
        </p>
      )}

      <p className="text-xs text-slate-500">
        Показано {filtered.length} матчей. Зелёным отмечена лучшая цена по исходу среди выбранных
        контор.
      </p>

      <div className="space-y-4">
        {filtered.slice(0, 60).map((ev) => {
          const open = openId === ev.id;
          const main = ev.markets.find((m) => m.market === "moneyline");
          return (
            <article key={ev.id} className="card">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-edge px-4 py-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    {ev.live && <Badge tone="bad">LIVE</Badge>}
                    <p className="truncate font-medium text-white">
                      {ev.home} <span className="text-slate-600">—</span> {ev.away}
                    </p>
                  </div>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {ev.league} · {fmtTime(ev.startTime)} · {timeUntil(ev.startTime)}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone={ev.bookCount > 1 ? "accent" : "neutral"}>
                    {ev.bookCount} контор
                  </Badge>
                  <button
                    className="btn px-2 py-1 text-xs"
                    onClick={() => setOpenId(open ? null : ev.id)}
                  >
                    {open ? "свернуть" : `все рынки (${ev.markets.length})`}
                  </button>
                </div>
              </div>

              <div className="space-y-4 p-4">
                {(open ? ev.markets : main ? [main] : []).map((m) => (
                  <MarketBlock key={m.market} m={m} />
                ))}
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}

function MarketBlock({ m }: { m: MarketView }) {
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-slate-400">{m.label}</span>
        {m.overround != null && (
          <Badge tone={m.overround < 0 ? "good" : m.overround < 4 ? "accent" : "neutral"}>
            маржа лучших цен {m.overround.toFixed(2)}%
          </Badge>
        )}
        {m.overround != null && m.overround < 0 && <Badge tone="good">вилка!</Badge>}
      </div>
      <div className="table-wrap">
        <table className="w-full">
          <thead className="bg-slate-900/60">
            <tr>
              <th className="th">Исход</th>
              <th className="th">Лучшая цена</th>
              <th className="th">Контора</th>
              <th className="th">Вероятность</th>
              <th className="th">Все котировки</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-edge">
            {m.outcomes.map((o) => (
              <tr key={o.key}>
                <td className="td text-slate-100">{o.label}</td>
                <td className="td">
                  <span className="text-base font-semibold tabular-nums text-good">
                    {o.best.price.toFixed(2)}
                  </span>
                </td>
                <td className="td">
                  {o.best.url ? (
                    <a
                      href={o.best.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-accent underline"
                    >
                      {o.best.book}
                    </a>
                  ) : (
                    <span className="text-slate-300">{o.best.book}</span>
                  )}
                </td>
                <td className="td tabular-nums text-slate-400">
                  {o.fairProb != null ? `${(o.fairProb * 100).toFixed(1)}%` : "—"}
                </td>
                <td className="td">
                  <div className="flex flex-wrap gap-1.5">
                    {o.all.map((p) => (
                      <span
                        key={p.bookKey}
                        className={`rounded border px-1.5 py-0.5 text-xs tabular-nums ${
                          p.bookKey === o.best.bookKey
                            ? "border-good/50 bg-good/10 text-good"
                            : "border-edge bg-slate-800/50 text-slate-400"
                        }`}
                      >
                        {p.book} {p.price.toFixed(2)}
                      </span>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
