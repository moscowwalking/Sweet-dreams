import "dotenv/config";
import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import fetch from "node-fetch";
import fs from "fs";
import AWS from "aws-sdk";
import multer from "multer";
import path from "path";
import { fileURLToPath } from "url";
import exifr from "exifr";
import sharp from "sharp";
import convert from "heic-convert";
import { initializeApp as initAdminApp, cert, getApps } from "firebase-admin/app";
import { getFirestore as getAdminFirestore } from "firebase-admin/firestore";

// Ограничение памяти для работы в пределах 512MB RAM на Render
sharp.concurrency(1);
sharp.cache(false);

const app = express();

// --- Настройка CORS ---
const allowedOrigins = [
  "http://localhost:5500",
  "http://127.0.0.1:5500",
  "http://localhost:3000",
  "https://moscowwalking.github.io",
  "https://sweet-dreams-f8nc.onrender.com",
];

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin))
        return callback(null, true);
      console.log("🚫 Blocked by CORS:", origin);
      callback(new Error("Not allowed by CORS"));
    },
  }),
);

app.use(bodyParser.json());
app.use(express.static("public"));

// --- Настройка multer ---
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }, // до 15MB
});

// --- Настройки S3 (Яндекс Cloud) ---
const s3 = new AWS.S3({
  endpoint: process.env.YANDEX_ENDPOINT,
  accessKeyId: process.env.YANDEX_ACCESS_KEY,
  secretAccessKey: process.env.YANDEX_SECRET_KEY,
  region: "ru-central1",
});

const BUCKET_NAME = process.env.YANDEX_BUCKET;

// --- Пути ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- Инициализация Firebase Firestore ---
let db = null;
try {
  let serviceAccount = null;
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    serviceAccount =
      typeof process.env.FIREBASE_SERVICE_ACCOUNT === "string"
        ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
        : process.env.FIREBASE_SERVICE_ACCOUNT;
  } else if (fs.existsSync(path.join(__dirname, "firebase-key.json"))) {
    serviceAccount = JSON.parse(
      fs.readFileSync(path.join(__dirname, "firebase-key.json"), "utf8"),
    );
  }

  if (serviceAccount) {
    const adminApp =
      getApps().length === 0
        ? initAdminApp({ credential: cert(serviceAccount) })
        : getApps()[0];
    db = getAdminFirestore(adminApp);
    console.log("🔥 Firebase Firestore успешно подключен к серверу!");
  } else {
    console.warn("⚠️ FIREBASE_SERVICE_ACCOUNT не настроен");
  }
} catch (fbErr) {
  console.error("❌ Ошибка инициализации Firebase Firestore:", fbErr.message);
}

// --- Получение всех ключей из S3 с префиксом (пагинация) ---
async function getAllBucketObjects(prefix = "memories/") {
  let isTruncated = true;
  let continuationToken = null;
  const keys = new Set();

  while (isTruncated) {
    const params = {
      Bucket: BUCKET_NAME,
      Prefix: prefix,
    };
    if (continuationToken) {
      params.ContinuationToken = continuationToken;
    }
    const response = await s3.listObjectsV2(params).promise();
    (response.Contents || []).forEach((item) => {
      if (item.Key) keys.add(item.Key);
    });
    isTruncated = response.IsTruncated;
    continuationToken = response.NextContinuationToken;
  }
  return keys;
}

