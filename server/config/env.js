import dotenv from "dotenv";

dotenv.config();

export const ENV = {
  PORT: process.env.PORT || 3000,
  YANDEX_ENDPOINT:
    process.env.YANDEX_ENDPOINT || "https://storage.yandexcloud.net",
  YANDEX_ACCESS_KEY: process.env.YANDEX_ACCESS_KEY,
  YANDEX_SECRET_KEY: process.env.YANDEX_SECRET_KEY,
  YANDEX_BUCKET: process.env.YANDEX_BUCKET || "sweet-dream-photos",
  UNISENDER_API_KEY: process.env.UNISENDER_API_KEY,
  FROM_EMAIL: process.env.FROM_EMAIL,
  TO_EMAIL: process.env.TO_EMAIL,
  ADMIN_EMAIL: process.env.ADMIN_EMAIL || "oda2002@mail.ru",
  FIREBASE_SERVICE_ACCOUNT: process.env.FIREBASE_SERVICE_ACCOUNT,
  VAPID_PUBLIC_KEY:
    process.env.VAPID_PUBLIC_KEY ||
    "BJwZf0TySoa8R2J9-DxyqwI4HW79mjFfwvP73LuQTqVZhVk_ZKA7-GHTitsFn4gdu2Dym11-uorAn7WIipdi05M",
  VAPID_PRIVATE_KEY:
    process.env.VAPID_PRIVATE_KEY ||
    "Y02VgbbdulxtE4U5KYKx4eF28DsQLRIlZVNIsSooADI",
  VAPID_SUBJECT: process.env.VAPID_SUBJECT || "mailto:oda2002@mail.ru",
};
