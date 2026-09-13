"use client";

import { useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { usePrefs } from "@/lib/prefs";
import { Badge, Stat, fmtTime, money, pct, useLocalStorage } from "@/components/ui";
import { bankrollStats } from "@/lib/math";
import type { TrackedBet } from "@/lib/types";

const EMPTY: Omit<TrackedBet, "id" | "createdAt"> = {
  sport: "",
  match: "",
  market: "Исход",
  selection: "",
  bookmaker: "",
  odds: 2,
  stake: 1000,
  status: "pending",
};

export default function TrackerPage() {
  const [prefs] = usePrefs();
  const [bets, setBets] = useLocalStorage<TrackedBet[]>("betscope.bets", []);
  const [form, setForm] = useState(EMPTY);
  const [filter, setFilter] = useState<"all" | TrackedBet["status"]>("all");
  const [showForm, setShowForm] = useState(false);

  const stats = bankrollStats(bets);

  const byBook = useMemo(() => groupBy(bets, (b) => b.bookmaker || "—"), [bets]);
  const byMarket = useMemo(() => groupBy(bets, (b) => b.market || "—"), [bets]);
  const bySport = useMemo(() => groupBy(bets, (b) => b.sport || "—"), [bets]);

  const filtered = bets
    .filter((b) => filter === "all" || b.status === filter)
    .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));

  const add = () => {
    if (!form.match || !form.selection) return;
    setBets([
      ...bets,
      { ...form, id: crypto.randomUUID(), createdAt: new Date().toISOString() },
    ]);
    setForm(EMPTY);
    setShowForm(false);
  };

  const update = (id: string, patch: Partial<TrackedBet>) =>
    setBets(bets.map((b) => (b.id === id ? { ...b, ...patch } : b)));

  const remove = (id: string) => setBets(bets.filter((b) => b.id !== id));

  const exportCsv = () => {
    const head = "date,sport,match,market,selection,bookmaker,odds,stake,status";
    const rows = bets.map((b) =>
      [b.createdAt, b.sport, b.match, b.market, b.selection, b.bookmaker, b.odds, b.stake, b.status]
        .map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`)
        .join(",")
    );
    const blob = new Blob([[head, ...rows].join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `betscope-bets-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  };

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Stat
          label="Прибыль"
          value={money(stats.profit, prefs.currency)}
          tone={stats.profit > 0 ? "good" : stats.profit < 0 ? "bad" : "neutral"}
          sub={`оборот ${money(stats.staked, prefs.currency)}`}
        />
        <Stat
          label="ROI"
          value={stats.staked ? pct(stats.roi) : "—"}
          tone={stats.roi > 0 ? "good" : stats.roi < 0 ? "bad" : "neutral"}
        />
        <Stat label="Проходимость" value={`${stats.winRate.toFixed(1)}%`} sub={`${stats.won}W / ${stats.lost}L`} />
        <Stat label="Средний коэф." value={stats.avgOdds ? stats.avgOdds.toFixed(2) : "—"} />
        <Stat
          label="Банкролл сейчас"
          value={money(prefs.bankroll + stats.profit, prefs.currency)}
          sub={`${stats.pending} в игре`}
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <button className="btn-primary" onClick={() => setShowForm(!showForm)}>
          {showForm ? "Отмена" : "+ Добавить ставку"}
        </button>
        <button className="btn" onClick={exportCsv} disabled={!bets.length}>
          Экспорт CSV
        </button>
        <div className="ml-auto flex gap-1">
          {(["all", "pending", "won", "lost", "void"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded-lg border px-2.5 py-1.5 text-xs transition ${
                filter === f
                  ? "border-accent/60 bg-accent/15 text-accent"
                  : "border-edge bg-slate-800/50 text-slate-400"
              }`}
            >
              {{ all: "Все", pending: "В игре", won: "Выигрыш", lost: "Проигрыш", void: "Возврат" }[f]}
            </button>
          ))}
        </div>
      </div>

      {showForm && (
        <div className="card-pad grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <Inp label="Матч" value={form.match} onChange={(v) => setForm({ ...form, match: v })} />
          <Inp label="Вид спорта / лига" value={form.sport} onChange={(v) => setForm({ ...form, sport: v })} />
          <Inp label="Рынок" value={form.market} onChange={(v) => setForm({ ...form, market: v })} />
          <Inp label="Выбор" value={form.selection} onChange={(v) => setForm({ ...form, selection: v })} />
          <Inp label="Букмекер" value={form.bookmaker} onChange={(v) => setForm({ ...form, bookmaker: v })} />
          <NumInp label="Коэффициент" value={form.odds} onChange={(v) => setForm({ ...form, odds: v })} step="0.01" />
          <NumInp label="Сумма" value={form.stake} onChange={(v) => setForm({ ...form, stake: v })} step="100" />
          <div>
            <label className="label">Статус</label>
            <select
              className="input"
              value={form.status}
              onChange={(e) => setForm({ ...form, status: e.target.value as TrackedBet["status"] })}
            >
              <option value="pending">В игре</option>
              <option value="won">Выигрыш</option>
              <option value="lost">Проигрыш</option>
              <option value="void">Возврат</option>
              <option value="cashout">Кэшаут</option>
            </select>
          </div>
          <div className="sm:col-span-3 lg:col-span-4">
            <button className="btn-primary" onClick={add}>
              Сохранить ставку
            </button>
          </div>
        </div>
      )}

      {stats.curve.length > 1 && (
        <div className="card-pad">
          <h3 className="mb-3 font-medium text-white">Кривая прибыли</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={stats.curve}>
                <defs>
                  <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#22d3ee" stopOpacity={0.5} />
                    <stop offset="100%" stopColor="#22d3ee" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#1f2937" strokeDasharray="3 3" />
                <XAxis dataKey="i" stroke="#64748b" fontSize={11} />
                <YAxis stroke="#64748b" fontSize={11} />
                <Tooltip
                  contentStyle={{
                    background: "#0f172a",
                    border: "1px solid #1f2937",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                />
                <Area dataKey="pnl" stroke="#22d3ee" fill="url(#g)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-3">
        <BreakdownCard title="По букмекерам" data={byBook} currency={prefs.currency} />
        <BreakdownCard title="По рынкам" data={byMarket} currency={prefs.currency} />
        <BreakdownCard title="По видам спорта" data={bySport} currency={prefs.currency} />
      </div>

      <div className="card">
        <div className="border-b border-edge px-4 py-3">
          <h3 className="font-medium text-white">История ставок ({filtered.length})</h3>
        </div>
        {filtered.length === 0 ? (
          <p className="p-6 text-sm text-slate-500">
            Пока пусто. Добавьте ставку вручную или отправьте сигнал со страницы ставок с перевесом.
          </p>
        ) : (
          <div className="table-wrap m-4">
            <table className="w-full">
              <thead className="bg-slate-900/60">
                <tr>
                  <th className="th">Дата</th>
                  <th className="th">Матч</th>
                  <th className="th">Выбор</th>
                  <th className="th">Контора</th>
                  <th className="th">Коэф.</th>
                  <th className="th">Сумма</th>
                  <th className="th">Статус</th>
                  <th className="th">P/L</th>
                  <th className="th"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-edge">
                {filtered.map((b) => {
                  const pl =
                    b.status === "won"
                      ? b.stake * b.odds - b.stake
                      : b.status === "lost"
                      ? -b.stake
                      : b.status === "cashout"
                      ? (b.cashoutReturn ?? b.stake) - b.stake
                      : 0;
                  return (
                    <tr key={b.id}>
                      <td className="td text-xs text-slate-500">{fmtTime(b.createdAt)}</td>
                      <td className="td">
                        <p className="text-slate-100">{b.match}</p>
                        <p className="text-xs text-slate-500">
                          {b.sport} · {b.market}
                        </p>
                      </td>
                      <td className="td text-slate-300">{b.selection}</td>
                      <td className="td text-slate-400">{b.bookmaker}</td>
                      <td className="td tabular-nums text-accent">{b.odds.toFixed(2)}</td>
                      <td className="td tabular-nums">{b.stake.toLocaleString("ru-RU")}</td>
                      <td className="td">
                        <select
                          className="rounded border border-edge bg-slate-900 px-2 py-1 text-xs"
                          value={b.status}
                          onChange={(e) =>
                            update(b.id, { status: e.target.value as TrackedBet["status"] })
                          }
                        >
                          <option value="pending">в игре</option>
                          <option value="won">выигрыш</option>
                          <option value="lost">проигрыш</option>
                          <option value="void">возврат</option>
                          <option value="cashout">кэшаут</option>
                        </select>
                      </td>
                      <td
                        className={`td tabular-nums ${
                          pl > 0 ? "text-good" : pl < 0 ? "text-bad" : "text-slate-500"
                        }`}
                      >
                        {b.status === "pending" ? "—" : money(pl, prefs.currency)}
                      </td>
                      <td className="td">
                        <button
                          className="text-xs text-slate-500 hover:text-bad"
                          onClick={() => remove(b.id)}
                        >
                          удалить
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function BreakdownCard({
  title,
  data,
  currency,
}: {
  title: string;
  data: { key: string; profit: number; staked: number; count: number }[];
  currency: string;
}) {
  if (!data.length)
    return (
      <div className="card-pad">
        <h3 className="mb-2 font-medium text-white">{title}</h3>
        <p className="text-sm text-slate-500">Недостаточно данных</p>
      </div>
    );
  return (
    <div className="card-pad">
      <h3 className="mb-3 font-medium text-white">{title}</h3>
      <div className="h-40">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data}>
            <CartesianGrid stroke="#1f2937" strokeDasharray="3 3" />
            <XAxis dataKey="key" stroke="#64748b" fontSize={10} interval={0} angle={-15} height={40} />
            <YAxis stroke="#64748b" fontSize={10} />
            <Tooltip
              contentStyle={{
                background: "#0f172a",
                border: "1px solid #1f2937",
                borderRadius: 8,
                fontSize: 12,
              }}
            />
            <Bar dataKey="profit" radius={[4, 4, 0, 0]}>
              {data.map((d, i) => (
                <Cell key={i} fill={d.profit >= 0 ? "#34d399" : "#f87171"} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <ul className="mt-3 space-y-1 text-xs">
        {data.slice(0, 5).map((d) => (
          <li key={d.key} className="flex justify-between">
            <span className="truncate pr-2 text-slate-400">
              {d.key} <span className="text-slate-600">({d.count})</span>
            </span>
            <span className={d.profit >= 0 ? "text-good" : "text-bad"}>
              {money(d.profit, currency)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function groupBy(bets: TrackedBet[], key: (b: TrackedBet) => string) {
  const m = new Map<string, { key: string; profit: number; staked: number; count: number }>();
  for (const b of bets) {
    if (b.status === "pending") continue;
    const k = key(b);
    const e = m.get(k) || { key: k, profit: 0, staked: 0, count: 0 };
    const ret =
      b.status === "won"
        ? b.stake * b.odds
        : b.status === "void"
        ? b.stake
        : b.status === "cashout"
        ? b.cashoutReturn ?? b.stake
        : 0;
    e.profit += ret - b.stake;
    e.staked += b.stake;
    e.count++;
    m.set(k, e);
  }
  return [...m.values()].sort((a, b) => b.profit - a.profit);
}

function Inp({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="label">{label}</label>
      <input className="input" value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function NumInp({
  label,
  value,
  onChange,
  step = "1",
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: string;
}) {
  return (
    <div>
      <label className="label">{label}</label>
      <input
        type="number"
        step={step}
        className="input"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}
