import express from "express";

const router = express.Router();

router.get("/health", (req, res) => {
  const mskTime = new Date().toLocaleTimeString("ru-RU", {
    timeZone: "Europe/Moscow",
  });
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    mskTime,
    uptime: process.uptime(),
  });
});

export default router;
