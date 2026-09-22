import express from "express";

const router = express.Router();

/**
 * GET /health - Keep-alive пинг для cron-job.org и мониторинга доступности сервера
 */
router.get("/health", (req, res) => {
  const mskTime = new Date().toLocaleTimeString("ru-RU", {
    timeZone: "Europe/Moscow",
  });
  console.log(`💓 [${mskTime} МСК] Keep-alive ping (/health)`);
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

export default router;
