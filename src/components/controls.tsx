"use client";

import { SPORTS, type SportKey } from "@/lib/books/types";

export const BOOKS = [
  { key: "fonbet", title: "Фонбет" },
  { key: "ligastavok", title: "Лига Ставок" },
  { key: "winline", title: "Винлайн" },
  { key: "olimp", title: "Олимп" },
  { key: "betboom", title: "БетБум" },
  { key: "marathon", title: "Марафон" },
  { key: "pari", title: "ПАРИ" },
  { key: "zenit", title: "Зенитбет" },
];

export function BookToggle({
  value,
  onChange,
}: {
  value: string[];
  onChange: (v: string[]) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {BOOKS.map((b) => {
        const on = value.includes(b.key);
        return (
          <button
            key={b.key}
            type="button"
            onClick={() =>
              on
                ? value.length > 1 && onChange(value.filter((x) => x !== b.key))
                : onChange([...value, b.key])
            }
            className={`rounded-lg border px-3 py-1.5 text-sm transition ${
              on
                ? "border-good/50 bg-good/10 text-good"
                : "border-edge bg-slate-800/50 text-slate-400 hover:text-slate-200"
            }`}
          >
            {b.title}
          </button>
        );
      })}
    </div>
  );
}

export function SportSelect({
  value,
  onChange,
}: {
  value: SportKey;
  onChange: (v: SportKey) => void;
}) {
  return (
    <select className="input" value={value} onChange={(e) => onChange(e.target.value as SportKey)}>
      {SPORTS.map((s) => (
        <option key={s.key} value={s.key}>
          {s.title}
        </option>
      ))}
    </select>
  );
}

export function SportToggle({
  value,
  onChange,
  max = 4,
}: {
  value: SportKey[];
  onChange: (v: SportKey[]) => void;
  max?: number;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {SPORTS.map((s) => {
        const on = value.includes(s.key);
        return (
          <button
            key={s.key}
            type="button"
            onClick={() =>
              on
                ? value.length > 1 && onChange(value.filter((x) => x !== s.key))
                : value.length < max && onChange([...value, s.key])
            }
            className={`rounded-lg border px-3 py-1.5 text-sm transition ${
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
  );
}

export function SourceStatus({
  sources,
}: {
  sources?: { book: string; key: string; ok: boolean; count?: number; error?: string; ms?: number }[];
}) {
  if (!sources?.length) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {sources.map((s) => (
        <span
          key={s.key}
          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${
            s.ok ? "border-good/40 bg-good/5 text-good" : "border-bad/40 bg-bad/5 text-bad"
          }`}
          title={s.error || `${s.count ?? 0} событий, ${s.ms ?? 0} мс`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${s.ok ? "bg-good" : "bg-bad"}`} />
          {s.book}
          {s.ok ? (
            <span className="text-slate-500">{s.count ?? 0}</span>
          ) : (
            <span className="max-w-[160px] truncate text-slate-500">{s.error}</span>
          )}
        </span>
      ))}
    </div>
  );
}
