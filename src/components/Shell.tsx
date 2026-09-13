"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const NAV = [
  { href: "/", label: "Обзор", icon: "◧" },
  { href: "/odds", label: "Сравнение линий", icon: "≡" },
  { href: "/arbitrage", label: "Вилки", icon: "⇄" },
  { href: "/value", label: "Value-беты", icon: "◆" },
  { href: "/models", label: "Модели", icon: "∑" },
  { href: "/calculators", label: "Калькуляторы", icon: "🧮" },
  { href: "/tracker", label: "Мои ставки", icon: "▤" },
  { href: "/scores", label: "Результаты", icon: "⚑" },
  { href: "/settings", label: "Настройки", icon: "⚙" },
];

type Status = {
  connected: boolean;
  quota?: { remaining: number | null; used: number | null };
  error?: string;
};

export default function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [status, setStatus] = useState<Status | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    fetch("/api/status")
      .then((r) => r.json())
      .then((d) => setStatus(d))
      .catch(() => setStatus({ connected: false, error: "нет связи" }));
  }, [pathname]);

  return (
    <div className="min-h-screen lg:flex">
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-64 border-r border-edge bg-panel/95 backdrop-blur transition-transform lg:static lg:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex h-16 items-center gap-2 border-b border-edge px-5">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-accent/15 text-accent">
            ⬢
          </span>
          <div>
            <p className="text-sm font-semibold text-white">BetScope</p>
            <p className="text-[10px] uppercase tracking-widest text-slate-500">
              odds intelligence
            </p>
          </div>
        </div>
        <nav className="space-y-1 p-3">
          {NAV.map((n) => {
            const active = n.href === "/" ? pathname === "/" : pathname.startsWith(n.href);
            return (
              <Link
                key={n.href}
                href={n.href}
                onClick={() => setOpen(false)}
                className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition ${
                  active
                    ? "bg-accent/15 text-accent"
                    : "text-slate-400 hover:bg-slate-800/60 hover:text-slate-100"
                }`}
              >
                <span className="w-4 text-center">{n.icon}</span>
                {n.label}
              </Link>
            );
          })}
        </nav>
        <div className="mx-3 mt-4 rounded-lg border border-edge bg-slate-900/60 p-3 text-xs">
          <div className="flex items-center gap-2">
            <span
              className={`h-2 w-2 rounded-full ${
                status?.connected ? "bg-good" : "bg-bad"
              } ${status?.connected ? "animate-pulse" : ""}`}
            />
            <span className="text-slate-300">
              {status === null
                ? "проверка API…"
                : status.connected
                ? "The Odds API онлайн"
                : "API не подключён"}
            </span>
          </div>
          {status?.quota?.remaining != null && (
            <p className="mt-2 text-slate-500">
              Запросов осталось:{" "}
              <span className="text-slate-300 tabular-nums">{status.quota.remaining}</span>
            </p>
          )}
          {!status?.connected && status !== null && (
            <Link href="/settings" className="mt-2 block text-accent underline">
              Подключить ключ
            </Link>
          )}
        </div>
      </aside>

      {open && (
        <div
          className="fixed inset-0 z-30 bg-black/60 lg:hidden"
          onClick={() => setOpen(false)}
        />
      )}

      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-edge bg-ink/85 px-4 backdrop-blur lg:px-8">
          <button className="btn px-2 py-1 lg:hidden" onClick={() => setOpen(true)}>
            ☰
          </button>
          <h1 className="text-sm font-medium text-slate-300">
            {NAV.find((n) => (n.href === "/" ? pathname === "/" : pathname.startsWith(n.href)))
              ?.label ?? "BetScope"}
          </h1>
          <div className="ml-auto hidden items-center gap-2 text-xs text-slate-500 sm:flex">
            <span className="chip">данные: The Odds API</span>
            <span className="chip">режим: только реальные котировки</span>
          </div>
        </header>
        <main className="p-4 lg:p-8">{children}</main>
      </div>
    </div>
  );
}
