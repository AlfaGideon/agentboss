"use client";

import { useCallback, useEffect, useState } from "react";
import { SportSelect, SourceStatus } from "@/components/controls";
import { Badge, ErrorBox, Spinner, fmtTime, pct } from "@/components/ui";
import { poissonMarkets, impliedProb, kellyFraction } from "@/lib/math";
import { qs, usePrefs } from "@/lib/prefs";
import type { MarketView, SportKey } from "@/lib/books/types";

type Ev = {
  id: string;
  league: string;
  home: string;
  away: string;
  startTime: string;
  bookCount: number;
  markets: MarketView[];
};

export default function ModelsPage() {
  const [prefs] = usePrefs();
  const [sport, setSport] = useState<SportKey>("football");
  const [events, setEvents] = useState<Ev[]>([]);
  const [sources, setSources] = useState<any[]>([]);
  const [selected, setSelected] = useState<Ev | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | undefined>();
  const [lh, setLh] = useState(1.5);
  const [la, setLa] = useState(1.2);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/line?${qs({ sport, books: prefs.books.join(","), live: "0" })}`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      const list: Ev[] = (d.events || []).filter((e: Ev) =>
        e.markets.some((m) => m.market === "moneyline")
      );
      setEvents(list);
      setSources(d.sources || []);
      setHint(d.hint);
      setSelected(list[0] ?? null);
      if (d.hint) setError("Ни одна контора не ответила");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setLoading(false);
    }
  }, [sport, prefs.books]);

  useEffect(() => {
    load();
  }, [load]);

  // калибровка λ по рыночному тоталу и линии исхода
  useEffect(() => {
    if (!selected) return;
    const ml = selected.markets.find((m) => m.market === "moneyline");
    const totals = selected.markets.filter((m) => m.market.startsWith("total_"));
    let expTotal = 2.6;
    if (totals.length) {
      const lines = totals
        .map((t) => Number(t.market.replace("total_", "")))
        .filter((n) => Number.isFinite(n))
        .sort((a, b) => a - b);
      // линия, ближайшая к равным коэффициентам — рыночное ожидание
      let bestDiff = Infinity;
      for (const t of totals) {
        const over = t.outcomes.find((o) => o.key.startsWith("over"))?.best.price;
        const under = t.outcomes.find((o) => o.key.startsWith("under"))?.best.price;
        if (!over || !under) continue;
        const diff = Math.abs(over - under);
        if (diff < bestDiff) {
          bestDiff = diff;
          expTotal = Number(t.market.replace("total_", ""));
        }
      }
      if (!Number.isFinite(expTotal) && lines.length) expTotal = lines[Math.floor(lines.length / 2)];
    }
    let share = 0.5;
    if (ml) {
      const h = ml.outcomes.find((o) => o.key === "1")?.best.price;
      const a = ml.outcomes.find((o) => o.key === "2")?.best.price;
      if (h && a) {
        const ph = impliedProb(h);
        const pa = impliedProb(a);
        share = ph / (ph + pa);
      }
    }
    const strength = Math.min(Math.max(0.5 + (share - 0.5) * 1.35, 0.15), 0.85);
    setLh(Number((expTotal * strength).toFixed(2)));
    setLa(Number((expTotal * (1 - strength)).toFixed(2)));
  }, [selected]);

  const model = poissonMarkets(lh, la);
  const ml = selected?.markets.find((m) => m.market === "moneyline");

  const cmp = (key: string, p: number) => {
    const o = ml?.outcomes.find((x) => x.key === key);
    if (!o) return null;
    const edge = (o.best.price * p - 1) * 100;
    return {
      price: o.best.price,
      book: o.best.book,
      edge,
      kelly: kellyFraction(o.best.price, p) * prefs.kellyFraction * 100,
    };
  };

  return (
    <div className="space-y-5">
      <div className="card-pad grid gap-4 lg:grid-cols-3">
        <div>
          <label className="label">Вид спорта</label>
          <SportSelect value={sport} onChange={setSport} />
        </div>
        <div className="lg:col-span-2">
          <label className="label">Матч ({events.length} доступно)</label>
          <select
            className="input"
            value={selected?.id ?? ""}
            onChange={(e) => setSelected(events.find((x) => x.id === e.target.value) ?? null)}
            disabled={!events.length}
          >
            {events.map((e) => (
              <option key={e.id} value={e.id}>
                {e.home} — {e.away} ({fmtTime(e.startTime)})
              </option>
            ))}
          </select>
        </div>
      </div>

      <SourceStatus sources={sources} />
      {error && <ErrorBox error={error} hint={hint} onRetry={load} />}
      {loading && <Spinner label="Загружаю матчи…" />}

      {selected && !loading && (
        <>
          <div className="card-pad space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-medium text-white">
                Модель Пуассона: {selected.home} — {selected.away}
              </h3>
              <Badge tone="accent">λ калиброваны по линии {selected.bookCount} контор</Badge>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <label className="label">Ожидаемые голы хозяев</label>
                <input
                  type="range"
                  min={0.2}
                  max={4}
                  step={0.05}
                  value={lh}
                  onChange={(e) => setLh(Number(e.target.value))}
                  className="w-full accent-cyan-400"
                />
                <p className="text-sm tabular-nums text-slate-300">{lh.toFixed(2)}</p>
              </div>
              <div>
                <label className="label">Ожидаемые голы гостей</label>
                <input
                  type="range"
                  min={0.2}
                  max={4}
                  step={0.05}
                  value={la}
                  onChange={(e) => setLa(Number(e.target.value))}
                  className="w-full accent-cyan-400"
                />
                <p className="text-sm tabular-nums text-slate-300">{la.toFixed(2)}</p>
              </div>
              <div className="rounded-lg border border-edge bg-slate-900/60 p-3">
                <p className="text-xs text-slate-500">Ожидаемый тотал</p>
                <p className="text-xl font-semibold text-slate-100">{(lh + la).toFixed(2)}</p>
              </div>
              <div className="rounded-lg border border-edge bg-slate-900/60 p-3">
                <p className="text-xs text-slate-500">Обе забьют</p>
                <p className="text-xl font-semibold text-slate-100">{(model.btts * 100).toFixed(1)}%</p>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="border-b border-edge px-4 py-3">
              <h3 className="font-medium text-white">Модель против линии букмекеров</h3>
            </div>
            <div className="table-wrap m-4">
              <table className="w-full">
                <thead className="bg-slate-900/60">
                  <tr>
                    <th className="th">Исход</th>
                    <th className="th">Модель</th>
                    <th className="th">Справедливый</th>
                    <th className="th">Лучшая цена</th>
                    <th className="th">Контора</th>
                    <th className="th">Перевес</th>
                    <th className="th">Келли</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-edge">
                  {[
                    { key: "1", name: selected.home, p: model.home },
                    { key: "X", name: "Ничья", p: model.draw },
                    { key: "2", name: selected.away, p: model.away },
                  ].map((r) => {
                    const c = cmp(r.key, r.p);
                    return (
                      <tr key={r.key}>
                        <td className="td text-slate-100">{r.name}</td>
                        <td className="td tabular-nums">{(r.p * 100).toFixed(1)}%</td>
                        <td className="td tabular-nums text-slate-300">{(1 / r.p).toFixed(2)}</td>
                        <td className="td tabular-nums text-good">{c ? c.price.toFixed(2) : "—"}</td>
                        <td className="td text-slate-400">{c?.book ?? "—"}</td>
                        <td className={`td tabular-nums ${c && c.edge > 0 ? "text-good" : "text-slate-500"}`}>
                          {c ? pct(c.edge) : "—"}
                        </td>
                        <td className="td tabular-nums text-slate-300">
                          {c && c.edge > 0 ? `${c.kelly.toFixed(1)}%` : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <div className="card-pad">
              <h3 className="mb-3 font-medium text-white">Тоталы по модели</h3>
              <div className="space-y-2">
                {Object.entries(model.totals).map(([k, v]) => (
                  <div key={k} className="flex items-center gap-3">
                    <span className="w-20 text-xs text-slate-400">ТБ {k.replace("over", "")}</span>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-800">
                      <div className="h-full rounded-full bg-accent/70" style={{ width: `${v * 100}%` }} />
                    </div>
                    <span className="w-14 text-right text-xs tabular-nums text-slate-300">
                      {(v * 100).toFixed(1)}%
                    </span>
                    <span className="w-12 text-right text-xs tabular-nums text-slate-500">
                      {(1 / v).toFixed(2)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <div className="card-pad">
              <h3 className="mb-3 font-medium text-white">Вероятные счета</h3>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {model.topScores.map((s) => (
                  <div key={s.score} className="rounded-lg border border-edge bg-slate-900/60 p-2 text-center">
                    <p className="text-base font-semibold text-slate-100">{s.score}</p>
                    <p className="text-xs text-slate-500">{(s.p * 100).toFixed(1)}%</p>
                    <p className="text-[10px] text-slate-600">коэф {(1 / s.p).toFixed(1)}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <p className="text-xs text-slate-500">
            Чистый Пуассон предполагает независимость голов и занижает вероятность ничьих в низовых
            матчах. Используйте как второе мнение к рыночному консенсусу.
          </p>
        </>
      )}
    </div>
  );
}