// --- Синхронизация Firestore с реальным содержимым S3 бакета (очистка битых ссылок) ---
async function syncPlacesWithS3() {
  if (!BUCKET_NAME || !process.env.YANDEX_ACCESS_KEY) {
    console.warn("⚠️ S3 credentials не настроены, пропускаем синхронизацию");
    return { success: false, reason: "S3 not configured" };
  }
  if (!db) {
    console.warn("⚠️ Firestore не подключен, пропускаем синхронизацию");
    return { success: false, reason: "Firestore not initialized" };
  }

  try {
    console.log(
      "🔄 Проверка меток в Firestore с реальными файлами в бакете S3...",
    );
    const s3Keys = await getAllBucketObjects("memories/");
    console.log(`📦 Найдено реальных файлов в S3 (memories/): ${s3Keys.size}`);

    const snapshot = await db.collection("places").get();
    const places = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));

    let removedCount = 0;
    for (const place of places) {
      let key = null;
      if (place.filename) {
        key = place.filename.startsWith("memories/")
          ? place.filename
          : `memories/${place.filename}`;
      }
      if (!key) {
        const url = place.origUrl || place.thumbUrl || "";
        const match = url.match(/memories\/[^?#]+/);
        if (match) key = match[0];
      }

      if (!key || !s3Keys.has(key)) {
        console.log(
          `🧹 Удаляем из Firestore запись об удаленном файле: id=${place.id}, key=${key || "неизвестен"}`,
        );
        await db.collection("places").doc(String(place.id)).delete();
        removedCount++;
      }
    }

    console.log(
      `✅ Синхронизация завершена: проверено ${places.length}, удалено ${removedCount}`,
    );

    return {
      success: true,
      totalChecked: places.length,
      removedCount,
      remainingCount: places.length - removedCount,
    };
  } catch (err) {
    console.error("❌ Ошибка синхронизации с S3:", err);
    return { success: false, error: err.message };
  }
}

// Эндпоинт получения всех мест из Firestore
app.get("/places", async (req, res) => {
  try {
    if (!db) {
      return res.status(503).json({ error: "Firestore не инициализирован" });
    }
    const snapshot = await db.collection("places").get();
    const places = snapshot.docs.map((doc) => doc.data());
    res.json(places);
  } catch (err) {
    console.error("❌ Ошибка /places:", err);
    res.status(500).json({ error: err.message });
  }
});

// Эндпоинт ручного вызова синхронизации
app.get("/sync-places", async (req, res) => {
  const result = await syncPlacesWithS3();
  res.json(result);
});

