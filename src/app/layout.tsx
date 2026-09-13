import type { Metadata } from "next";
import "./globals.css";
import Shell from "@/components/Shell";

export const metadata: Metadata = {
  title: "BetScope — анализ ставок на спорт",
  description:
    "Сравнение коэффициентов букмекеров, поиск вилок и value-ставок, модели и учёт банкролла на реальных данных The Odds API.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body>
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
