import express from "express";
import cors from "cors";
import compression from "compression";
import bodyParser from "body-parser";
import { ENV } from "./config/env.js";
import placesRoutes from "./routes/places.js";
import inviteRoutes from "./routes/invite.js";

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

// --- Health check ---
app.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// --- Запуск сервера ---
app.listen(ENV.PORT, () => {
  console.log(`🚀 Server running on port ${ENV.PORT}`);
});
