"use client";

import { useCallback, useEffect, useState } from "react";
import { usePrefs, qs } from "@/lib/prefs";
import { MarketToggle, MultiSportSelect, RegionToggle } from "@/components/controls";
import { Badge, ErrorBox, Spinner, Stat, fmtTime, money, pct, timeUntil } from "@/components/ui";
import { arbStakes } from "@/lib/math";
import type { ArbOpportunity } from "@/lib/types";

export default function ArbitragePage() {
  const [prefs, setPrefs] = usePrefs();
  const [arbs, setArbs] = useState<ArbOpportunity[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scanned, setScanned] = useState(0);
  const [updated, setUpdated] = useState<string | null>(null);
  const [stake, setStake] = useState(10000);
  const [rounding, setRounding] = useState(100);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(
        `/api/arbs?${qs({
          sports: prefs.sports.join(","),
          markets: prefs.markets.join(","),
          regions: prefs.regions.join(","),
          minProfit: prefs.minArbProfit,
        })}`
      );
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setArbs(d.arbs || []);
      setScanned(d.eventsScanned || 0);
      setUpdated(d.fetchedAt);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setLoading(false);
    }
  }, [prefs.sports, prefs.markets, prefs.regions, prefs.minArbProfit]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!prefs.autoRefreshSec) return;
    const t = setInterval(load, prefs.autoRefreshSec * 1000);
    return () => clearInterval(t);
  }, [prefs.autoRefreshSec, load]);

  const best = arbs[0]?.profitPct ?? 0;
  const avg = arbs.length ? arbs.reduce((a, b) => a + b.profitPct, 0) / arbs.length : 0;

  return (
    <div className="space-y-5">
      <div className="card-pad grid gap-4 lg:grid-cols-3">
        <div>
          <label className="label">Лиги для сканирования (до 6)</label>
          <MultiSportSelect
            value={prefs.sports}
            onChange={(s) => setPrefs({ ...prefs, sports: s })}
          />
        </div>
        <div className="space-y-4">
          <div>
            <label className="label">Рынки</label>
            <MarketToggle
              value={prefs.markets}
              onChange={(m) => setPrefs({ ...prefs, markets: m })}
            />
          </div>
          <div>
            <label className="label">Регионы</label>
            <RegionToggle
              value={prefs.regions}
              onChange={(r) => setPrefs({ ...prefs, regions: r })}
            />
          </div>
        </div>
        <div className="space-y-3">
          <div>
            <label className="label">Минимальная прибыль, %</label>
            <input
              type="number"
              step="0.1"
              className="input"
              value={prefs.minArbProfit}
              onChange={(e) => setPrefs({ ...prefs, minArbProfit: Number(e.target.value) })}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="label">Банк на вилку</label>
              <input
                type="number"
                className="input"
                value={stake}
                onChange={(e) => setStake(Number(e.target.value))}
              />
            </div>
            <div>
              <label className="label">Округление</label>
              <select
                className="input"
                value={rounding}
                onChange={(e) => setRounding(Number(e.target.value))}
              >
                <option value={1}>до 1</option>
                <option value={10}>до 10</option>
                <option value={100}>до 100</option>
              </select>
            </div>
          </div>
          <button className="btn-primary w-full" onClick={load} disabled={loading}>
            {loading ? "Сканирую рынки…" : "Сканировать"}
          </button>
        </div>
      </div>

      {error && <ErrorBox error={error} onRetry={load} />}

      <div className="grid gap-4 sm:grid-cols-4">
        <Stat label="Событий" value={String(scanned)} sub={updated ? fmtTime(updated) : ""} />
        <Stat label="Вилок" value={String(arbs.length)} tone={arbs.length ? "good" : "neutral"} />
        <Stat label="Лучшая" value={arbs.length ? pct(best) : "—"} tone="good" />
        <Stat label="Средняя" value={arbs.length ? pct(avg) : "—"} />
      </div>

      {loading && <Spinner label="Сравниваю линии букмекеров…" />}

      {!loading && arbs.length === 0 && !error && (
        <div className="card-pad text-sm text-slate-400">
          <p className="mb-2 text-slate-200">Вилок не найдено.</p>
          <ul className="list-disc space-y-1 pl-5 text-slate-500">
            <li>Добавьте больше лиг и регионов — арбитраж живёт на стыке рынков разных стран.</li>
            <li>Понизьте порог прибыли до 0 или отрицательного значения, чтобы увидеть близкие линии.</li>
            <li>Включите рынки «фора» и «тотал» — там расхождения встречаются чаще.</li>
          </ul>
        </div>
      )}

      <div className="space-y-4">
        {arbs.map((a, i) => {
          const stakes = arbStakes(a.legs, stake);
          const rounded = stakes.map((s) => Math.round(s.stake / rounding) * rounding);
          const totalRounded = rounded.reduce((x, y) => x + y, 0);
          const payouts = a.legs.map((l, j) => rounded[j] * l.price);
          const worst = Math.min(...payouts) - totalRounded;
          return (
            <article key={`${a.eventId}-${a.market}-${i}`} className="card">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-edge px-4 py-3">
                <div>
                  <p className="font-medium text-white">{a.match}</p>
                  <p className="text-xs text-slate-500">
                    {a.sportTitle} · {a.marketLabel} · {fmtTime(a.commenceTime)} ·{" "}
                    {timeUntil(a.commenceTime)}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone="good">прибыль {pct(a.profitPct)}</Badge>
                  <Badge>сумма вероятностей {(a.totalImplied * 100).toFixed(2)}%</Badge>
                </div>
              </div>
              <div className="table-wrap m-4">
                <table className="w-full">
                  <thead className="bg-slate-900/60">
                    <tr>
                      <th className="th">Исход</th>
                      <th className="th">Букмекер</th>
                      <th className="th">Коэф.</th>
                      <th className="th">Доля</th>
                      <th className="th">Ставка</th>
                      <th className="th">Выплата</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-edge">
                    {a.legs.map((l, j) => (
                      <tr key={j}>
                        <td className="td text-slate-100">
                          {l.outcome}
                          {l.point !== undefined ? ` ${l.point > 0 ? "+" : ""}${l.point}` : ""}
                        </td>
                        <td className="td text-slate-300">{l.bookmaker}</td>
                        <td className="td tabular-nums text-accent">{l.price.toFixed(2)}</td>
                        <td className="td tabular-nums text-slate-400">
                          {(l.stakeShare * 100).toFixed(1)}%
                        </td>
                        <td className="td tabular-nums">{money(rounded[j], prefs.currency)}</td>
                        <td className="td tabular-nums text-slate-300">
                          {money(payouts[j], prefs.currency)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-slate-900/40">
                    <tr>
                      <td className="td text-slate-400" colSpan={4}>
                        Итого вложено
                      </td>
                      <td className="td tabular-nums">{money(totalRounded, prefs.currency)}</td>
                      <td className="td tabular-nums font-medium text-good">
                        гарантия {money(worst, prefs.currency)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              <p className="px-4 pb-4 text-xs text-slate-500">
                Ставки рассчитаны так, чтобы прибыль была одинаковой при любом исходе. Проверьте
                лимиты и актуальность коэффициентов перед размещением — линии меняются за секунды.
              </p>
            </article>
          );
        })}
      </div>
    </div>
  );
}
