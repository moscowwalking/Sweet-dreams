import { checkDailyTriggers } from "./notificationService.js";

/**
 * Фоновый планировщик проверки ежедневных уведомлений
 * Запускается раз в час, срабатывает в интервале 10:00 - 11:00 МСК
 */
export function startPushScheduler() {
  console.log("⏰ Фоновый планировщик пуш-уведомлений инициализирован");

  setInterval(
    () => {
      const hoursMSK = new Date().getUTCHours() + 3;
      if (hoursMSK >= 10 && hoursMSK <= 11) {
        checkDailyTriggers().catch((err) =>
          console.warn("⚠️ Ошибка автоматической проверки пушей:", err.message),
        );
      }
    },
    60 * 60 * 1000,
  );
}
