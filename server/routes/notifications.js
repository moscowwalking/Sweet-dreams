import express from "express";
import { ENV } from "../config/env.js";
import {
  saveSubscription,
  removeSubscription,
  checkDailyTriggers,
  sendNotificationToAll,
} from "../services/notificationService.js";

const router = express.Router();

/**
 * GET /vapid-public-key - Отдаёт открытый VAPID ключ для браузера
 */
router.get("/vapid-public-key", (req, res) => {
  res.json({ publicKey: ENV.VAPID_PUBLIC_KEY });
});

/**
 * POST /subscribe - Регистрация push-подписки устройства в Firestore
 */
router.post("/subscribe", async (req, res) => {
  try {
    const { subscription } = req.body;
    if (!subscription || !subscription.endpoint) {
      return res.status(400).json({ error: "Не переданы данные подписки" });
    }

    await saveSubscription(subscription);
    res.json({ success: true, message: "Подписка успешно сохранена" });
  } catch (err) {
    console.error("❌ /subscribe error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /unsubscribe - Удаление подписки
 */
router.post("/unsubscribe", async (req, res) => {
  try {
    const { subscription } = req.body;
    if (subscription) {
      await removeSubscription(subscription);
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /send-test-notification - Тестовое уведомление на все устройства
 */
router.post("/send-test-notification", async (req, res) => {
  try {
    const { title, body } = req.body || {};
    const result = await sendNotificationToAll({
      title: title || "Sweet Dreams ❤️",
      body: body || "Тестовое пуш-уведомление успешно доставлено!",
      data: { url: "./memories.html" },
    });
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET/POST /check-daily-notifications - Запуск проверки годовщин и воспоминаний
 */
router.all("/check-daily-notifications", async (req, res) => {
  try {
    const result = await checkDailyTriggers(true);
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
