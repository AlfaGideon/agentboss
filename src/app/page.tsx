"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { usePrefs, qs } from "@/lib/prefs";
import { Badge, ErrorBox, Spinner, Stat, fmtTime, pct, timeUntil } from "@/components/ui";
import { bankrollStats } from "@/lib/math";
import type { ArbOpportunity, TrackedBet, ValueBet } from "@/lib/types";

export default function Dashboard() {
  const [prefs] = usePrefs();
  const [arbs, setArbs] = useState<ArbOpportunity[]>([]);
  const [value, setValue] = useState<ValueBet[]>([]);
  const [bets, setBets] = useState<TrackedBet[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scanned, setScanned] = useState(0);
  const [updated, setUpdated] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const base = {
        sports: prefs.sports.join(","),
        markets: prefs.markets.join(","),
        regions: prefs.regions.join(","),
      };
      const [a, v] = await Promise.all([
        fetch(`/api/arbs?${qs({ ...base, minProfit: prefs.minArbProfit })}`),
        fetch(
          `/api/value?${qs({
            ...base,
            minEdge: prefs.minEdge,
            minBooks: prefs.minBooks,
            method: prefs.method,
          })}`
        ),
      ]);
      const ad = await a.json();
      const vd = await v.json();
      if (!a.ok) throw new Error(ad.error);
      if (!v.ok) throw new Error(vd.error);
      setArbs(ad.arbs || []);
      setValue(vd.bets || []);
      setScanned(ad.eventsScanned || 0);
      setUpdated(new Date().toISOString());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка загрузки");
    } finally {
      setLoading(false);
    }
  }, [prefs.sports, prefs.markets, prefs.regions, prefs.minArbProfit, prefs.minEdge, prefs.minBooks, prefs.method]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("betscope.bets");
      if (raw) setBets(JSON.parse(raw));
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (!prefs.autoRefreshSec) return;
    const t = setInterval(load, prefs.autoRefreshSec * 1000);
    return () => clearInterval(t);
  }, [prefs.autoRefreshSec, load]);

  const stats = bankrollStats(bets);
  const topEdge = value[0]?.edgePct ?? 0;
  const topArb = arbs[0]?.profitPct ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-white">Обзор рынка</h2>
          <p className="text-sm text-slate-500">
            {prefs.sports.length} лиг · рынки: {prefs.markets.join(", ")} · регионы:{" "}
            {prefs.regions.join(", ")}
            {updated && ` · обновлено ${fmtTime(updated)}`}
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/settings" className="btn">
            Настройки сканера
          </Link>
          <button className="btn-primary" onClick={load} disabled={loading}>
            {loading ? "Сканирую…" : "Обновить"}
          </button>
        </div>
      </div>

      {error && <ErrorBox error={error} onRetry={load} />}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="Событий просканировано"
          value={loading ? "…" : String(scanned)}
          sub="актуальные котировки"
        />
        <Stat
          label="Найдено вилок"
          value={loading ? "…" : String(arbs.length)}
          sub={arbs.length ? `лучшая ${pct(topArb)}` : "нет возможностей"}
          tone={arbs.length ? "good" : "neutral"}
        />
        <Stat
          label="Value-ставок"
          value={loading ? "…" : String(value.length)}
          sub={value.length ? `макс. перевес ${pct(topEdge)}` : "нет перевеса"}
          tone={value.length ? "warn" : "neutral"}
        />
        <Stat
          label="ROI моих ставок"
          value={stats.count ? pct(stats.roi) : "—"}
          sub={`${stats.count} ставок · P/L ${stats.profit.toFixed(0)} ${prefs.currency}`}
          tone={stats.profit > 0 ? "good" : stats.profit < 0 ? "bad" : "neutral"}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <section className="card">
          <div className="flex items-center justify-between border-b border-edge px-4 py-3">
            <h3 className="font-medium text-white">Топ арбитражных возможностей</h3>
            <Link href="/arbitrage" className="text-xs text-accent underline">
              все вилки →
            </Link>
          </div>
          {loading ? (
            <Spinner />
          ) : arbs.length === 0 ? (
            <Empty text="Вилок по текущим фильтрам не найдено. Расширьте список лиг или регионов." />
          ) : (
            <ul className="divide-y divide-edge">
              {arbs.slice(0, 5).map((a, i) => (
                <li key={`${a.eventId}-${a.market}-${i}`} className="px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm text-slate-100">{a.match}</p>
                      <p className="text-xs text-slate-500">
                        {a.sportTitle} · {a.marketLabel} · {timeUntil(a.commenceTime)}
                      </p>
                    </div>
                    <Badge tone="good">{pct(a.profitPct)}</Badge>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {a.legs.map((l, j) => (
                      <span key={j} className="chip">
                        {l.outcome}
                        {l.point !== undefined ? ` ${l.point}` : ""} @{l.price.toFixed(2)} ·{" "}
                        <span className="text-slate-400">{l.bookmaker}</span>
                      </span>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card">
          <div className="flex items-center justify-between border-b border-edge px-4 py-3">
            <h3 className="font-medium text-white">Лучшие value-ставки</h3>
            <Link href="/value" className="text-xs text-accent underline">
              все ставки →
            </Link>
          </div>
          {loading ? (
            <Spinner />
          ) : value.length === 0 ? (
            <Empty text="Ставок с положительным ожиданием не найдено. Снизьте порог перевеса в настройках." />
          ) : (
            <ul className="divide-y divide-edge">
              {value.slice(0, 5).map((v, i) => (
                <li key={`${v.eventId}-${v.outcome}-${i}`} className="px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm text-slate-100">{v.match}</p>
                      <p className="text-xs text-slate-500">
                        {v.outcome}
                        {v.point !== undefined ? ` ${v.point}` : ""} · {v.bookmaker} @
                        {v.price.toFixed(2)}
                      </p>
                    </div>
                    <div className="text-right">
                      <Badge tone="warn">{pct(v.edgePct)}</Badge>
                      <p className="mt-1 text-[11px] text-slate-500">
                        Kelly {(v.kelly * prefs.kellyFraction * 100).toFixed(1)}%
                      </p>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="card">
        <div className="border-b border-edge px-4 py-3">
          <h3 className="font-medium text-white">Быстрые действия</h3>
        </div>
        <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
          <QuickLink
            href="/odds"
            title="Сравнить линии"
            desc="Лучшая цена по каждому исходу среди всех букмекеров"
          />
          <QuickLink
            href="/models"
            title="Модель матча"
            desc="Пуассон, ожидаемые голы, точный счёт и справедливые коэффициенты"
          />
          <QuickLink
            href="/calculators"
            title="Калькуляторы"
            desc="Kelly, хедж, дач-беттинг, экспресс, конвертер коэффициентов"
          />
          <QuickLink
            href="/tracker"
            title="Учёт ставок"
            desc="ROI, банкролл, разбивка по букмекерам и рынкам"
          />
        </div>
      </section>
    </div>
  );
}

function QuickLink({ href, title, desc }: { href: string; title: string; desc: string }) {
  return (
    <Link
      href={href}
      className="rounded-lg border border-edge bg-slate-900/50 p-4 transition hover:border-accent/50"
    >
      <p className="text-sm font-medium text-slate-100">{title}</p>
      <p className="mt-1 text-xs text-slate-500">{desc}</p>
    </Link>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="p-6 text-sm text-slate-500">{text}</p>;
}
