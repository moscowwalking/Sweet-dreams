import {
  PutObjectCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import { s3Client, BUCKET_NAME } from "../config/s3.js";

/**
 * Загрузка оптимизированного изображения в бакет S3
 */
export async function uploadMemoryPhoto(filePath, buffer, contentType = "image/webp") {
  const command = new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: filePath,
    Body: buffer,
    ContentType: contentType,
    ACL: "public-read",
  });

  await s3Client.send(command);
  const fileUrl = `https://${BUCKET_NAME}.storage.yandexcloud.net/${filePath}`;
  console.log("✅ Файл загружен в S3:", fileUrl);
  return fileUrl;
}

/**
 * Удаление массива ключей из S3
 */
export async function deleteS3Objects(keys) {
  if (!keys || keys.length === 0) return;

  const command = new DeleteObjectsCommand({
    Bucket: BUCKET_NAME,
    Delete: {
      Objects: keys.map((Key) => ({ Key })),
      Quiet: true,
    },
  });

  await s3Client.send(command);
  console.log("🗑️ Удалены файлы из S3:", keys);
}

/**
 * Получение всех ключей из S3 с префиксом (с автоматической пагинацией)
 */
export async function getAllBucketObjects(prefix = "memories/") {
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

    const command = new ListObjectsV2Command(params);
    const response = await s3Client.send(command);

    (response.Contents || []).forEach((item) => {
      if (item.Key) keys.add(item.Key);
    });

    isTruncated = response.IsTruncated;
    continuationToken = response.NextContinuationToken;
  }

  return keys;
}
