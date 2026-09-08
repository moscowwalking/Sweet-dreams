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
const PLACES_FILE = path.join(__dirname, "places.json");

// --- Восстановление places.json из S3 ---
async function restorePlacesFromS3() {
  try {
    const data = await s3
      .getObject({ Bucket: BUCKET_NAME, Key: "backups/places.json" })
      .promise();
    if (data.Body) {
      fs.writeFileSync(PLACES_FILE, data.Body);
      console.log(
        `✅ places.json restored from S3 (${JSON.parse(data.Body).length} items)`,
      );
      // Автоматически синхронизируем с бакетом
      await syncPlacesWithS3();
    }
  } catch (err) {
    console.log("⚠️ No backup found in S3, starting with empty list");
    if (fs.existsSync(PLACES_FILE)) fs.unlinkSync(PLACES_FILE);
  }
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

// --- Автоматическая синхронизация places.json с реальным содержимым S3 бакета ---
async function syncPlacesWithS3() {
  if (!BUCKET_NAME || !process.env.YANDEX_ACCESS_KEY) {
    console.warn("⚠️ S3 credentials не настроены, пропускаем синхронизацию");
    return { success: false, reason: "S3 not configured" };
  }

  try {
    console.log(
      "🔄 Синхронизация places.json с реальными файлами в бакете S3...",
    );
    const s3Keys = await getAllBucketObjects("memories/");
    console.log(`📦 Найдено реальных файлов в S3 (memories/): ${s3Keys.size}`);

    let places = [];
    try {
      const data = await s3
        .getObject({ Bucket: BUCKET_NAME, Key: "backups/places.json" })
        .promise();
      if (data.Body) {
        places = JSON.parse(data.Body.toString());
      }
    } catch (e) {
      if (fs.existsSync(PLACES_FILE)) {
        places = JSON.parse(fs.readFileSync(PLACES_FILE, "utf8"));
      }
    }

    if (!Array.isArray(places)) {
      console.warn("⚠️ places.json не является массивом данных");
      return { success: false, error: "Invalid places format" };
    }

    const beforeCount = places.length;
    const cleaned = places.filter((place) => {
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
          `🧹 Удаляем запись об удаленном файле: id=${place.id}, key=${key || "неизвестен"}`,
        );
        return false;
      }
      return true;
    });

    // Отказываемся от thumbs: нормализуем все ссылки на единый URL
    for (const place of cleaned) {
      if (place.thumbUrl && place.thumbUrl.includes("/thumbs/")) {
        place.thumbUrl = place.thumbUrl
          .replace("/thumbs/", "/")
          .replace("thumb-", "memory-");
      }
      if (place.origUrl && place.origUrl.includes("/thumbs/")) {
        place.origUrl = place.origUrl
          .replace("/thumbs/", "/")
          .replace("thumb-", "memory-");
      }
      if (place.filename && place.filename.includes("thumbs/")) {
        place.filename = place.filename
          .replace("thumbs/", "")
          .replace("thumb-", "memory-");
      }
    }

    // Проверяем наличие сырых HEIC файлов, сохраненных как .jpeg (например с iPhone), и конвертируем их в реальный JPEG
    for (const place of cleaned) {
      if (place.filename && place.filename.endsWith(".jpeg")) {
        const s3Key = place.filename.startsWith("memories/")
          ? place.filename
          : `memories/${place.filename}`;
        try {
          const s3Obj = await s3
            .getObject({ Bucket: BUCKET_NAME, Key: s3Key })
            .promise();
          if (
            s3Obj.Body &&
            s3Obj.Body.length > 12 &&
            s3Obj.Body.slice(4, 12).toString("ascii").includes("ftyp")
          ) {
            console.log(
              `🔄 Обнаружен сырой HEIC в ${s3Key}, конвертируем в JPEG через heic-convert...`,
            );
            const convertedJpeg = await convert({
              buffer: s3Obj.Body,
              format: "JPEG",
              quality: 0.88,
            });
            await s3
              .putObject({
                Bucket: BUCKET_NAME,
                Key: s3Key,
                Body: convertedJpeg,
                ContentType: "image/jpeg",
                ACL: "public-read",
              })
              .promise();
            console.log(
              `✅ ${s3Key} успешно переконвертирован в реальный JPEG!`,
            );
          }
        } catch (e) {
          console.warn(`⚠️ Ошибка проверки/конвертации ${s3Key}:`, e.message);
        }
      }
    }

    const removedCount = beforeCount - cleaned.length;
    console.log(
      `✅ Синхронизация завершена: было ${beforeCount}, осталось ${cleaned.length} (удалено ${removedCount})`,
    );

    fs.writeFileSync(PLACES_FILE, JSON.stringify(cleaned, null, 2));

    await s3
      .putObject({
        Bucket: BUCKET_NAME,
        Key: "backups/places.json",
        Body: JSON.stringify(cleaned, null, 2),
        ContentType: "application/json",
        ACL: "public-read",
      })
      .promise();

    console.log("💾 backups/places.json успешно обновлен в S3");
    return {
      success: true,
      beforeCount,
      currentCount: cleaned.length,
      removedCount,
    };
  } catch (err) {
    console.error("❌ Ошибка синхронизации с S3:", err);
    return { success: false, error: err.message };
  }
}

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
    let places = [];
    try {
      const data = await s3
        .getObject({ Bucket: BUCKET_NAME, Key: "backups/places.json" })
        .promise();
      if (data.Body) places = JSON.parse(data.Body.toString());
    } catch (e) {
      if (fs.existsSync(PLACES_FILE)) {
        places = JSON.parse(fs.readFileSync(PLACES_FILE, "utf8"));
      }
    }

    const placeIndex = places.findIndex((p) => String(p.id) === String(id));
    if (placeIndex === -1) {
      return res.status(404).json({ error: `Место с id=${id} не найдено` });
    }

    const [deletedPlace] = places.splice(placeIndex, 1);

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

    fs.writeFileSync(PLACES_FILE, JSON.stringify(places, null, 2));
    await s3
      .putObject({
        Bucket: BUCKET_NAME,
        Key: "backups/places.json",
        Body: JSON.stringify(places, null, 2),
        ContentType: "application/json",
        ACL: "public-read",
      })
      .promise();

    res.json({
      success: true,
      message: `Место с id=${id} успешно удалено`,
      deletedPlace,
      deletedFiles: keysToDelete,
      remainingCount: places.length,
    });
  } catch (err) {
    console.error("❌ Ошибка удаления места:", err);
    res.status(500).json({ error: err.message });
  }
});