// Эндпоинт удаления места/фото по ID (GET или POST)
app.all("/delete-place", async (req, res) => {
  const id = req.query.id || req.body?.id;
  if (!id) {
    return res
      .status(400)
      .json({ error: "Не указан ID места (параметр ?id=...)" });
  }

  try {
    if (!db) {
      return res.status(503).json({ error: "Firestore не инициализирован" });
    }

    const docRef = db.collection("places").doc(String(id));
    const docSnap = await docRef.get();

    if (!docSnap.exists) {
      return res.status(404).json({ error: `Место с id=${id} не найдено` });
    }

    const deletedPlace = docSnap.data();

    // Удаляем документ из Firestore
    await docRef.delete();
    console.log(`🔥 Место id=${id} успешно удалено из Firestore!`);

    // Удаляем связанные фото из S3
    const keysToDelete = [];
    if (deletedPlace.filename) {
      const fnKey = deletedPlace.filename.startsWith("memories/")
        ? deletedPlace.filename
        : `memories/${deletedPlace.filename}`;
      keysToDelete.push(fnKey);
    }
    if (deletedPlace.thumbUrl) {
      const match = deletedPlace.thumbUrl.match(/memories\/[^?#]+/);
      if (match && !keysToDelete.includes(match[0]))
        keysToDelete.push(match[0]);
    }
    if (deletedPlace.origUrl) {
      const match = deletedPlace.origUrl.match(/memories\/[^?#]+/);
      if (match && !keysToDelete.includes(match[0]))
        keysToDelete.push(match[0]);
    }
    if (Array.isArray(deletedPlace.photos)) {
      deletedPlace.photos.forEach((p) => {
        const url = p.url || p.origUrl || p.thumbUrl || "";
        const match = url.match(/memories\/[^?#]+/);
        if (match && !keysToDelete.includes(match[0]))
          keysToDelete.push(match[0]);
      });
    }

    if (keysToDelete.length > 0) {
      await s3
        .deleteObjects({
          Bucket: BUCKET_NAME,
          Delete: {
            Objects: keysToDelete.map((Key) => ({ Key })),
            Quiet: true,
          },
        })
        .promise();
      console.log(`🗑️ Удалены файлы из S3 для места id=${id}:`, keysToDelete);
    }

    res.json({
      success: true,
      message: `Место с id=${id} успешно удалено`,
      deletedPlace,
      deletedFiles: keysToDelete,
    });
  } catch (err) {
    console.error("❌ Ошибка удаления места:", err);
    res.status(500).json({ error: err.message });
  }
});

// Эндпоинт очистки старых неиспользуемых JPEG файлов из S3 (т.к. все фото уже в WebP)
app.get("/cleanup-old-jpegs", async (req, res) => {
  try {
    console.log("🧹 Поиск старых JPEG файлов в бакете S3...");
    const s3Keys = await getAllBucketObjects("memories/");

    // Находим все .jpeg и .jpg файлы
    const jpegKeys = Array.from(s3Keys).filter(
      (key) => /\.(jpe?g)$/i.test(key),
    );

    console.log(`📦 Найдено старых JPEG файлов: ${jpegKeys.length}`);

    if (jpegKeys.length === 0) {
      return res.json({
        success: true,
        message: "Старых JPEG файлов не найдено, бакет уже чист!",
        deletedCount: 0,
      });
    }

    let totalDeleted = 0;
    for (let i = 0; i < jpegKeys.length; i += 1000) {
      const batch = jpegKeys.slice(i, i + 1000).map((key) => ({ Key: key }));
      await s3
        .deleteObjects({
          Bucket: BUCKET_NAME,
          Delete: { Objects: batch, Quiet: true },
        })
        .promise();
      totalDeleted += batch.length;
    }

    console.log(`✅ Успешно удалено ${totalDeleted} старых JPEG файлов из S3`);

    res.json({
      success: true,
      message: `Успешно удалено ${totalDeleted} старых JPEG файлов из S3! В бакете остались только оптимизированные WebP.`,
      deletedCount: totalDeleted,
      deletedFiles: jpegKeys,
    });
  } catch (err) {
    console.error("❌ Ошибка при удалении старых JPEG:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/update-caption", async (req, res) => {
  try {
    const { id, photoIndex = 0, caption } = req.body;
    console.log("📥 Получен запрос на обновление подписи:", {
      id,
      photoIndex,
      caption,
    });

    if (!id || caption === undefined) {
      return res.status(400).json({ error: "Missing id or caption" });
    }

    if (!db) {
      return res.status(503).json({ error: "Firestore не инициализирован" });
    }

    let docRef = db.collection("places").doc(String(id));
    let docSnap = await docRef.get();

    // Находим по координатам, если id передан в виде "lat,lon"
    if (!docSnap.exists && typeof id === "string" && id.includes(",")) {
      const [lat, lon] = id.split(",").map(Number);
      if (!isNaN(lat) && !isNaN(lon)) {
        const snapshot = await db.collection("places").get();
        for (const d of snapshot.docs) {
          const data = d.data();
          if (
            data.coords &&
            Array.isArray(data.coords) &&
            Math.abs(data.coords[0] - lat) < 0.0001 &&
            Math.abs(data.coords[1] - lon) < 0.0001
          ) {
            docRef = d.ref;
            docSnap = d;
            break;
          }
        }
      }
    }

    if (!docSnap.exists) {
      console.warn("⚠️ Место не найдено для id:", id);
      return res
        .status(404)
        .json({ success: false, error: "Место не найдено" });
    }

    const docData = docSnap.data();
    if (
      docData.photos &&
      Array.isArray(docData.photos) &&
      docData.photos[photoIndex]
    ) {
      docData.photos[photoIndex].caption = caption;
      await docRef.update({ photos: docData.photos });
    } else {
      await docRef.update({ caption });
    }

    console.log(`🔥 Подпись места id=${docRef.id} успешно обновлена в Firestore!`);
    res.json({ success: true, id: docRef.id, caption });
  } catch (err) {
    console.error("❌ Ошибка при обновлении подписи:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});


// --- Загрузка фото с логированием ---
app.post("/upload", (req, res) => {
  console.log("📥 /upload request received");
  console.log("Headers:", req.headers["content-type"]);

  upload.any()(req, res, async (err) => {
    if (err instanceof multer.MulterError) {
      console.error("⚠️ MulterError:", err.code, err.message, err.stack);
      return res.status(500).json({ error: err.message, code: err.code });
    } else if (err) {
      console.error("⚠️ Unknown upload error:", err);
      return res
        .status(500)
        .json({ error: "Unknown upload error: " + err.message });
    }

    console.log("--- req.files ---");
    console.log(req.files); // массив всех файлов
    console.log("--- req.body ---");
    console.log(req.body); // все остальные поля

    // ищем файл с полем 'file'
    const exifDateFromClient = req.body.exifDate;
    const file = req.files?.find((f) => f.fieldname === "file");
    if (!file) {
      console.warn('⚠️ Файл "file" не найден в запросе');
      return res.status(400).json({ error: 'Файл "file" не найден в запросе' });
    }

    try {
      const id = Date.now().toString();
      const fileName = `memory-${id}.webp`;
      const filePath = `memories/${fileName}`;
      let exifDate = null;

      try {
        const exifData = await exifr.parse(file.buffer);
        console.log("🔍 EXIF данные:", exifData);

        if (exifData && exifData.DateTimeOriginal) {
          const date = new Date(exifData.DateTimeOriginal);
          const day = date.getDate().toString().padStart(2, "0");
          const month = (date.getMonth() + 1).toString().padStart(2, "0");
          const year = date.getFullYear().toString().slice(-2);
          exifDate = `${day}.${month}.${year}`;
          console.log("✅ EXIF дата найдена:", exifDate);
        } else {
          // Если нет EXIF даты, используем текущую дату
          const date = new Date();
          const day = date.getDate().toString().padStart(2, "0");
          const month = (date.getMonth() + 1).toString().padStart(2, "0");
          const year = date.getFullYear().toString().slice(-2);
          exifDate = `${day}.${month}.${year}`;
          console.log("⚠️ EXIF дата не найдена, используем текущую:", exifDate);
        }
      } catch (exifErr) {
        const date = new Date();
        const day = date.getDate().toString().padStart(2, "0");
        const month = (date.getMonth() + 1).toString().padStart(2, "0");
        const year = date.getFullYear().toString().slice(-2);
        exifDate = `${day}.${month}.${year}`;
        console.log("❌ Ошибка EXIF, используем текущую дату:", exifDate);
      }

      // Подготовка буфера: если HEIC, распаковываем для Sharp
      let sourceBuffer = file.buffer;
      const isHeic =
        /heic|heif/i.test(file.mimetype || "") ||
        /\.(heic|heif)$/i.test(file.originalname || "") ||
        (file.buffer &&
          file.buffer.length > 12 &&
          file.buffer.slice(4, 12).toString("ascii").includes("ftyp"));

      if (isHeic) {
        try {
          console.log("🔄 Распаковка HEIC на сервере через heic-convert...");
          sourceBuffer = await convert({
            buffer: file.buffer,
            format: "JPEG",
            quality: 0.9,
          });
          console.log(
            `✅ HEIC успешно распакован (${(sourceBuffer.length / 1024).toFixed(1)} KB)`,
          );
        } catch (convErr) {
          console.warn("⚠️ heic-convert warning:", convErr.message);
        }
      }

      // Сжатие и конвертация напрямую в WebP (1920px, качество 82%)
      console.log("🖼️ Оптимизация фото в WebP (1920px max, quality 82)...");
      let uploadBuffer;
      try {
        uploadBuffer = await sharp(sourceBuffer)
          .rotate()
          .resize(1920, 1920, { fit: "inside", withoutEnlargement: true })
          .webp({ quality: 82 })
          .toBuffer();
        console.log(
          `✅ Успешно сконвертировано в WebP (${(uploadBuffer.length / 1024).toFixed(1)} KB)`,
        );
      } catch (sharpErr) {
        console.warn(
          "⚠️ Ошибка сжатия в Sharp, fallback на исходный буфер:",
          sharpErr.message,
        );
        uploadBuffer = sourceBuffer;
      }

      await s3
        .upload({
          Bucket: BUCKET_NAME,
          Key: filePath,
          Body: uploadBuffer,
          ContentType: "image/webp",
          ACL: "public-read",
        })
        .promise();

      const fileUrl = `https://${BUCKET_NAME}.storage.yandexcloud.net/${filePath}`;
      console.log("✅ Файл загружен в S3:", fileUrl);

      const newPlace = {
        id,
        coords: req.body.coords ? JSON.parse(req.body.coords) : null,
        thumbUrl: fileUrl,
        origUrl: fileUrl,
        placeTitle: req.body.placeTitle || "Новое место",
        timestamp: new Date().toISOString(),
        filename: fileName,
        exifDate: exifDateFromClient || exifDate,
      };

      // Сохраняем в Firestore
      if (!db) {
        throw new Error("Firestore не подключен к серверу");
      }

      await db.collection("places").doc(id).set(newPlace);
      console.log(`🔥 Место id=${id} успешно сохранено в Firestore!`);

      res.json({
        success: true,
        id,
        fileUrl,
        thumbUrl: fileUrl,
        origUrl: fileUrl,
      });

    } catch (uploadErr) {
      console.error("❌ Ошибка обработки загрузки:", uploadErr);
      res
        .status(500)
        .json({ error: uploadErr.message, stack: uploadErr.stack });
    }
  });
});

// --- Отправка приглашений с логированием ---
function formatDateLocal(d) {
  const pad = (n) => (n < 10 ? "0" + n : n);
  return (
    d.getFullYear().toString() +
    pad(d.getMonth() + 1) +
    pad(d.getDate()) +
    "T" +
    pad(d.getHours()) +
    pad(d.getMinutes()) +
    pad(d.getSeconds())
  );
}

app.post("/send-invite", async (req, res) => {
  try {
    console.log("📨 /send-invite request body:", req.body);

    const { city, place, date, timeStart, timeEnd, email } = req.body;
    if (!city || !place || !date || !timeStart || !timeEnd) {
      return res.status(400).json({
        error: "Необходимы поля: city, place, date, timeStart, timeEnd",
      });
    }

    const recipientEmails = [
      email?.trim() || process.env.TO_EMAIL,
      "oda2002@mail.ru",
    ];

    const [year, month, day] = date.split("-").map(Number);
    const [startHour, startMinute] = timeStart.split(":").map(Number);
    const [endHour, endMinute] = timeEnd.split(":").map(Number);

    const start = new Date(year, month - 1, day, startHour, startMinute);
    const end = new Date(year, month - 1, day, endHour, endMinute);

    const icsString = `BEGIN:VCALENDAR
VERSION:2.0
CALSCALE:GREGORIAN
METHOD:REQUEST
BEGIN:VEVENT
UID:${Date.now()}@sweet-dreams
DTSTAMP:${formatDateLocal(new Date())}
DTSTART;TZID=Europe/Moscow:${formatDateLocal(start)}
DTEND;TZID=Europe/Moscow:${formatDateLocal(end)}
SUMMARY:💖 Встреча
DESCRIPTION:Скоро увидимся! ${city}, ${place}.
LOCATION:${place}, ${city}
STATUS:CONFIRMED
SEQUENCE:0
TRANSP:OPAQUE
END:VEVENT
END:VCALENDAR`;

    const payload = {
      api_key: process.env.UNISENDER_API_KEY,
      message: {
        recipients: recipientEmails.map((email) => ({ email })),
        subject: `💌 Встреча: ${city}, ${place}`,
        from_email: process.env.FROM_EMAIL,
        from_name: "Sweet Dreams",
        body: {
          html: `<p>Скоро увидимся в <b>${city}</b>!<br>📍 ${place}<br>📅 ${date}<br>⏰ ${timeStart}–${timeEnd}</p>`,
        },
        attachments: [
          {
            type: "text/calendar",
            name: "invite.ics",
            content: Buffer.from(icsString).toString("base64"),
          },
        ],
      },
    };

    const response = await fetch(
      "https://go2.unisender.ru/ru/transactional/api/v1/email/send.json",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.UNISENDER_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      },
    );

    const data = await response.json();
    if (response.ok && !data.error) {
      console.log("✅ Invite sent successfully");
      res.json({ success: true });
    } else {
      console.error("❌ UniSender error:", data);
      res
        .status(500)
        .json({ error: data.error?.message || "Ошибка UniSender", data });
    }
  } catch (err) {
    console.error("❌ /send-invite error:", err.stack || err);
    res
      .status(500)
      .json({ error: "Ошибка сервера: " + err.message, stack: err.stack });
  }
});

// --- Запуск сервера ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));

