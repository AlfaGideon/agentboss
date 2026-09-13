"use client";

import { useEffect, useState } from "react";
import { DEFAULT_PREFS, usePrefs } from "@/lib/prefs";
import { MarketToggle, MultiSportSelect, RegionToggle } from "@/components/controls";
import { Badge, Stat, fmtTime } from "@/components/ui";

type Status = {
  connected: boolean;
  regions?: string;
  message?: string;
  sportsCount?: number;
  fetchedAt?: string;
  quota?: { remaining: number | null; used: number | null; lastCost: number | null };
  error?: string;
};

export default function SettingsPage() {
  const [prefs, setPrefs] = usePrefs();
  const [status, setStatus] = useState<Status | null>(null);

  const check = () =>
    fetch("/api/status")
      .then((r) => r.json())
      .then(setStatus)
      .catch(() => setStatus({ connected: false, error: "Нет ответа от сервера" }));

  useEffect(() => {
    check();
  }, []);

  return (
    <div className="space-y-6">
      <section className="card-pad space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-medium text-white">Подключение к The Odds API</h3>
          <Badge tone={status?.connected ? "good" : "bad"}>
            {status === null ? "проверка…" : status.connected ? "подключено" : "нет ключа"}
          </Badge>
        </div>

        {status?.connected ? (
          <div className="grid gap-4 sm:grid-cols-4">
            <Stat label="Лиг доступно" value={String(status.sportsCount ?? "—")} />
            <Stat
              label="Запросов осталось"
              value={String(status.quota?.remaining ?? "—")}
              tone={(status.quota?.remaining ?? 0) < 50 ? "bad" : "good"}
            />
            <Stat label="Использовано" value={String(status.quota?.used ?? "—")} />
            <Stat
              label="Регионы"
              value={status.regions ?? "—"}
              sub={status.fetchedAt ? fmtTime(status.fetchedAt) : ""}
            />
          </div>
        ) : (
          <div className="rounded-lg border border-warn/40 bg-warn/5 p-4 text-sm">
            <p className="text-slate-200">
              {status?.message || status?.error || "Ключ API не настроен."}
            </p>
            <ol className="mt-3 list-decimal space-y-1 pl-5 text-xs text-slate-400">
              <li>
                Зарегистрируйтесь на{" "}
                <a
                  className="text-accent underline"
                  href="https://the-odds-api.com/"
                  target="_blank"
                  rel="noreferrer"
                >
                  the-odds-api.com
                </a>{" "}
                — бесплатный тариф даёт 500 запросов в месяц.
              </li>
              <li>
                В корне проекта создайте файл <code className="text-accent">.env.local</code>.
              </li>
              <li>
                Впишите: <code className="text-accent">ODDS_API_KEY=ваш_ключ</code> и при желании{" "}
                <code className="text-accent">ODDS_API_REGIONS=eu,uk,us</code>.
              </li>
              <li>Перезапустите dev-сервер и нажмите «Проверить подключение».</li>
            </ol>
          </div>
        )}
        <button className="btn" onClick={check}>
          Проверить подключение
        </button>
        <p className="text-xs text-slate-500">
          Ключ хранится только на сервере в переменных окружения и никогда не передаётся в браузер.
          Приложение работает исключительно на актуальных котировках — демо-данных нет.
        </p>
      </section>

      <section className="card-pad space-y-5">
        <h3 className="font-medium text-white">Параметры сканера</h3>
        <div className="grid gap-5 lg:grid-cols-2">
          <div>
            <label className="label">Отслеживаемые лиги (до 6)</label>
            <MultiSportSelect value={prefs.sports} onChange={(s) => setPrefs({ ...prefs, sports: s })} />
          </div>
          <div className="space-y-4">
            <div>
              <label className="label">Рынки</label>
              <MarketToggle value={prefs.markets} onChange={(m) => setPrefs({ ...prefs, markets: m })} />
            </div>
            <div>
              <label className="label">Регионы букмекеров</label>
              <RegionToggle value={prefs.regions} onChange={(r) => setPrefs({ ...prefs, regions: r })} />
              <p className="mt-1 text-xs text-slate-500">
                Каждый регион увеличивает стоимость запроса к API.
              </p>
            </div>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Num
            label="Мин. перевес value, %"
            value={prefs.minEdge}
            step="0.5"
            onChange={(v) => setPrefs({ ...prefs, minEdge: v })}
          />
          <Num
            label="Мин. прибыль вилки, %"
            value={prefs.minArbProfit}
            step="0.1"
            onChange={(v) => setPrefs({ ...prefs, minArbProfit: v })}
          />
          <Num
            label="Мин. букмекеров в консенсусе"
            value={prefs.minBooks}
            onChange={(v) => setPrefs({ ...prefs, minBooks: v })}
          />
          <div>
            <label className="label">Автообновление</label>
            <select
              className="input"
              value={prefs.autoRefreshSec}
              onChange={(e) => setPrefs({ ...prefs, autoRefreshSec: Number(e.target.value) })}
            >
              <option value={0}>выключено</option>
              <option value={30}>каждые 30 с</option>
              <option value={60}>каждую минуту</option>
              <option value={300}>каждые 5 минут</option>
            </select>
          </div>
        </div>
      </section>

      <section className="card-pad space-y-4">
        <h3 className="font-medium text-white">Банкролл и риск-менеджмент</h3>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Num
            label="Размер банка"
            value={prefs.bankroll}
            step="1000"
            onChange={(v) => setPrefs({ ...prefs, bankroll: v })}
          />
          <div>
            <label className="label">Валюта</label>
            <select
              className="input"
              value={prefs.currency}
              onChange={(e) => setPrefs({ ...prefs, currency: e.target.value })}
            >
              {["₽", "$", "€", "£", "₸", "₴"].map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Доля Kelly</label>
            <select
              className="input"
              value={prefs.kellyFraction}
              onChange={(e) => setPrefs({ ...prefs, kellyFraction: Number(e.target.value) })}
            >
              <option value={1}>полный Kelly (агрессивно)</option>
              <option value={0.5}>1/2 Kelly</option>
              <option value={0.25}>1/4 Kelly (рекомендуется)</option>
              <option value={0.1}>1/10 Kelly (консервативно)</option>
            </select>
          </div>
          <div>
            <label className="label">Метод справедливой цены</label>
            <select
              className="input"
              value={prefs.method}
              onChange={(e) =>
                setPrefs({ ...prefs, method: e.target.value as "shin" | "multiplicative" })
              }
            >
              <option value="shin">Shin</option>
              <option value="multiplicative">Пропорциональный</option>
            </select>
          </div>
        </div>
        <div className="flex gap-2">
          <button className="btn" onClick={() => setPrefs(DEFAULT_PREFS)}>
            Сбросить настройки
          </button>
          <button
            className="btn text-bad"
            onClick={() => {
              if (confirm("Удалить всю историю ставок?")) {
                localStorage.removeItem("betscope.bets");
                location.reload();
              }
            }}
          >
            Очистить историю ставок
          </button>
        </div>
      </section>

      <section className="card-pad text-xs text-slate-500">
        <p className="mb-1 text-slate-300">Дисклеймер</p>
        BetScope — аналитический инструмент. Он не принимает ставки и не гарантирует прибыль.
        Коэффициенты меняются в реальном времени, букмекеры ограничивают счета за арбитраж.
        Ставьте только те суммы, потеря которых для вас приемлема.
      </section>
    </div>
  );
}

function Num({
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
