"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePrefs, qs } from "@/lib/prefs";
import { MarketToggle, RegionToggle, SportSelect } from "@/components/controls";
import { Badge, ErrorBox, Spinner, fmtTime, timeUntil } from "@/components/ui";
import { decimalToAmerican, decimalToFractional } from "@/lib/math";

type BestRow = {
  outcome: string;
  point?: number;
  price: number;
  bookmaker: string;
  bookmakerKey: string;
  fairProb: number | null;
  allPrices: { bookmaker: string; bookmakerKey: string; price: number }[];
};

type Ev = {
  id: string;
  sport_key: string;
  sport_title: string;
  commence_time: string;
  home_team: string;
  away_team: string;
  bookmakerCount: number;
  summary: { market: string; label: string; best: BestRow[]; overround: number | null }[];
  margins: { bookmaker: string; key: string; margin: number }[];
};

type Fmt = "decimal" | "american" | "fractional" | "prob";

export default function OddsPage() {
  const [prefs, setPrefs] = usePrefs();
  const [sport, setSport] = useState("soccer_epl");
  const [events, setEvents] = useState<Ev[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [fmt, setFmt] = useState<Fmt>("decimal");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [updated, setUpdated] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(
        `/api/odds?${qs({
          sport,
          markets: prefs.markets.join(","),
          regions: prefs.regions.join(","),
        })}`
      );
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setEvents(d.events || []);
      setUpdated(d.fetchedAt);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setLoading(false);
    }
  }, [sport, prefs.markets, prefs.regions]);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(
    () =>
      events.filter((e) =>
        `${e.home_team} ${e.away_team}`.toLowerCase().includes(q.toLowerCase())
      ),
    [events, q]
  );

  const fmtPrice = (p: number, fair?: number | null) => {
    if (fmt === "american") {
      const a = decimalToAmerican(p);
      return a > 0 ? `+${a}` : String(a);
    }
    if (fmt === "fractional") return decimalToFractional(p);
    if (fmt === "prob") return `${((fair ?? 1 / p) * 100).toFixed(1)}%`;
    return p.toFixed(2);
  };

  return (
    <div className="space-y-5">
      <div className="card-pad space-y-4">
        <div className="grid gap-4 lg:grid-cols-4">
          <div className="lg:col-span-2">
            <label className="label">Лига / вид спорта</label>
            <SportSelect value={sport} onChange={setSport} />
          </div>
          <div>
            <label className="label">Рынки</label>
            <MarketToggle
              value={prefs.markets}
              onChange={(m) => setPrefs({ ...prefs, markets: m })}
            />
          </div>
          <div>
            <label className="label">Регионы букмекеров</label>
            <RegionToggle
              value={prefs.regions}
              onChange={(r) => setPrefs({ ...prefs, regions: r })}
            />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <input
            className="input max-w-xs"
            placeholder="Поиск команды…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <select className="input max-w-[190px]" value={fmt} onChange={(e) => setFmt(e.target.value as Fmt)}>
            <option value="decimal">Десятичные</option>
            <option value="american">Американские</option>
            <option value="fractional">Дробные</option>
            <option value="prob">Вероятность (fair)</option>
          </select>
          <button className="btn-primary" onClick={load} disabled={loading}>
            {loading ? "Обновляю…" : "Обновить"}
          </button>
          {updated && (
            <span className="text-xs text-slate-500">обновлено {fmtTime(updated)}</span>
          )}
        </div>
      </div>

      {error && <ErrorBox error={error} onRetry={load} />}
      {loading && <Spinner label="Запрашиваю котировки букмекеров…" />}
      {!loading && !error && filtered.length === 0 && (
        <p className="card-pad text-sm text-slate-500">
          Событий не найдено. Возможно, у лиги сейчас нет матчей в росписи.
        </p>
      )}

      <div className="space-y-4">
        {filtered.map((ev) => (
          <article key={ev.id} className="card">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-edge px-4 py-3">
              <div>
                <p className="font-medium text-white">
                  {ev.home_team} <span className="text-slate-500">—</span> {ev.away_team}
                </p>
                <p className="text-xs text-slate-500">
                  {ev.sport_title} · {fmtTime(ev.commence_time)} · {timeUntil(ev.commence_time)} ·{" "}
                  {ev.bookmakerCount} букмекеров
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Link
                  href={`/models?sport=${ev.sport_key}&event=${ev.id}`}
                  className="text-xs text-accent underline"
                >
                  модель
                </Link>
                <button
                  className="btn px-2 py-1 text-xs"
                  onClick={() => setExpanded(expanded === ev.id ? null : ev.id)}
                >
                  {expanded === ev.id ? "скрыть маржу" : "маржа букмекеров"}
                </button>
              </div>
            </div>

            <div className="space-y-4 p-4">
              {ev.summary.map((s) => (
                <div key={s.market}>
                  <div className="mb-2 flex items-center gap-2">
                    <span className="text-xs font-medium uppercase tracking-wide text-slate-400">
                      {s.label}
                    </span>
                    {s.overround != null && (
                      <Badge tone={s.overround < 0 ? "good" : s.overround < 3 ? "accent" : "neutral"}>
                        маржа лучших цен {s.overround.toFixed(2)}%
                      </Badge>
                    )}
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {s.best.map((b, i) => (
                      <div
                        key={i}
                        className="rounded-lg border border-edge bg-slate-900/50 p-3"
                      >
                        <div className="flex items-center justify-between">
                          <p className="text-sm text-slate-200">
                            {b.outcome}
                            {b.point !== undefined && (
                              <span className="text-slate-500"> {b.point > 0 ? "+" : ""}{b.point}</span>
                            )}
                          </p>
                          <p className="text-lg font-semibold tabular-nums text-accent">
                            {fmtPrice(b.price, b.fairProb)}
                          </p>
                        </div>
                        <p className="mt-0.5 text-xs text-slate-500">лучшая у {b.bookmaker}</p>
                        <div className="mt-2 space-y-0.5">
                          {[...b.allPrices]
                            .sort((x, y) => y.price - x.price)
                            .slice(0, 4)
                            .map((p, j) => (
                              <div
                                key={j}
                                className="flex justify-between text-[11px] text-slate-500"
                              >
                                <span className="truncate pr-2">{p.bookmaker}</span>
                                <span className="tabular-nums">{p.price.toFixed(2)}</span>
                              </div>
                            ))}
                          {b.allPrices.length > 4 && (
                            <p className="text-[11px] text-slate-600">
                              +{b.allPrices.length - 4} букмекеров
                            </p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}

              {expanded === ev.id && (
                <div className="table-wrap">
                  <table className="w-full">
                    <thead className="bg-slate-900/60">
                      <tr>
                        <th className="th">Букмекер</th>
                        <th className="th">Маржа (overround)</th>
                        <th className="th">Оценка</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-edge">
                      {[...ev.margins]
                        .sort((a, b) => a.margin - b.margin)
                        .map((m) => (
                          <tr key={m.key}>
                            <td className="td">{m.bookmaker}</td>
                            <td className="td tabular-nums">{m.margin.toFixed(2)}%</td>
                            <td className="td">
                              <Badge
                                tone={m.margin < 3 ? "good" : m.margin < 6 ? "warn" : "bad"}
                              >
                                {m.margin < 3 ? "острые линии" : m.margin < 6 ? "средние" : "высокая маржа"}
                              </Badge>
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
