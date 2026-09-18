import webpush from "web-push";
import { ENV } from "../config/env.js";
import { db } from "../config/firebase.js";

// 1. Инициализация VAPID ключей
webpush.setVapidDetails(
  ENV.VAPID_SUBJECT,
  ENV.VAPID_PUBLIC_KEY,
  ENV.VAPID_PRIVATE_KEY,
);

let lastDailyCheckDate = null;
let uploadNotificationTimer = null;
let uploadBatchCount = 0;
let uploadBatchPlaceIds = [];

// Дата начала отношений (23 августа 2025)
const RELATIONSHIP_START = new Date(2025, 7, 23);

/**
 * Сохранение подписки в Firestore
 */
export async function saveSubscription(subscription) {
  if (!db || !subscription || !subscription.endpoint) {
    throw new Error("Некорректная подписка или нет связи с базой данных");
  }

  // Создаем безопасный ключ документа на основе endpoint
  const id = Buffer.from(subscription.endpoint)
    .toString("base64url")
    .slice(0, 60);
  await db.collection("push_subscriptions").doc(id).set({
    subscription,
    updatedAt: new Date().toISOString(),
  });
  console.log(`🔔 Подписка сохранена (id: ${id.slice(0, 10)}...)`);
}

/**
 * Удаление устаревшей подписки
 */
export async function removeSubscription(subscription) {
  if (!db || !subscription?.endpoint) return;
  try {
    const id = Buffer.from(subscription.endpoint)
      .toString("base64url")
      .slice(0, 60);
    await db.collection("push_subscriptions").doc(id).delete();
    console.log(`🔕 Подписка удалена (id: ${id.slice(0, 10)}...)`);
  } catch (err) {
    console.warn("⚠️ Ошибка при удалении подписки:", err.message);
  }
}

/**
 * Отправка пуш-уведомления всем сохранённым устройствам
 */
export async function sendNotificationToAll(payload) {
  if (!db) {
    console.warn("⚠️ Firestore не подключен, пуши не отправлены");
    return { sent: 0, failed: 0 };
  }

  const snap = await db.collection("push_subscriptions").get();
  const subs = [];
  snap.forEach((doc) => {
    const data = doc.data();
    if (data?.subscription?.endpoint) {
      subs.push(data.subscription);
    }
  });

  if (subs.length === 0) {
    console.log("ℹ️ Нет активных подписчиков для пуш-уведомлений");
    return { sent: 0, failed: 0 };
  }

  let sent = 0;
  let failed = 0;

  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(sub, JSON.stringify(payload));
        sent++;
      } catch (err) {
        failed++;
        // 404 (Not Found) или 410 (Gone) означают, что пользователь сбросил разрешение или удалил PWA
        if (err.statusCode === 404 || err.statusCode === 410) {
          await removeSubscription(sub);
        } else {
          console.warn("⚠️ Ошибка отправки пуша:", err.statusCode, err.message);
        }
      }
    }),
  );

  console.log(`📢 Пуш отправлен: успешно=${sent}, ошибок=${failed}`);
  return { sent, failed };
}

/**
 * Умная группировка пушей при загрузке нескольких фото (2 минуты debounce)
 */
export function notifyNewPhotoUploaded(placeId = null) {
  uploadBatchCount++;
  if (placeId && !uploadBatchPlaceIds.includes(String(placeId))) {
    uploadBatchPlaceIds.push(String(placeId));
  }

  if (uploadNotificationTimer) {
    clearTimeout(uploadNotificationTimer);
  }

  // Ждем 2 минуты после последней загрузки, чтобы не спамить
  uploadNotificationTimer = setTimeout(
    async () => {
      const ids = [...uploadBatchPlaceIds];
      uploadBatchCount = 0;
      uploadBatchPlaceIds = [];
      uploadNotificationTimer = null;

      const url =
        ids.length > 0
          ? `./memories.html?recentUploads=${encodeURIComponent(ids.join(","))}`
          : "./memories.html?recentUploads=true";

      await sendNotificationToAll({
        title: "Новое воспоминание! 📸",
        body: "На карту добавлено новое воспоминание! 🗺️💖",
        data: { url },
      });
    },
    2 * 60 * 1000,
  );
}

/**
 * Ежедневная проверка событий (каждые 100 дней, годовщины, "В этот день...")
 */
