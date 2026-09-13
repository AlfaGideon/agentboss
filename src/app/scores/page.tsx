"use client";

import { useCallback, useEffect, useState } from "react";
import { SportSelect } from "@/components/controls";
import { Badge, ErrorBox, Spinner, fmtTime, timeUntil } from "@/components/ui";
import { qs } from "@/lib/prefs";
import type { ScoreEvent } from "@/lib/types";

export default function ScoresPage() {
  const [sport, setSport] = useState("soccer_epl");
  const [days, setDays] = useState(2);
  const [scores, setScores] = useState<ScoreEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updated, setUpdated] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/scores?${qs({ sport, daysFrom: days })}`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setScores(d.scores || []);
      setUpdated(d.fetchedAt);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setLoading(false);
    }
  }, [sport, days]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, [load]);

  const live = scores.filter((s) => !s.completed && +new Date(s.commence_time) <= Date.now());
  const upcoming = scores.filter((s) => +new Date(s.commence_time) > Date.now());
  const done = scores.filter((s) => s.completed);

  return (
    <div className="space-y-5">
      <div className="card-pad flex flex-wrap items-end gap-4">
        <div className="min-w-[240px] flex-1">
          <label className="label">Лига</label>
          <SportSelect value={sport} onChange={setSport} />
        </div>
        <div className="w-40">
          <label className="label">Глубина истории</label>
          <select className="input" value={days} onChange={(e) => setDays(Number(e.target.value))}>
            {[1, 2, 3].map((d) => (
              <option key={d} value={d}>
                {d} дн.
              </option>
            ))}
          </select>
        </div>
        <button className="btn-primary" onClick={load} disabled={loading}>
          {loading ? "Обновляю…" : "Обновить"}
        </button>
        {updated && <span className="text-xs text-slate-500">обновлено {fmtTime(updated)} · автообновление 60 с</span>}
      </div>

      {error && <ErrorBox error={error} onRetry={load} />}
      {loading && !scores.length && <Spinner label="Загружаю результаты…" />}

      <Section title="Идут сейчас" items={live} live />
      <Section title="Ближайшие матчи" items={upcoming} />
      <Section title="Завершённые" items={done} />
    </div>
  );
}

function Section({
  title,
  items,
  live = false,
}: {
  title: string;
  items: ScoreEvent[];
  live?: boolean;
}) {
  if (!items.length) return null;
  return (
    <section className="card">
      <div className="flex items-center gap-2 border-b border-edge px-4 py-3">
        {live && <span className="h-2 w-2 animate-pulse rounded-full bg-bad" />}
        <h3 className="font-medium text-white">{title}</h3>
        <span className="text-xs text-slate-500">{items.length}</span>
      </div>
      <ul className="divide-y divide-edge">
        {items.map((s) => {
          const home = s.scores?.find((x) => x.name === s.home_team)?.score;
          const away = s.scores?.find((x) => x.name === s.away_team)?.score;
          return (
            <li key={s.id} className="flex items-center justify-between gap-4 px-4 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm text-slate-100">
                  {s.home_team} <span className="text-slate-600">vs</span> {s.away_team}
                </p>
                <p className="text-xs text-slate-500">
                  {fmtTime(s.commence_time)} · {s.completed ? "завершён" : timeUntil(s.commence_time)}
                </p>
              </div>
              <div className="flex items-center gap-3">
                {home != null && away != null ? (
                  <span className="text-lg font-semibold tabular-nums text-slate-100">
                    {home} : {away}
                  </span>
                ) : (
                  <span className="text-sm text-slate-600">— : —</span>
                )}
                <Badge tone={s.completed ? "neutral" : live ? "bad" : "accent"}>
                  {s.completed ? "FT" : live ? "LIVE" : "скоро"}
                </Badge>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
