import sharp from "sharp";
import convert from "heic-convert";
import exifr from "exifr";

// Ограничение памяти для работы в пределах 512MB RAM на Render
sharp.concurrency(1);

/**
 * Извлечение даты создания фото из EXIF метаданных (с fallback на текущую дату)
 */
export async function extractExifDate(fileBuffer) {
  try {
    const exifData = await exifr.parse(fileBuffer);
    if (exifData && exifData.DateTimeOriginal) {
      const date = new Date(exifData.DateTimeOriginal);
      const day = date.getDate().toString().padStart(2, "0");
      const month = (date.getMonth() + 1).toString().padStart(2, "0");
      const year = date.getFullYear().toString().slice(-2);
      const exifDate = `${day}.${month}.${year}`;
      console.log("✅ EXIF дата найдена:", exifDate);
      return exifDate;
    }
  } catch (err) {
    console.warn("⚠️ EXIF parsing error:", err.message);
  }

  const date = new Date();
  const day = date.getDate().toString().padStart(2, "0");
  const month = (date.getMonth() + 1).toString().padStart(2, "0");
  const year = date.getFullYear().toString().slice(-2);
  const fallbackDate = `${day}.${month}.${year}`;
  console.log("ℹ️ Используется текущая дата:", fallbackDate);
  return fallbackDate;
}

/**
 * Обработка и конвертация фото в оптимизированный WebP (1920px max, 82% quality)
 */
export async function processAndOptimizeImage(file) {
  let sourceBuffer = file.buffer;

  // Проверка и распаковка HEIC формата с iPhone
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

  console.log("🖼️ Оптимизация фото в WebP (1920px max, quality 82)...");
  try {
    const uploadBuffer = await sharp(sourceBuffer)
      .rotate()
      .resize(1920, 1920, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer();

    console.log(
      `✅ Успешно сконвертировано в WebP (${(uploadBuffer.length / 1024).toFixed(1)} KB)`,
    );
    return uploadBuffer;
  } catch (sharpErr) {
    console.warn(
      "⚠️ Ошибка сжатия в Sharp, fallback на исходный буфер:",
      sharpErr.message,
    );
    return sourceBuffer;
  }
}
