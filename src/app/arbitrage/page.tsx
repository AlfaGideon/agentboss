"use client";

import { useCallback, useEffect, useState } from "react";
import { usePrefs, qs, dnsParam } from "@/lib/prefs";
import { BookToggle, SportToggle, SourceStatus } from "@/components/controls";
import { Badge, ErrorBox, Spinner, Stat, fmtTime, money, pct, timeUntil } from "@/components/ui";
import { arbStakes } from "@/lib/math";
import { sportTitle } from "@/lib/books/types";

type Arb = {
  eventId: string;
  sport: string;
  league: string;
  match: string;
  startTime: string;
  live: boolean;
  marketLabel: string;
  profitPct: number;
  totalImplied: number;
  legs: { label: string; price: number; book: string; bookKey: string; url?: string; share: number }[];
};

export default function ArbitragePage() {
  const [prefs, setPrefs] = usePrefs();
  const [arbs, setArbs] = useState<Arb[]>([]);
  const [sources, setSources] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | undefined>();
  const [scanned, setScanned] = useState(0);
  const [comparable, setComparable] = useState(0);
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
          books: prefs.books.join(","),
          minProfit: prefs.minArbProfit,
          dns: dnsParam(prefs),
        })}`
      );
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setArbs(d.arbs || []);
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
  }, [prefs.sports, prefs.books, prefs.minArbProfit]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!prefs.autoRefreshSec) return;
    const t = setInterval(load, prefs.autoRefreshSec * 1000);
    return () => clearInterval(t);
  }, [prefs.autoRefreshSec, load]);

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
              <label className="label">Мин. прибыль, %</label>
              <input
                type="number"
                step="0.1"
                className="input"
                value={prefs.minArbProfit}
                onChange={(e) => setPrefs({ ...prefs, minArbProfit: Number(e.target.value) })}
              />
            </div>
            <div>
              <label className="label">Банк на вилку</label>
              <input
                type="number"
                className="input"
                value={stake}
                onChange={(e) => setStake(Number(e.target.value))}
              />
            </div>
          </div>
          <div>
            <label className="label">Округление ставок</label>
            <select
              className="input"
              value={rounding}
              onChange={(e) => setRounding(Number(e.target.value))}
            >
              <option value={1}>до 1 ₽</option>
              <option value={10}>до 10 ₽</option>
              <option value={100}>до 100 ₽</option>
            </select>
          </div>
          <button className="btn-primary w-full" onClick={load} disabled={loading}>
            {loading ? "Сканирую…" : "Сканировать"}
          </button>
        </div>
      </div>

      <SourceStatus sources={sources} />
      {error && <ErrorBox error={error} hint={hint} onRetry={load} />}

      <div className="grid gap-4 sm:grid-cols-4">
        <Stat label="Матчей найдено" value={String(scanned)} sub={updated ? fmtTime(updated) : ""} />
        <Stat label="Сравнимо (2+ конторы)" value={String(comparable)} tone="accent" />
        <Stat label="Вилок" value={String(arbs.length)} tone={arbs.length ? "good" : "neutral"} />
        <Stat
          label="Лучшая"
          value={arbs.length ? pct(arbs[0].profitPct) : "—"}
          tone={arbs.length ? "good" : "neutral"}
        />
      </div>

      {loading && <Spinner label="Сравниваю линии российских контор…" />}

      {!loading && arbs.length === 0 && !error && (
        <div className="card-pad text-sm text-slate-400">
          <p className="mb-2 text-slate-200">Вилок сейчас нет.</p>
          <ul className="list-disc space-y-1 pl-5 text-slate-500">
            <li>Это нормально: между крупными российскими конторами вилки живут секунды.</li>
            <li>Включите все четыре конторы и несколько видов спорта одновременно.</li>
            <li>Поставьте минимальную прибыль 0% или −1%, чтобы видеть близкие к вилке линии.</li>
            <li>Включите автообновление в настройках — сканер будет проверять линию сам.</li>
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
            <article key={`${a.eventId}-${a.marketLabel}-${i}`} className="card">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-edge px-4 py-3">
                <div>
                  <div className="flex items-center gap-2">
                    {a.live && <Badge tone="bad">ЛАЙВ</Badge>}
                    <p className="font-medium text-white">{a.match}</p>
                  </div>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {sportTitle(a.sport)} · {a.league} · {a.marketLabel} · {fmtTime(a.startTime)} ·{" "}
                    {timeUntil(a.startTime)}
                  </p>
                </div>
                <Badge tone="good">прибыль {pct(a.profitPct)}</Badge>
              </div>
              <div className="table-wrap m-4">
                <table className="w-full">
                  <thead className="bg-slate-900/60">
                    <tr>
                      <th className="th">Исход</th>
                      <th className="th">Контора</th>
                      <th className="th">Коэф.</th>
                      <th className="th">Ставка</th>
                      <th className="th">Выплата</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-edge">
                    {a.legs.map((l, j) => (
                      <tr key={j}>
                        <td className="td text-slate-100">{l.label}</td>
                        <td className="td">
                          {l.url ? (
                            <a href={l.url} target="_blank" rel="noreferrer" className="text-accent underline">
                              {l.book}
                            </a>
                          ) : (
                            l.book
                          )}
                        </td>
                        <td className="td tabular-nums text-good">{l.price.toFixed(2)}</td>
                        <td className="td tabular-nums">{money(rounded[j], prefs.currency)}</td>
                        <td className="td tabular-nums text-slate-300">
                          {money(payouts[j], prefs.currency)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-slate-900/40">
                    <tr>
                      <td className="td text-slate-400" colSpan={3}>
                        Итого
                      </td>
                      <td className="td tabular-nums">{money(totalRounded, prefs.currency)}</td>
                      <td className={`td tabular-nums font-medium ${worst > 0 ? "text-good" : "text-bad"}`}>
                        гарантия {money(worst, prefs.currency)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              <p className="px-4 pb-4 text-xs text-slate-500">
                Проверьте коэффициенты на сайтах контор перед ставкой — линия могла измениться.
                Помните: за систематический арбитраж букмекеры режут максимумы и закрывают счета.
              </p>
            </article>
          );
        })}
      </div>
    </div>
  );
}
