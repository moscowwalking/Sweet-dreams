import express from "express";
import cors from "cors";
import compression from "compression";
import bodyParser from "body-parser";
import { ENV } from "./config/env.js";
import healthRoutes from "./routes/health.js";
import placesRoutes from "./routes/places.js";
import inviteRoutes from "./routes/invite.js";
import notificationsRoutes from "./routes/notifications.js";
import { startPushScheduler } from "./services/scheduler.js";

process.on("uncaughtException", (err) => {
  console.error("UNCAUGHT EXCEPTION:", err);
});

process.on("unhandledRejection", (reason) => {
  console.error("UNHANDLED REJECTION:", reason);
});

const app = express();

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
    methods: ["GET", "POST", "OPTIONS", "DELETE", "HEAD"],
    allowedHeaders: ["Content-Type", "Authorization", "x-api-key", "X-Api-Key"],
  }),
);
app.use(bodyParser.json());
app.use(express.static("public"));

app.use("/", healthRoutes);
app.use("/", placesRoutes);
app.use("/", inviteRoutes);
app.use("/", notificationsRoutes);

const port = process.env.PORT || ENV.PORT || 8080;

if (process.argv[1] && (process.argv[1].endsWith("server.js") || process.argv[1].endsWith("server"))) {
  app.listen(port, "0.0.0.0", () => {
    console.log(`Server running on port ${port}`);
    startPushScheduler();
  });
}

export { app, startPushScheduler };
