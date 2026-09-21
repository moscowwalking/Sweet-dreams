import express from "express";
import cors from "cors";
import compression from "compression";
import bodyParser from "body-parser";
import { ENV } from "./config/env.js";
import placesRoutes from "./routes/places.js";
import inviteRoutes from "./routes/invite.js";
import notificationsRoutes from "./routes/notifications.js";
import { checkDailyTriggers } from "./services/notificationService.js";

const app = express();

// --- Middleware ---
app.use(compression());
app.use(
  cors({
    origin: [
      "https://moscowwalking.github.io",
      "http://localhost:5500",
      "http://127.0.0.1:5500",
      "http://localhost:3000",
      "http://127.0.0.1:3000",
    ],
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
);
app.use(bodyParser.json());
app.use(express.static("public"));

// --- Routes ---
app.use("/", placesRoutes);
app.use("/", inviteRoutes);
app.use("/", notificationsRoutes);

// --- Health check (Keep-alive ping) ---
app.get("/health", (req, res) => {
  const mskTime = new Date().toLocaleTimeString("ru-RU", {
    timeZone: "Europe/Moscow",
  });
  console.log(`💓 [${mskTime} МСК] Keep-alive ping (/health)`);
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// --- Запуск сервера ---
app.listen(ENV.PORT, () => {
  console.log(`🚀 Server running on port ${ENV.PORT}`);

  // Периодическая проверка раз в час (в 10-11 утра по МСК шлет пуш о годовщинах и "В этот день...")
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
});
