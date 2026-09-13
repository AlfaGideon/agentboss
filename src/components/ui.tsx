"use client";

import { useEffect, useState } from "react";

export function Spinner({ label = "Загрузка данных…" }: { label?: string }) {
  return (
    <div className="flex items-center gap-3 p-6 text-sm text-slate-400">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-accent border-t-transparent" />
      {label}
    </div>
  );
}

export function ErrorBox({
  error,
  hint,
  onRetry,
}: {
  error: string;
  hint?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="card-pad border-bad/40 bg-bad/5">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 text-bad">⚠</span>
        <div className="flex-1">
          <p className="text-sm text-slate-200">{error}</p>
          {hint && (
            <div className="mt-3 rounded-lg border border-edge bg-slate-900/60 p-3 text-xs text-slate-400">
              {hint}
            </div>
          )}
          {onRetry && (
            <button className="btn mt-3" onClick={onRetry}>
              Повторить
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export function Stat({
  label,
  value,
  sub,
  tone = "neutral",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "neutral" | "good" | "bad" | "warn" | "accent";
}) {
  const toneCls =
    tone === "good"
      ? "text-good"
      : tone === "bad"
      ? "text-bad"
      : tone === "warn"
      ? "text-warn"
      : tone === "accent"
      ? "text-accent"
      : "text-slate-100";
  return (
    <div className="card-pad">
      <p className="text-xs uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${toneCls}`}>{value}</p>
      {sub && <p className="mt-1 text-xs text-slate-500">{sub}</p>}
    </div>
  );
}

export function Badge({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "good" | "bad" | "warn" | "accent";
}) {
  const map = {
    neutral: "border-edge bg-slate-800/60 text-slate-300",
    good: "border-good/40 bg-good/10 text-good",
    bad: "border-bad/40 bg-bad/10 text-bad",
    warn: "border-warn/40 bg-warn/10 text-warn",
    accent: "border-accent/40 bg-accent/10 text-accent",
  } as const;
  return (
    <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs ${map[tone]}`}>
      {children}
    </span>
  );
}

export function useLocalStorage<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(initial);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw) setValue(JSON.parse(raw) as T);
    } catch {
      /* ignore */
    }
    setLoaded(true);
  }, [key]);
  useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* ignore */
    }
  }, [key, value, loaded]);
  return [value, setValue, loaded] as const;
}

export function fmtTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function timeUntil(iso: string) {
  const diff = +new Date(iso) - Date.now();
  if (diff < 0) return "идёт / начался";
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  if (h > 24) return `через ${Math.floor(h / 24)} дн.`;
  return h > 0 ? `через ${h} ч ${m} мин` : `через ${m} мин`;
}

export const money = (n: number, cur = "₽") =>
  `${n < 0 ? "−" : ""}${Math.abs(n).toLocaleString("ru-RU", {
    maximumFractionDigits: 2,
  })} ${cur}`;

export const pct = (n: number, digits = 2) => `${n > 0 ? "+" : ""}${n.toFixed(digits)}%`;
