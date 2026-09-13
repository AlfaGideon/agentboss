import type { Metadata } from "next";
import "./globals.css";
import Shell from "@/components/Shell";

export const metadata: Metadata = {
  title: "Ставка PRO — анализ линий российских букмекеров",
  description:
    "Сравнение коэффициентов российских букмекеров, поиск вилок и ставок с перевесом, расчёт банка и налога.",
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