// Эндпоинт пакетной конвертации существующих фото в WebP (миниатюры + сжатые оригиналы)
app.get("/migrate-photos", async (req, res) => {
  try {
    console.log("🚀 Запуск миграции старых фото в WebP формат...");
    let places = [];
    try {
      const data = await s3
        .getObject({ Bucket: BUCKET_NAME, Key: "backups/places.json" })
        .promise();
      if (data.Body) {
        places = JSON.parse(data.Body.toString());
      }
    } catch (e) {
      if (fs.existsSync(PLACES_FILE)) {
        places = JSON.parse(fs.readFileSync(PLACES_FILE, "utf8"));
      }
    }

    let processed = 0;
    let errors = 0;

    for (let i = 0; i < places.length; i++) {
      const place = places[i];
      const origUrl = place.origUrl || place.thumbUrl;
      if (!origUrl) continue;

      // Если уже сконвертировано в WebP — пропускаем
      if (
        (place.origUrl && place.origUrl.endsWith(".webp")) ||
        (place.filename && place.filename.endsWith(".webp"))
      ) {
        continue;
      }

      console.log(
        `[${i + 1}/${places.length}] Конвертация места ${place.id}...`,
      );

      try {
        const match = origUrl.match(/memories\/[^?#]+/);
        const sourceKey = match
          ? match[0]
          : place.filename?.startsWith("memories/")
            ? place.filename
            : `memories/${place.filename}`;

        let fileBuffer;
        try {
          const s3Obj = await s3
            .getObject({ Bucket: BUCKET_NAME, Key: sourceKey })
            .promise();
          fileBuffer = s3Obj.Body;
        } catch (downloadErr) {
          const r = await fetch(origUrl);
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          fileBuffer = Buffer.from(await r.arrayBuffer());
        }

        const id = place.id || Date.now().toString();
        const origFileName = `memory-${id}.webp`;
        const origPath = `memories/${origFileName}`;

        const origBuffer = await sharp(fileBuffer)
          .rotate()
          .resize(1920, 1920, { fit: "inside", withoutEnlargement: true })
          .webp({ quality: 82 })
          .toBuffer();

        await s3
          .putObject({
            Bucket: BUCKET_NAME,
            Key: origPath,
            Body: origBuffer,
            ContentType: "image/webp",
            ACL: "public-read",
          })
          .promise();

        const newOrigUrl = `https://${BUCKET_NAME}.storage.yandexcloud.net/${origPath}`;

        place.origUrl = newOrigUrl;
        place.thumbUrl = newOrigUrl;
        place.filename = origFileName;
        processed++;
        console.log(`✅ Место ${place.id} успешно сконвертировано в WebP`);
      } catch (placeErr) {
        console.error(
          `❌ Ошибка конвертации места ${place.id}:`,
          placeErr.message,
        );
        errors++;
      }
    }

    if (processed > 0) {
      fs.writeFileSync(PLACES_FILE, JSON.stringify(places, null, 2));
      await s3
        .putObject({
          Bucket: BUCKET_NAME,
          Key: "backups/places.json",
          Body: JSON.stringify(places, null, 2),
          ContentType: "application/json",
          ACL: "public-read",
        })
        .promise();
      console.log(
        `💾 backups/places.json обновлен после миграции (сконвертировано: ${processed})`,
      );
    }

    res.json({
      success: true,
      message: `Миграция завершена: обработано ${processed}, ошибок ${errors}, всего ${places.length}`,
      processed,
      errors,
      total: places.length,
    });
  } catch (err) {
    console.error("❌ Ошибка пакетной миграции:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Эндпоинт очистки старых неиспользуемых JPEG файлов из S3 (т.к. все фото уже в WebP)
app.get("/cleanup-old-jpegs", async (req, res) => {
  try {
    console.log("🧹 Поиск старых JPEG файлов в бакете S3...");
    const s3Keys = await getAllBucketObjects("memories/");

    // Находим все .jpeg и .jpg файлы
    const jpegKeys = Array.from(s3Keys).filter(
      (key) => /\.(jpe?g)$/i.test(key) && !key.includes("places.json"),
    );

    console.log(`📦 Найдено старых JPEG файлов: ${jpegKeys.length}`);

    if (jpegKeys.length === 0) {
      return res.json({
        success: true,
        message: "Старых JPEG файлов не найдено, бакет уже чист!",
        deletedCount: 0,
      });
    }

    // Удаляем пачками по 1000 штук
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

// Эндпоинт очистки всех файлов из папки memories/thumbs/ в S3 и обновления places.json
app.get("/cleanup-thumbs", async (req, res) => {
  try {
    console.log("🧹 Поиск файлов в memories/thumbs/ для удаления...");
    const s3Keys = await getAllBucketObjects("memories/thumbs/");
    const thumbKeys = Array.from(s3Keys).filter((k) =>
      k.startsWith("memories/thumbs/"),
    );

    console.log(`📦 Найдено файлов в папке thumbs: ${thumbKeys.length}`);

    let totalDeleted = 0;
    if (thumbKeys.length > 0) {
      for (let i = 0; i < thumbKeys.length; i += 1000) {
        const batch = thumbKeys.slice(i, i + 1000).map((key) => ({ Key: key }));
        await s3
          .deleteObjects({
            Bucket: BUCKET_NAME,
            Delete: { Objects: batch, Quiet: true },
          })
          .promise();
        totalDeleted += batch.length;
      }
      console.log(
        `✅ Успешно удалено ${totalDeleted} файлов из memories/thumbs/ в S3`,
      );
    }

    // Очищаем places.json от любых упоминаний /thumbs/
    let places = [];
    try {
      const data = await s3
        .getObject({ Bucket: BUCKET_NAME, Key: "backups/places.json" })
        .promise();
      if (data.Body) places = JSON.parse(data.Body.toString());
    } catch (e) {
      if (fs.existsSync(PLACES_FILE)) {
        places = JSON.parse(fs.readFileSync(PLACES_FILE, "utf8"));
      }
    }

    let modifiedCount = 0;
    for (const place of places) {
      let changed = false;
      if (place.thumbUrl && place.thumbUrl.includes("/thumbs/")) {
        place.thumbUrl = place.thumbUrl
          .replace("/thumbs/", "/")
          .replace("thumb-", "memory-");
        changed = true;
      }
      if (place.origUrl && place.origUrl.includes("/thumbs/")) {
        place.origUrl = place.origUrl
          .replace("/thumbs/", "/")
          .replace("thumb-", "memory-");
        changed = true;
      }
      if (place.filename && place.filename.includes("thumbs/")) {
        place.filename = place.filename
          .replace("thumbs/", "")
          .replace("thumb-", "memory-");
        changed = true;
      }
      if (changed) modifiedCount++;
    }

    if (modifiedCount > 0) {
      fs.writeFileSync(PLACES_FILE, JSON.stringify(places, null, 2));
      await s3
        .putObject({
          Bucket: BUCKET_NAME,
          Key: "backups/places.json",
          Body: JSON.stringify(places, null, 2),
          ContentType: "application/json",
          ACL: "public-read",
        })
        .promise();
      console.log(
        `💾 places.json обновлен: очищено ${modifiedCount} записей от /thumbs/`,
      );
    }

    res.json({
      success: true,
      message: `Папка thumbs полностью удалена. Удалено файлов из S3: ${totalDeleted}, обновлено записей в places.json: ${modifiedCount}`,
      deletedFilesCount: totalDeleted,
      updatedPlacesCount: modifiedCount,
      deletedFiles: thumbKeys,
    });
  } catch (err) {
    console.error("❌ Ошибка очистки thumbs:", err);
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

    const fileData = await s3
      .getObject({
        Bucket: BUCKET_NAME,
        Key: "backups/places.json",
      })
      .promise();

    const places = JSON.parse(fileData.Body.toString());

    // Находим по ID или по координатам (если id был передан в виде "lat,lon")
    let foundIndex = places.findIndex((p) => String(p.id) === String(id));

    if (foundIndex === -1 && typeof id === "string" && id.includes(",")) {
      const [lat, lon] = id.split(",").map(Number);
      if (!isNaN(lat) && !isNaN(lon)) {
        foundIndex = places.findIndex((p) => {
          if (!p.coords || !Array.isArray(p.coords) || p.coords.length < 2)
            return false;
          return (
            Math.abs(p.coords[0] - lat) < 0.0001 &&
            Math.abs(p.coords[1] - lon) < 0.0001
          );
        });
      }
    }

    if (foundIndex === -1) {
      console.warn("⚠️ Место не найдено для id:", id);
      return res
        .status(404)
        .json({ success: false, error: "Место не найдено" });
    }

    const found = places[foundIndex];

    // Обновляем подпись
    if (
      found.photos &&
      Array.isArray(found.photos) &&
      found.photos[photoIndex]
    ) {
      found.photos[photoIndex].caption = caption;
    } else {
      found.caption = caption;
    }

    // Синхронизируем локальный файл и бэкап в S3
    fs.writeFileSync(PLACES_FILE, JSON.stringify(places, null, 2));

    await s3
      .putObject({
        Bucket: BUCKET_NAME,
        Key: "backups/places.json",
        Body: JSON.stringify(places, null, 2),
        ContentType: "application/json",
      })
      .promise();

    console.log(`✅ Подпись сохранена у места id=${found.id}`);
    res.json({ success: true, id: found.id });
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

      // сохраняем в places.json
      let places = [];
      try {
        const data = fs.existsSync(PLACES_FILE)
          ? fs.readFileSync(PLACES_FILE, "utf8")
          : "[]";
        places = JSON.parse(data);
      } catch (readErr) {
        console.error("❌ Ошибка чтения places.json:", readErr);
        places = [];
      }

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

      places.push(newPlace);
      fs.writeFileSync(PLACES_FILE, JSON.stringify(places, null, 2));
      console.log("✅ Новое место добавлено в places.json");

      // бэкап в S3
      await s3
        .upload({
          Bucket: BUCKET_NAME,
          Key: "backups/places.json",
          Body: JSON.stringify(places, null, 2),
          ContentType: "application/json",
          ACL: "public-read",
        })
        .promise();
      console.log("✅ places.json сохранён в S3 backup");

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

function cleanPlacesJson() {
  try {
    const path = "./places.json";
    if (!fs.existsSync(path)) return;

    const raw = fs.readFileSync(path, "utf8");
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) return;

    const before = data.length;
    const cleaned = data.filter((p) => p.origUrl || p.thumbUrl);
    if (cleaned.length !== before) {
      fs.writeFileSync(path, JSON.stringify(cleaned, null, 2));
      console.log(
        `🧹 Очищен places.json: удалено ${before - cleaned.length} пустых записей`,
      );
    }
  } catch (err) {
    console.error("❌ Ошибка очистки places.json:", err);
  }
}

// вызываем после загрузки сервера
cleanPlacesJson();
// --- Запуск сервера ---
const PORT = process.env.PORT || 3000;
restorePlacesFromS3().then(() => {
  app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
});
