"use client";

import { useMemo, useState } from "react";
import { usePrefs } from "@/lib/prefs";
import { money } from "@/components/ui";
import {
  arbStakes,
  decimalToAmerican,
  decimalToFractional,
  expectedValue,
  hedgeStake,
  impliedProb,
  kellyFraction,
  parlayOdds,
  bookmakerMargin,
  clv,
} from "@/lib/math";

const TABS = [
  { id: "kelly", label: "Kelly / EV" },
  { id: "arb", label: "Вилка / Дачинг" },
  { id: "hedge", label: "Хедж" },
  { id: "parlay", label: "Экспресс" },
  { id: "convert", label: "Конвертер" },
  { id: "margin", label: "Маржа и CLV" },
  { id: "tax", label: "Налог 13%" },
] as const;

export default function CalculatorsPage() {
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("kelly");
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`rounded-lg border px-3 py-2 text-sm transition ${
              tab === t.id
                ? "border-accent/60 bg-accent/15 text-accent"
                : "border-edge bg-slate-800/50 text-slate-400 hover:text-slate-200"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === "kelly" && <KellyCalc />}
      {tab === "arb" && <ArbCalc />}
      {tab === "hedge" && <HedgeCalc />}
      {tab === "parlay" && <ParlayCalc />}
      {tab === "convert" && <ConvertCalc />}
      {tab === "margin" && <MarginCalc />}
      {tab === "tax" && <TaxCalc />}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  step = "0.01",
  suffix,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  step?: string;
  suffix?: string;
}) {
  return (
    <div>
      <label className="label">{label}</label>
      <div className="relative">
        <input
          type="number"
          step={step}
          className="input"
          value={Number.isFinite(value) ? value : ""}
          onChange={(e) => onChange(Number(e.target.value))}
        />
        {suffix && (
          <span className="pointer-events-none absolute right-3 top-2.5 text-xs text-slate-500">
            {suffix}
          </span>
        )}
      </div>
    </div>
  );
}

function Result({ rows }: { rows: { label: string; value: string; tone?: string }[] }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {rows.map((r, i) => (
        <div key={i} className="rounded-lg border border-edge bg-slate-900/60 p-3">
          <p className="text-xs text-slate-500">{r.label}</p>
          <p className={`text-lg font-semibold tabular-nums ${r.tone ?? "text-slate-100"}`}>
            {r.value}
          </p>
        </div>
      ))}
    </div>
  );
}

function KellyCalc() {
  const [prefs] = usePrefs();
  const [odds, setOdds] = useState(2.1);
  const [prob, setProb] = useState(52);
  const [bank, setBank] = useState(prefs.bankroll);
  const [frac, setFrac] = useState(prefs.kellyFraction);
  const p = prob / 100;
  const k = kellyFraction(odds, p);
  const stake = bank * k * frac;
  const ev = expectedValue(odds, p, stake);
  const edge = (odds * p - 1) * 100;
  return (
    <div className="card-pad space-y-4">
      <h3 className="font-medium text-white">Критерий Келли и ожидаемая ценность</h3>
      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Коэффициент" value={odds} onChange={setOdds} />
        <Field label="Ваша вероятность" value={prob} onChange={setProb} step="0.1" suffix="%" />
        <Field label="Банкролл" value={bank} onChange={setBank} step="100" />
        <Field label="Доля Kelly" value={frac} onChange={setFrac} step="0.05" />
      </div>
      <Result
        rows={[
          { label: "Перевес над рынком", value: `${edge.toFixed(2)}%`, tone: edge > 0 ? "text-good" : "text-bad" },
          { label: "Полный Kelly", value: `${(k * 100).toFixed(2)}% банка` },
          { label: "Рекомендуемая ставка", value: money(stake, prefs.currency), tone: "text-accent" },
          { label: "Ожидаемая прибыль", value: money(ev, prefs.currency), tone: ev > 0 ? "text-good" : "text-bad" },
        ]}
      />
      <p className="text-xs text-slate-500">
        Полный Kelly максимизирует рост банка, но даёт высокую волатильность. Практика — 1/4 или
        1/2 Kelly. Если перевес отрицателен, ставка не рекомендуется.
      </p>
    </div>
  );
}

function ArbCalc() {
  const [prefs] = usePrefs();
  const [odds, setOdds] = useState<number[]>([2.1, 2.05]);
  const [total, setTotal] = useState(10000);
  const stakes = arbStakes(odds.map((o) => ({ price: o })), total);
  const totalImplied = odds.reduce((a, o) => a + impliedProb(o), 0);
  const profit = total / totalImplied - total;
  return (
    <div className="card-pad space-y-4">
      <h3 className="font-medium text-white">Калькулятор вилки / дач-беттинга</h3>
      <div className="flex flex-wrap items-end gap-3">
        {odds.map((o, i) => (
          <div key={i} className="w-32">
            <Field
              label={`Исход ${i + 1}`}
              value={o}
              onChange={(v) => setOdds(odds.map((x, j) => (j === i ? v : x)))}
            />
          </div>
        ))}
        <button className="btn" onClick={() => setOdds([...odds, 3])} disabled={odds.length >= 6}>
          + исход
        </button>
        <button
          className="btn"
          onClick={() => setOdds(odds.slice(0, -1))}
          disabled={odds.length <= 2}
        >
          − исход
        </button>
        <div className="w-40">
          <Field label="Общая сумма" value={total} onChange={setTotal} step="100" />
        </div>
      </div>
      <div className="table-wrap">
        <table className="w-full">
          <thead className="bg-slate-900/60">
            <tr>
              <th className="th">Исход</th>
              <th className="th">Коэф.</th>
              <th className="th">Ставка</th>
              <th className="th">Выплата</th>
              <th className="th">Прибыль</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-edge">
            {stakes.map((s, i) => (
              <tr key={i}>
                <td className="td">Исход {i + 1}</td>
                <td className="td tabular-nums text-accent">{odds[i].toFixed(2)}</td>
                <td className="td tabular-nums">{money(s.stake, prefs.currency)}</td>
                <td className="td tabular-nums">{money(s.payout, prefs.currency)}</td>
                <td className={`td tabular-nums ${s.profit > 0 ? "text-good" : "text-bad"}`}>
                  {money(s.profit, prefs.currency)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Result
        rows={[
          {
            label: "Сумма вероятностей",
            value: `${(totalImplied * 100).toFixed(2)}%`,
            tone: totalImplied < 1 ? "text-good" : "text-bad",
          },
          {
            label: totalImplied < 1 ? "Гарантированная прибыль" : "Гарантированный убыток",
            value: money(profit, prefs.currency),
            tone: profit > 0 ? "text-good" : "text-bad",
          },
          { label: "Доходность", value: `${((profit / total) * 100).toFixed(2)}%` },
        ]}
      />
    </div>
  );
}

function HedgeCalc() {
  const [prefs] = usePrefs();
  const [origOdds, setOrigOdds] = useState(3.4);
  const [origStake, setOrigStake] = useState(5000);
  const [hedgeOdds, setHedgeOdds] = useState(1.6);
  const h = hedgeStake(origOdds, origStake, hedgeOdds);
  return (
    <div className="card-pad space-y-4">
      <h3 className="font-medium text-white">Хеджирование открытой ставки</h3>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Коэф. открытой ставки" value={origOdds} onChange={setOrigOdds} />
        <Field label="Сумма открытой ставки" value={origStake} onChange={setOrigStake} step="100" />
        <Field label="Коэф. противоположного исхода" value={hedgeOdds} onChange={setHedgeOdds} />
      </div>
      <Result
        rows={[
          { label: "Ставка для хеджа", value: money(h.stake, prefs.currency), tone: "text-accent" },
          { label: "Итоговая выплата", value: money(h.payout, prefs.currency) },
          {
            label: "Гарантированный результат",
            value: money(h.guaranteed, prefs.currency),
            tone: h.guaranteed > 0 ? "text-good" : "text-bad",
          },
          {
            label: "Если не хеджировать (выигрыш)",
            value: money(origStake * origOdds - origStake, prefs.currency),
          },
        ]}
      />
    </div>
  );
}

function ParlayCalc() {
  const [prefs] = usePrefs();
  const [legs, setLegs] = useState([1.8, 2.0, 1.65]);
  const [stake, setStake] = useState(1000);
  const total = parlayOdds(legs);
  const prob = legs.reduce((a, o) => a * impliedProb(o), 1);
  return (
    <div className="card-pad space-y-4">
      <h3 className="font-medium text-white">Экспресс (аккумулятор)</h3>
      <div className="flex flex-wrap items-end gap-3">
        {legs.map((o, i) => (
          <div key={i} className="w-28">
            <Field
              label={`Событие ${i + 1}`}
              value={o}
              onChange={(v) => setLegs(legs.map((x, j) => (j === i ? v : x)))}
            />
          </div>
        ))}
        <button className="btn" onClick={() => setLegs([...legs, 1.9])} disabled={legs.length >= 12}>
          + событие
        </button>
        <button className="btn" onClick={() => setLegs(legs.slice(0, -1))} disabled={legs.length <= 2}>
          − событие
        </button>
        <div className="w-36">
          <Field label="Сумма" value={stake} onChange={setStake} step="100" />
        </div>
      </div>
      <Result
        rows={[
          { label: "Общий коэффициент", value: total.toFixed(2), tone: "text-accent" },
          { label: "Выплата", value: money(stake * total, prefs.currency) },
          { label: "Вероятность прохода (по линии)", value: `${(prob * 100).toFixed(2)}%` },
          { label: "Чистая прибыль", value: money(stake * total - stake, prefs.currency), tone: "text-good" },
        ]}
      />
      <p className="text-xs text-slate-500">
        Маржа букмекера перемножается на каждом плече: экспресс из 5 событий при марже 5% на
        событие даёт эффективную комиссию около 23%.
      </p>
    </div>
  );
}

function ConvertCalc() {
  const [dec, setDec] = useState(2.5);
  const rows = useMemo(
    () => [
      { label: "Десятичный", value: dec.toFixed(3) },
      {
        label: "Американский",
        value: (() => {
          const a = decimalToAmerican(dec);
          return a > 0 ? `+${a}` : String(a);
        })(),
      },
      { label: "Дробный", value: decimalToFractional(dec) },
      { label: "Вероятность", value: `${(impliedProb(dec) * 100).toFixed(2)}%` },
      { label: "Гонконгский", value: (dec - 1).toFixed(3) },
      { label: "Индонезийский", value: dec >= 2 ? (dec - 1).toFixed(2) : (-1 / (dec - 1)).toFixed(2) },
    ],
    [dec]
  );
  return (
    <div className="card-pad space-y-4">
      <h3 className="font-medium text-white">Конвертер коэффициентов</h3>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Десятичный коэффициент" value={dec} onChange={setDec} />
        <div>
          <label className="label">Быстрый выбор</label>
          <div className="flex flex-wrap gap-1">
            {[1.5, 1.9, 2.0, 2.5, 3.0, 5.0].map((v) => (
              <button key={v} className="btn px-2 py-1 text-xs" onClick={() => setDec(v)}>
                {v.toFixed(2)}
              </button>
            ))}
          </div>
        </div>
      </div>
      <Result rows={rows} />
    </div>
  );
}

function MarginCalc() {
  const [odds, setOdds] = useState([2.0, 3.5, 3.9]);
  const [taken, setTaken] = useState(2.2);
  const [closing, setClosing] = useState(2.0);
  const margin = bookmakerMargin(odds) * 100;
  const fair = odds.map((o) => o * (1 + margin / 100));
  const c = clv(taken, closing);
  return (
    <div className="space-y-5">
      <div className="card-pad space-y-4">
        <h3 className="font-medium text-white">Маржа букмекера</h3>
        <div className="flex flex-wrap items-end gap-3">
          {odds.map((o, i) => (
            <div key={i} className="w-28">
              <Field
                label={`Исход ${i + 1}`}
                value={o}
                onChange={(v) => setOdds(odds.map((x, j) => (j === i ? v : x)))}
              />
            </div>
          ))}
          <button className="btn" onClick={() => setOdds([...odds, 3])} disabled={odds.length >= 8}>
            +
          </button>
          <button className="btn" onClick={() => setOdds(odds.slice(0, -1))} disabled={odds.length <= 2}>
            −
          </button>
        </div>
        <Result
          rows={[
            {
              label: "Маржа (overround)",
              value: `${margin.toFixed(2)}%`,
              tone: margin < 3 ? "text-good" : margin < 6 ? "text-warn" : "text-bad",
            },
            {
              label: "Справедливые коэффициенты",
              value: fair.map((f) => f.toFixed(2)).join(" / "),
            },
          ]}
        />
      </div>
      <div className="card-pad space-y-4">
        <h3 className="font-medium text-white">CLV — closing line value</h3>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Взятый коэффициент" value={taken} onChange={setTaken} />
          <Field label="Закрывающий коэффициент" value={closing} onChange={setClosing} />
        </div>
        <Result
          rows={[
            {
              label: "CLV",
              value: `${c > 0 ? "+" : ""}${c.toFixed(2)}%`,
              tone: c > 0 ? "text-good" : "text-bad",
            },
            {
              label: "Вывод",
              value:
                c > 0
                  ? "Вы обыграли закрытие — сигнал устойчивого преимущества"
                  : "Линия ушла против вас",
            },
          ]}
        />
        <p className="text-xs text-slate-500">
          Стабильно положительный CLV — самый надёжный индикатор долгосрочной прибыльности,
          важнее короткой серии выигрышей.
        </p>
      </div>
    </div>
  );
}

function TaxCalc() {
  const [prefs] = usePrefs();
  const [stake, setStake] = useState(10000);
  const [odds, setOdds] = useState(2.5);
  const [deposits, setDeposits] = useState(50000);
  const [withdrawals, setWithdrawals] = useState(80000);

  const payout = stake * odds;
  const profit = payout - stake;
  // Интерактивные ставки: налоговая база = вывод − депозит, удерживает ЦУПИС при выводе
  const single = payout >= 15000 ? Math.max(0, payout - stake) * 0.13 : 0;
  const yearBase = Math.max(0, withdrawals - deposits);
  const yearTax = yearBase * 0.13;

  return (
    <div className="space-y-5">
      <div className="card-pad space-y-4">
        <h3 className="font-medium text-white">НДФЛ с одной ставки</h3>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Сумма ставки" value={stake} onChange={setStake} step="100" />
          <Field label="Коэффициент" value={odds} onChange={setOdds} />
        </div>
        <Result
          rows={[
            { label: "Выплата", value: money(payout, prefs.currency) },
            { label: "Чистый выигрыш", value: money(profit, prefs.currency), tone: "text-good" },
            {
              label: "Налог 13%",
              value: money(single, prefs.currency),
              tone: single > 0 ? "text-bad" : "text-slate-400",
            },
            {
              label: "На руки",
              value: money(payout - single, prefs.currency),
              tone: "text-accent",
            },
          ]}
        />
        <p className="text-xs text-slate-500">
          При выплате от 15 000 ₽ налоговым агентом выступает букмекер: он удерживает 13% с разницы
          между выплатой и суммой ставки. Если выплата меньше 15 000 ₽, декларировать доход нужно
          самостоятельно по итогам года.
        </p>
      </div>

      <div className="card-pad space-y-4">
        <h3 className="font-medium text-white">Налог за год по выводам (интерактивные ставки)</h3>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Сумма депозитов за год" value={deposits} onChange={setDeposits} step="1000" />
          <Field label="Сумма выводов за год" value={withdrawals} onChange={setWithdrawals} step="1000" />
        </div>
        <Result
          rows={[
            { label: "Налоговая база", value: money(yearBase, prefs.currency) },
            { label: "НДФЛ 13%", value: money(yearTax, prefs.currency), tone: "text-bad" },
            {
              label: "Чистыми за год",
              value: money(yearBase - yearTax, prefs.currency),
              tone: yearBase > 0 ? "text-good" : "text-slate-400",
            },
          ]}
        />
        <p className="text-xs text-slate-500">
          Для интерактивных ставок база считается как «выведено минус внесено» за календарный год.
          Расчёт ориентировочный: ставка 15% применяется к доходам свыше 5 млн ₽ в год. Итоговые
          суммы уточняйте в личном кабинете ЦУПИС и в справке 2-НДФЛ от букмекера.
        </p>
      </div>
    </div>
  );
}
