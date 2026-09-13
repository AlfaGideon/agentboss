"use client";

import { useEffect, useMemo, useState } from "react";
import type { Sport } from "@/lib/types";

export const MARKETS = [
  { key: "h2h", label: "Исход" },
  { key: "spreads", label: "Фора" },
  { key: "totals", label: "Тотал" },
];

export const REGION_OPTIONS = [
  { key: "eu", label: "Европа" },
  { key: "uk", label: "Великобритания" },
  { key: "us", label: "США" },
  { key: "au", label: "Австралия" },
];

export function useSports() {
  const [sports, setSports] = useState<Sport[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/sports")
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || "Ошибка загрузки видов спорта");
        return d;
      })
      .then((d) => alive && setSports(d.sports || []))
      .catch((e) => alive && setError(e.message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  const grouped = useMemo(() => {
    const g = new Map<string, Sport[]>();
    for (const s of sports) {
      const arr = g.get(s.group) || [];
      arr.push(s);
      g.set(s.group, arr);
    }
    return [...g.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [sports]);

  return { sports, grouped, loading, error };
}

export function SportSelect({
  value,
  onChange,
  className = "",
}: {
  value: string;
  onChange: (v: string) => void;
  className?: string;
}) {
  const { grouped, loading } = useSports();
  return (
    <select
      className={`input ${className}`}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={loading}
    >
      {loading && <option>Загрузка…</option>}
      {grouped.map(([group, items]) => (
        <optgroup key={group} label={group}>
          {items.map((s) => (
            <option key={s.key} value={s.key}>
              {s.title}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

export function MultiSportSelect({
  value,
  onChange,
  max = 6,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  max?: number;
}) {
  const { grouped, loading } = useSports();
  const [q, setQ] = useState("");
  const toggle = (k: string) => {
    if (value.includes(k)) onChange(value.filter((x) => x !== k));
    else if (value.length < max) onChange([...value, k]);
  };
  const filtered = grouped
    .map(([g, items]) => [g, items.filter((s) => s.title.toLowerCase().includes(q.toLowerCase()))] as const)
    .filter(([, items]) => items.length);

  return (
    <div className="space-y-2">
      <input
        className="input"
        placeholder={`Поиск лиги… (выбрано ${value.length}/${max})`}
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <div className="max-h-56 space-y-2 overflow-y-auto rounded-lg border border-edge bg-slate-900/60 p-2">
        {loading && <p className="p-2 text-xs text-slate-500">Загрузка списка лиг…</p>}
        {filtered.map(([group, items]) => (
          <div key={group}>
            <p className="px-1 py-1 text-[10px] uppercase tracking-wide text-slate-500">
              {group}
            </p>
            <div className="flex flex-wrap gap-1">
              {items.map((s) => {
                const on = value.includes(s.key);
                return (
                  <button
                    key={s.key}
                    type="button"
                    onClick={() => toggle(s.key)}
                    className={`rounded-md border px-2 py-1 text-xs transition ${
                      on
                        ? "border-accent/60 bg-accent/15 text-accent"
                        : "border-edge bg-slate-800/50 text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    {s.title}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function MarketToggle({
  value,
  onChange,
}: {
  value: string[];
  onChange: (v: string[]) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {MARKETS.map((m) => {
        const on = value.includes(m.key);
        return (
          <button
            key={m.key}
            type="button"
            onClick={() =>
              on
                ? value.length > 1 && onChange(value.filter((x) => x !== m.key))
                : onChange([...value, m.key])
            }
            className={`rounded-lg border px-3 py-1.5 text-sm transition ${
              on
                ? "border-accent/60 bg-accent/15 text-accent"
                : "border-edge bg-slate-800/50 text-slate-400 hover:text-slate-200"
            }`}
          >
            {m.label}
          </button>
        );
      })}
    </div>
  );
}

export function RegionToggle({
  value,
  onChange,
}: {
  value: string[];
  onChange: (v: string[]) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {REGION_OPTIONS.map((r) => {
        const on = value.includes(r.key);
        return (
          <button
            key={r.key}
            type="button"
            onClick={() =>
              on
                ? value.length > 1 && onChange(value.filter((x) => x !== r.key))
                : onChange([...value, r.key])
            }
            className={`rounded-lg border px-3 py-1.5 text-xs transition ${
              on
                ? "border-good/50 bg-good/10 text-good"
                : "border-edge bg-slate-800/50 text-slate-400 hover:text-slate-200"
            }`}
          >
            {r.label}
          </button>
        );
      })}
    </div>
  );
}
