import fs from "fs";

if (!fs.existsSync("diag-report.txt")) {
  console.log("Файл diag-report.txt не найден. Сначала запустите Диагностика.bat или node diag.mjs");
  process.exit(1);
}

const log = fs.readFileSync("diag-report.txt", "utf-8");
const match = log.match(/ВЕРДИКТ[\s\S]*?(?=\n={10}|$)/);

if (match) {
  console.log("\n=== СКОПИРУЙТЕ ТОЛЬКО ЭТОТ ТЕКСТ В ЧАТ ===");
  // Убираем IP-адреса и спецсимволы, чтобы чат не блокировал сообщение
  const safeText = match[0].replace(/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/g, '[IP]').slice(0, 1000);
  console.log(safeText);
  console.log("=========================================\n");
} else {
  console.log("Вердикт не найден. Напишите в чат просто код ошибки, который чаще всего повторяется в отчете (например ECONNRESET или UNABLE_TO_VERIFY_LEAF_SIGNATURE)");
}
