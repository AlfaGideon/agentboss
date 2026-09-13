"use client";

import { useState } from "react";
import { DEFAULT_PREFS, usePrefs, qs } from "@/lib/prefs";
import { BookToggle, SportToggle, SourceStatus, BOOKS } from "@/components/controls";
import { Spinner } from "@/components/ui";

export default function SettingsPage() {
  const [prefs, setPrefs] = usePrefs();
  const [checking, setChecking] = useState(false);
  const [sources, setSources] = useState<any[] | null>(null);

  const check = async () => {
    setChecking(true);
    try {
      const r = await fetch(`/api/line?${qs({ sport: prefs.sports[0] || "football", books: prefs.books.join(",") })}`);
      const d = await r.json();
      setSources(d.sources || []);
    } catch {
      setSources([]);
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="space-y-6">
      <section className="card-pad space-y-4">
        <h3 className="font-medium text-white">Источники котировок</h3>
        <p className="text-sm text-slate-400">
          Приложение обращается напрямую к публичным линиям российских букмекеров. Никаких ключей
          API и регистрации не требуется — но сервер, на котором запущено приложение, должен иметь
          доступ к сайтам контор (российский IP, без VPN).
        </p>
        <ul className="grid gap-2 sm:grid-cols-2">
          {BOOKS.map((b) => (
            <li key={b.key} className="rounded-lg border border-edge bg-slate-900/60 p-3 text-sm">
              <p className="text-slate-100">{b.title}</p>
              <p className="text-xs text-slate-500">публичный фид линии, лицензия ФНС РФ</p>
            </li>
          ))}
        </ul>
        <button className="btn-primary" onClick={check} disabled={checking}>
          {checking ? "Проверяю…" : "Проверить доступность контор"}
        </button>
        {checking && <Spinner label="Опрашиваю линии…" />}
        {sources && <SourceStatus sources={sources} />}
        {sources && sources.every((s) => !s.ok) && (
          <div className="rounded-lg border border-warn/40 bg-warn/5 p-3 text-xs text-slate-300">
            Ни одна контора не ответила. Так бывает, когда приложение запущено на зарубежном
            сервере или в песочнице без доступа в интернет. Запустите его локально:{" "}
            <code className="text-accent">npm install && npm run dev</code> — и линии подтянутся.
          </div>
        )}
      </section>

      <section className="card-pad space-y-5">
        <h3 className="font-medium text-white">Параметры сканера</h3>
        <div>
          <label className="label">Виды спорта (до 4 одновременно)</label>
          <SportToggle value={prefs.sports} onChange={(s) => setPrefs({ ...prefs, sports: s })} />
        </div>
        <div>
          <label className="label">Букмекеры</label>
          <BookToggle value={prefs.books} onChange={(b) => setPrefs({ ...prefs, books: b })} />
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
            label="Мин. контор в консенсусе"
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
              <option value={30}>каждые 30 сек</option>
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
              {["₽", "₸", "$", "€"].map((c) => (
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
            <label className="label">Метод снятия маржи</label>
            <select
              className="input"
              value={prefs.method}
              onChange={(e) => setPrefs({ ...prefs, method: e.target.value as "shin" | "multiplicative" })}
            >
              <option value="shin">Shin</option>
              <option value="multiplicative">Пропорциональный</option>
            </select>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
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

      <section className="card-pad space-y-2 text-xs text-slate-500">
        <p className="text-slate-300">Важно знать</p>
        <p>
          Ставки принимают только букмекеры с лицензией ФНС России, работающие через ЕЦУПС
          (единый ЦУПИС). С выигрышей удерживается НДФЛ 13% — расчёт есть во вкладке
          «Калькуляторы».
        </p>
        <p>
          BetScope — аналитический инструмент: он не принимает ставки, не является букмекером и не
          гарантирует прибыль. Коэффициенты меняются в реальном времени. Ставьте только те суммы,
          потеря которых для вас приемлема.
        </p>
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
