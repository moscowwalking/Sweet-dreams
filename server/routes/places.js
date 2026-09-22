import express from "express";
import multer from "multer";
import { db } from "../config/firebase.js";
import {
  extractExifDate,
  processAndOptimizeImage,
} from "../services/imageService.js";
import {
  uploadMemoryPhoto,
  deleteS3Objects,
  getAllBucketObjects,
} from "../services/s3Service.js";
import { notifyNewPhotoUploaded } from "../services/notificationService.js";
import { ENV } from "../config/env.js";
import { requireApiKey } from "../middlewares/auth.js";

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }, // до 15MB
});

/**
 * GET /places - Получение всех точек из Firestore
 */
router.get("/places", async (req, res) => {
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

/**
 * POST /upload - Загрузка и оптимизация фото с сохранением в Firestore
 */
router.post("/upload", (req, res) => {
  console.log("📥 /upload request received");

  upload.any()(req, res, async (err) => {
    if (err instanceof multer.MulterError) {
      console.error("⚠️ MulterError:", err.code, err.message);
      return res.status(500).json({ error: err.message, code: err.code });
    } else if (err) {
      console.error("⚠️ Upload error:", err);
      return res.status(500).json({ error: "Upload error: " + err.message });
    }

    const exifDateFromClient = req.body.exifDate;
    const file =
      req.files?.find((f) => f.fieldname === "file") || req.files?.[0];

    if (!file) {
      console.warn("⚠️ Файл не найден в запросе");
      return res.status(400).json({ error: "Файл не загружен" });
    }

    try {
      const id = Date.now().toString();
      const fileName = `memory-${id}.webp`;
      const filePath = `memories/${fileName}`;

      // 1. Определение EXIF даты
      const exifDate = await extractExifDate(file.buffer);

      // 2. Сжатие и оптимизация в WebP
      const uploadBuffer = await processAndOptimizeImage(file);

      // 3. Загрузка в S3
      const fileUrl = await uploadMemoryPhoto(filePath, uploadBuffer);

      // 4. Сохранение в Firestore
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

      if (!db) {
        throw new Error("Firestore не подключен к серверу");
      }

      await db.collection("places").doc(id).set(newPlace);
      console.log(`🔥 Место id=${id} успешно сохранено в Firestore!`);

      // Уведомление о новых фото (с группировкой/debounce)
      notifyNewPhotoUploaded(id);

      res.json({
        success: true,
        id,
        fileUrl,
        thumbUrl: fileUrl,
        origUrl: fileUrl,
      });
    } catch (uploadErr) {
      console.error("❌ Ошибка обработки загрузки:", uploadErr);
      res.status(500).json({ error: uploadErr.message });
    }
  });
});

/**
 * POST /update-caption - Обновление подписи конкретного места в Firestore
 */
router.post("/update-caption", async (req, res) => {
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

    console.log(
      `🔥 Подпись места id=${docRef.id} успешно обновлена в Firestore!`,
    );
    res.json({ success: true, id: docRef.id, caption });
  } catch (err) {
    console.error("❌ Ошибка при обновлении подписи:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * ALL /delete-place - Удаление места из Firestore и его файлов из S3 (защищено API ключом)
 */
router.all("/delete-place", requireApiKey, async (req, res) => {
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

    // 1. Удаляем из базы
    await docRef.delete();
    console.log(`🔥 Место id=${id} успешно удалено из Firestore!`);

    // 2. Собираем ключи файлов для удаления из S3
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

    // 3. Удаляем файлы из S3
    if (keysToDelete.length > 0) {
      await deleteS3Objects(keysToDelete);
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

/**
 * ALL /sync-places - Синхронизация базы Firestore с бакетом S3 (защищено API ключом)
 */
router.all("/sync-places", requireApiKey, async (req, res) => {
  if (!ENV.YANDEX_BUCKET || !ENV.YANDEX_ACCESS_KEY) {
    return res
      .status(500)
      .json({ success: false, reason: "S3 credentials не настроены" });
  }
  if (!db) {
    return res
      .status(503)
      .json({ success: false, reason: "Firestore не инициализирован" });
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
          `🧹 Удаляем из Firestore запись об удаленном файле: id=${place.id}`,
        );
        await db.collection("places").doc(String(place.id)).delete();
        removedCount++;
      }
    }

    res.json({
      success: true,
      totalChecked: places.length,
      removedCount,
      remainingCount: places.length - removedCount,
    });
  } catch (err) {
    console.error("❌ Ошибка синхронизации с S3:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
