import { S3Client } from "@aws-sdk/client-s3";
import { ENV } from "./env.js";

export const s3Client = new S3Client({
  endpoint: ENV.YANDEX_ENDPOINT,
  region: "ru-central1",
  credentials: {
    accessKeyId: ENV.YANDEX_ACCESS_KEY || "",
    secretAccessKey: ENV.YANDEX_SECRET_KEY || "",
  },
  forcePathStyle: true,
});

export const BUCKET_NAME = ENV.YANDEX_BUCKET;
