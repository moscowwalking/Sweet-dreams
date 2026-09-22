import { ENV } from "../config/env.js";
export const requireApiKey = (req, res, next) => {
  const apiKey =
    req.get("x-api-key") ||
    req.headers["x-api-key"] ||
    req.query.apiKey ||
    req.query.key ||
    req.body?.apiKey;

  if (!apiKey || apiKey !== ENV.API_SECRET_KEY) {
    console.warn(
      `[AUTH] Отклонен неавторизованный запрос к ${req.method} ${req.originalUrl} с IP ${req.ip}`,
    );
    return res.status(403).json({
      error: "Доступ запрещён",
    });
  }

  next();
};