export async function checkDailyTriggers(forced = false) {
  const now = new Date();
  const todayStr = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
  const mskTime = now.toLocaleTimeString("ru-RU", { timeZone: "Europe/Moscow" });
  console.log(`⏰ [${mskTime} МСК] Запущена проверка ежедневных триггеров (forced=${forced})...`);

  // Защита от повторной отправки в течение дня (если не forced)
  if (!forced && lastDailyCheckDate === todayStr) {
    console.log(`ℹ️ [${mskTime} МСК] Проверка уже выполнялась сегодня (${todayStr}), пропускаем.`);
    return { skipped: true, reason: "Already checked today" };
  }

  lastDailyCheckDate = todayStr;
  const curDay = now.getDate();
  const curMonth = now.getMonth();
  const curYear = now.getFullYear();

  // 1. Проверка круглых дат (каждые 100 дней)
  const diffTime = now.getTime() - RELATIONSHIP_START.getTime();
  const daysTogether = Math.floor(diffTime / (1000 * 60 * 60 * 24));

  if (daysTogether > 0 && daysTogether % 100 === 0) {
    await sendNotificationToAll({
      title: "Сладкий юбилей! 🎉❤️",
      body: `Сегодня ровно ${daysTogether} дней наших отношений! Загляни на карту 🥂`,
      data: { url: "./memories.html" },
    });
    return { triggered: "milestone_100_days", daysTogether };
  }

  // 2. Проверка годовщины (23 августа каждого года)
  if (
    curDay === RELATIONSHIP_START.getDate() &&
    curMonth === RELATIONSHIP_START.getMonth()
  ) {
    const years = curYear - RELATIONSHIP_START.getFullYear();
    if (years > 0) {
      const yearWord = years === 1 ? "год" : years < 5 ? "года" : "лет";
      await sendNotificationToAll({
        title: "С годовщиной любимые! 🥂❤️",
        body: `Сегодня ровно ${years} ${yearWord} нашим отношениям!`,
        data: { url: "./memories.html" },
      });
      return { triggered: "anniversary", years };
    }
  }

  // 3. Проверка «В этот день ровно год назад...»
  if (db) {
    try {
      const snap = await db.collection("places").get();
      let matchPhoto = null;
      let matchYearsAgo = 1;

      snap.forEach((doc) => {
        if (matchPhoto) return;
        const place = doc.data();
        let pDate = null;
        if (place.exifDate) {
          const parts = place.exifDate.split(".");
          if (parts.length === 3) {
            const y =
              parseInt(parts[2], 10) < 100
                ? 2000 + parseInt(parts[2], 10)
                : parseInt(parts[2], 10);
            pDate = new Date(
              y,
              parseInt(parts[1], 10) - 1,
              parseInt(parts[0], 10),
            );
          }
        } else if (place.timestamp) {
          pDate = new Date(place.timestamp);
        }

        if (pDate && !isNaN(pDate.getTime())) {
          if (
            pDate.getDate() === curDay &&
            pDate.getMonth() === curMonth &&
            pDate.getFullYear() < curYear
          ) {
            matchPhoto = place;
            matchYearsAgo = curYear - pDate.getFullYear();
          }
        }
      });

      if (matchPhoto) {
        const word =
          matchYearsAgo === 1 ? "год" : matchYearsAgo < 5 ? "года" : "лет";
        await sendNotificationToAll({
          title: "В этот день... 📸",
          body: `В этот день ровно ${matchYearsAgo === 1 ? "год" : `${matchYearsAgo} ${word}`} назад... Посмотрим? ✨`,
          data: { url: "./memories.html?autoOpenNostalgia=true" },
        });
        return { triggered: "nostalgia", yearsAgo: matchYearsAgo };
      }
    } catch (err) {
      console.warn("⚠️ Ошибка проверки воспоминаний для пуша:", err.message);
    }
  }

  // 4. По субботам: «Случайное тёплое воспоминание»
  if (now.getDay() === 6) {
    await sendNotificationToAll({
      title: "Тёплое воспоминание ☕✨",
      body: "Теплое воспоминание! Загляни на карту 💕",
      data: { url: "./memories.html?randomMemory=true" },
    });
    return { triggered: "saturday_random_memory" };
  }

  console.log(`ℹ️ [${mskTime} МСК] Событий на сегодня нет (triggered: none)`);
  return { triggered: "none" };
}
