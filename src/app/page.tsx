"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { usePrefs, qs } from "@/lib/prefs";
import { SourceStatus } from "@/components/controls";
import { Badge, ErrorBox, Spinner, Stat, fmtTime, pct, timeUntil } from "@/components/ui";
import { bankrollStats } from "@/lib/math";
import { sportTitle } from "@/lib/books/types";
import type { TrackedBet } from "@/lib/types";

export default function Dashboard() {
  const [prefs] = usePrefs();
  const [arbs, setArbs] = useState<any[]>([]);
  const [value, setValue] = useState<any[]>([]);
  const [sources, setSources] = useState<any[]>([]);
  const [bets, setBets] = useState<TrackedBet[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | undefined>();
  const [scanned, setScanned] = useState(0);
  const [comparable, setComparable] = useState(0);
  const [updated, setUpdated] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const base = { sports: prefs.sports.join(","), books: prefs.books.join(",") };
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
      setSources(ad.sources || []);
      setScanned(ad.eventsScanned || 0);
      setComparable(ad.comparable || 0);
      setHint(ad.hint);
      setUpdated(ad.fetchedAt);
      if (ad.hint) setError("Ни одна контора не ответила");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка загрузки");
    } finally {
      setLoading(false);
    }
  }, [prefs.sports, prefs.books, prefs.minArbProfit, prefs.minEdge, prefs.minBooks, prefs.method]);

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

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-white">Обзор российского рынка ставок</h2>
          <p className="text-sm text-slate-500">
            {prefs.sports.map(sportTitle).join(", ")} · {prefs.books.length} контор
            {updated && ` · обновлено ${fmtTime(updated)}`}
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/settings" className="btn">
            Настройки
          </Link>
          <button className="btn-primary" onClick={load} disabled={loading}>
            {loading ? "Сканирую…" : "Обновить"}
          </button>
        </div>
      </div>

      <SourceStatus sources={sources} />
      {error && <ErrorBox error={error} hint={hint} onRetry={load} />}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Stat label="Матчей в линии" value={loading ? "…" : String(scanned)} />
        <Stat
          label="Сравнимо"
          value={loading ? "…" : String(comparable)}
          sub="есть в 2+ конторах"
          tone="accent"
        />
        <Stat
          label="Вилок"
          value={loading ? "…" : String(arbs.length)}
          sub={arbs.length ? `лучшая ${pct(arbs[0].profitPct)}` : "нет"}
          tone={arbs.length ? "good" : "neutral"}
        />
        <Stat
          label="Ставок с перевесом"
          value={loading ? "…" : String(value.length)}
          sub={value.length ? `макс. ${pct(value[0].edgePct)}` : "нет перевеса"}
          tone={value.length ? "warn" : "neutral"}
        />
        <Stat
          label="ROI моих ставок"
          value={stats.count ? pct(stats.roi) : "—"}
          sub={`${stats.count} ставок`}
          tone={stats.profit > 0 ? "good" : stats.profit < 0 ? "bad" : "neutral"}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <section className="card">
          <div className="flex items-center justify-between border-b border-edge px-4 py-3">
            <h3 className="font-medium text-white">Арбитражные ситуации</h3>
            <Link href="/arbitrage" className="text-xs text-accent underline">
              все вилки →
            </Link>
          </div>
          {loading ? (
            <Spinner />
          ) : arbs.length === 0 ? (
            <p className="p-6 text-sm text-slate-500">
              Вилок между выбранными конторами сейчас нет.
            </p>
          ) : (
            <ul className="divide-y divide-edge">
              {arbs.slice(0, 5).map((a, i) => (
                <li key={i} className="px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm text-slate-100">{a.match}</p>
                      <p className="text-xs text-slate-500">
                        {a.marketLabel} · {timeUntil(a.startTime)}
                      </p>
                    </div>
                    <Badge tone="good">{pct(a.profitPct)}</Badge>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {a.legs.map((l: any, j: number) => (
                      <span key={j} className="chip">
                        {l.label} @{l.price.toFixed(2)} ·{" "}
                        <span className="text-slate-400">{l.book}</span>
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
            <h3 className="font-medium text-white">Лучшие ставки с перевесом</h3>
            <Link href="/value" className="text-xs text-accent underline">
              все ставки →
            </Link>
          </div>
          {loading ? (
            <Spinner />
          ) : value.length === 0 ? (
            <p className="p-6 text-sm text-slate-500">Ставок с перевесом не найдено.</p>
          ) : (
            <ul className="divide-y divide-edge">
              {value.slice(0, 5).map((v, i) => (
                <li key={i} className="px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm text-slate-100">{v.match}</p>
                      <p className="text-xs text-slate-500">
                        {v.outcome} · {v.book} @{v.price.toFixed(2)}
                      </p>
                    </div>
                    <div className="text-right">
                      <Badge tone="warn">{pct(v.edgePct)}</Badge>
                      <p className="mt-1 text-[11px] text-slate-500">
                        Келли {(v.kelly * prefs.kellyFraction * 100).toFixed(1)}%
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
          <h3 className="font-medium text-white">Разделы</h3>
        </div>
        <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
          <Quick href="/line" title="Сравнение линий" desc="Лучшая цена по каждому исходу среди российских контор" />
          <Quick href="/models" title="Модель матча" desc="Пуассон, тоталы, точный счёт против линии букмекера" />
          <Quick href="/calculators" title="Калькуляторы" desc="Келли, вилка, хедж, экспресс, маржа, налог 13%" />
          <Quick href="/tracker" title="Мои ставки" desc="ROI, банкролл, разбивка по конторам" />
        </div>
      </section>
    </div>
  );
}

function Quick({ href, title, desc }: { href: string; title: string; desc: string }) {
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
