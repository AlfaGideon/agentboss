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

export type SourceInfo = {
  book: string;
  key: string;
  ok: boolean;
  count?: number;
  error?: string;
  ms?: number;
  endpoint?: string;
  rawCount?: number;
  /** как определился адрес: системный DNS, резервный DNS, DNS-over-HTTPS */
  dnsVia?: string;
  /** сертификат подменили — соединение прошло без проверки */
  insecure?: boolean;
  /** разбор по каждому адресу-зеркалу */
  tried?: { url: string; ok: boolean; error?: string; dnsVia?: string }[];
  /** человеческая причина сбоя, см. api/_util.ts */
  errorKind?: "dns" | "blocked" | "http" | "empty" | "other";
};

/** Адрес найден не системным DNS, а резервным — об этом стоит сказать явно */
const usedBackupDns = (via?: string) => Boolean(via && !/^(системный DNS|IP)$/.test(via));

/** Простое объяснение вместо технического текста ошибки */
const HUMAN: Record<string, string> = {
  dns:
    "Адрес конторы не найден в DNS: проверены системный сервер, публичные (8.8.8.8, 1.1.1.1, 77.88.8.8) и DNS-over-HTTPS. Похоже, имя блокируется в вашей сети.",
  blocked:
    "Адреса найдены, но соединение не проходит: похоже на блокировку провайдера, прокси или антивирус.",
  http: "Контора ответила отказом запросу — вероятно, включена защита от ботов.",
  empty: "Ответ получен, но событий по этому виду спорта в линии нет.",
  other: "Данные не пришли — подробности ниже.",
};

export function SourceStatus({ sources }: { sources?: SourceInfo[] }) {
  if (!sources?.length) return null;
  return (
    <div className="grid gap-2">
      {sources.map((s) => (
        <div
          key={s.key}
          className={`rounded-lg border p-3 text-xs ${
            s.ok ? "border-good/40 bg-good/5" : "border-bad/40 bg-bad/5"
          }`}
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className={`h-2 w-2 shrink-0 rounded-full ${s.ok ? "bg-good" : "bg-bad"}`} />
            <span className="font-medium text-slate-100">{s.book}</span>
            <span className="text-slate-500">{s.ms ?? 0} мс</span>
            <span className={s.ok ? "text-good" : "text-bad"}>
              {s.ok ? `событий: ${s.count ?? 0}` : "нет данных"}
            </span>
            {s.ok && usedBackupDns(s.dnsVia) && (
              <span className="rounded-full border border-accent/40 bg-accent/10 px-2 py-0.5 text-accent">
                адрес найден через резервный DNS: {s.dnsVia}
              </span>
            )}
            {s.ok && s.insecure && (
              <span className="rounded-full border border-warn/40 bg-warn/10 px-2 py-0.5 text-warn">
                сертификат подменён (антивирус?) — соединение без проверки
              </span>
            )}
          </div>

          {s.ok ? (
            <p className="mt-1 break-all text-slate-500">
              {s.endpoint ? `адрес: ${s.endpoint}` : ""}
              {!usedBackupDns(s.dnsVia) && s.dnsVia ? ` · DNS: ${s.dnsVia}` : ""}
              {s.rawCount ? ` (строк в ответе: ${s.rawCount})` : ""}
            </p>
          ) : (
            <>
              <p className="mt-1 whitespace-normal break-words text-slate-300">
                {(s.errorKind && HUMAN[s.errorKind]) || s.error || "ошибка без описания"}
              </p>
              <details className="mt-1">
                <summary className="cursor-pointer text-slate-500 hover:text-slate-300">
                  {s.tried?.length ? `подробности: проверено адресов — ${s.tried.length}` : "подробности"}
                </summary>
                {s.tried?.length ? (
                  <ul className="mt-1 space-y-1">
                    {s.tried.map((t) => (
                      <li key={t.url} className="break-all text-slate-500">
                        <span className={t.ok ? "text-good" : "text-slate-400"}>
                          {t.ok ? "ок · " : "нет · "}
                        </span>
                        {t.url}
                        {t.error ? ` — ${t.error}` : ""}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-1 break-all text-slate-500">
                    {s.error || "ошибка без описания"}
                    {s.endpoint ? ` · адрес: ${s.endpoint}` : ""}
                  </p>
                )}
              </details>
            </>
          )}
        </div>
      ))}
    </div>
  );
}
