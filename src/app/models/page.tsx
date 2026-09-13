"use client";

import { useCallback, useEffect, useState } from "react";
import { SportSelect } from "@/components/controls";
import { Badge, ErrorBox, Spinner, fmtTime, pct } from "@/components/ui";
import { poissonMarkets, impliedProb, kellyFraction } from "@/lib/math";
import { qs, usePrefs } from "@/lib/prefs";

type BestRow = {
  outcome: string;
  point?: number;
  price: number;
  bookmaker: string;
  fairProb: number | null;
};

type EventLite = {
  id: string;
  home_team: string;
  away_team: string;
  commence_time: string;
  summary: { market: string; label: string; best: BestRow[]; overround: number | null }[];
};

export default function ModelsPage() {
  const [prefs] = usePrefs();
  const [sport, setSport] = useState("soccer_epl");
  const [events, setEvents] = useState<EventLite[]>([]);
  const [selected, setSelected] = useState<EventLite | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lh, setLh] = useState(1.5);
  const [la, setLa] = useState(1.2);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/odds?${qs({ sport, markets: "h2h,totals", regions: prefs.regions.join(",") })}`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setEvents(d.events || []);
      setSelected(d.events?.[0] ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setLoading(false);
    }
  }, [sport, prefs.regions]);

  useEffect(() => {
    load();
  }, [load]);

  // Калибровка λ по рыночному тоталу и перевесу фаворита
  useEffect(() => {
    if (!selected) return;
    const h2h = selected.summary.find((s) => s.market === "h2h");
    const totals = selected.summary.find((s) => s.market === "totals");
    let expTotal = 2.6;
    if (totals?.best?.length) {
      const lines = totals.best.map((b) => b.point).filter((p): p is number => p != null);
      if (lines.length) {
        const mid = lines.sort((a, b) => a - b)[Math.floor(lines.length / 2)];
        expTotal = mid;
      }
    }
    let share = 0.5;
    if (h2h?.best?.length) {
      const home = h2h.best.find((b) => b.outcome === selected.home_team);
      const away = h2h.best.find((b) => b.outcome === selected.away_team);
      if (home && away) {
        const ph = impliedProb(home.price);
        const pa = impliedProb(away.price);
        share = ph / (ph + pa);
      }
    }
    const strength = 0.5 + (share - 0.5) * 1.35;
    setLh(Number((expTotal * Math.min(Math.max(strength, 0.15), 0.85)).toFixed(2)));
    setLa(Number((expTotal * (1 - Math.min(Math.max(strength, 0.15), 0.85))).toFixed(2)));
  }, [selected]);

  const model = poissonMarkets(lh, la);
  const h2h = selected?.summary.find((s) => s.market === "h2h");

  const compare = (outcome: string, modelProb: number) => {
    const row = h2h?.best.find((b) => b.outcome === outcome);
    if (!row) return null;
    const edge = (row.price * modelProb - 1) * 100;
    return {
      price: row.price,
      bookmaker: row.bookmaker,
      fair: 1 / modelProb,
      edge,
      kelly: kellyFraction(row.price, modelProb) * prefs.kellyFraction * 100,
    };
  };

  return (
    <div className="space-y-5">
      <div className="card-pad grid gap-4 lg:grid-cols-3">
        <div>
          <label className="label">Лига</label>
          <SportSelect value={sport} onChange={setSport} />
        </div>
        <div className="lg:col-span-2">
          <label className="label">Матч</label>
          <select
            className="input"
            value={selected?.id ?? ""}
            onChange={(e) => setSelected(events.find((x) => x.id === e.target.value) ?? null)}
            disabled={!events.length}
          >
            {events.map((e) => (
              <option key={e.id} value={e.id}>
                {e.home_team} — {e.away_team} ({fmtTime(e.commence_time)})
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && <ErrorBox error={error} onRetry={load} />}
      {loading && <Spinner label="Загружаю матчи и линии…" />}

      {selected && !loading && (
        <>
          <div className="card-pad space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-medium text-white">
                Модель Пуассона: {selected.home_team} — {selected.away_team}
              </h3>
              <Badge tone="accent">λ калибруются по рыночному тоталу и линии 1X2</Badge>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <label className="label">xG хозяев (λ)</label>
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
                <label className="label">xG гостей (λ)</label>
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
                <p className="text-xl font-semibold text-slate-100">
                  {(model.btts * 100).toFixed(1)}%
                </p>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="border-b border-edge px-4 py-3">
              <h3 className="font-medium text-white">Модель против рынка</h3>
            </div>
            <div className="table-wrap m-4">
              <table className="w-full">
                <thead className="bg-slate-900/60">
                  <tr>
                    <th className="th">Исход</th>
                    <th className="th">Модель, %</th>
                    <th className="th">Справедливый коэф.</th>
                    <th className="th">Лучшая цена рынка</th>
                    <th className="th">Букмекер</th>
                    <th className="th">Перевес</th>
                    <th className="th">Kelly</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-edge">
                  {[
                    { name: selected.home_team, p: model.home },
                    { name: "Draw", p: model.draw },
                    { name: selected.away_team, p: model.away },
                  ].map((row) => {
                    const c = compare(row.name, row.p);
                    return (
                      <tr key={row.name}>
                        <td className="td text-slate-100">
                          {row.name === "Draw" ? "Ничья" : row.name}
                        </td>
                        <td className="td tabular-nums">{(row.p * 100).toFixed(1)}%</td>
                        <td className="td tabular-nums text-slate-300">{(1 / row.p).toFixed(2)}</td>
                        <td className="td tabular-nums text-accent">
                          {c ? c.price.toFixed(2) : "—"}
                        </td>
                        <td className="td text-slate-400">{c?.bookmaker ?? "—"}</td>
                        <td
                          className={`td tabular-nums ${
                            c && c.edge > 0 ? "text-good" : "text-slate-500"
                          }`}
                        >
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
              <h3 className="mb-3 font-medium text-white">Вероятности тоталов</h3>
              <div className="space-y-2">
                {Object.entries(model.totals).map(([k, v]) => {
                  const line = k.replace("over", "");
                  return (
                    <div key={k} className="flex items-center gap-3">
                      <span className="w-24 text-xs text-slate-400">ТБ {line}</span>
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-800">
                        <div
                          className="h-full rounded-full bg-accent/70"
                          style={{ width: `${v * 100}%` }}
                        />
                      </div>
                      <span className="w-16 text-right text-xs tabular-nums text-slate-300">
                        {(v * 100).toFixed(1)}%
                      </span>
                      <span className="w-14 text-right text-xs tabular-nums text-slate-500">
                        {(1 / v).toFixed(2)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="card-pad">
              <h3 className="mb-3 font-medium text-white">Вероятные счета</h3>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {model.topScores.map((s) => (
                  <div
                    key={s.score}
                    className="rounded-lg border border-edge bg-slate-900/60 p-2 text-center"
                  >
                    <p className="text-base font-semibold text-slate-100">{s.score}</p>
                    <p className="text-xs text-slate-500">{(s.p * 100).toFixed(1)}%</p>
                    <p className="text-[10px] text-slate-600">коэф {(1 / s.p).toFixed(1)}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <p className="text-xs text-slate-500">
            Модель предполагает независимость голов команд (чистый Пуассон) и занижает вероятность
            ничьих в низовых матчах. Используйте её как второе мнение к рыночному консенсусу, а не
            как единственный источник решения.
          </p>
        </>
      )}
    </div>
  );
}
