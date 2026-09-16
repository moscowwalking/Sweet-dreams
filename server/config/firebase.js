import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { ENV } from "./env.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const LOCAL_KEY_PATH = path.join(__dirname, "..", "firebase-key.json");

let db = null;

try {
  let serviceAccount = null;

  if (ENV.FIREBASE_SERVICE_ACCOUNT) {
    serviceAccount =
      typeof ENV.FIREBASE_SERVICE_ACCOUNT === "string"
        ? JSON.parse(ENV.FIREBASE_SERVICE_ACCOUNT)
        : ENV.FIREBASE_SERVICE_ACCOUNT;
  } else if (fs.existsSync(LOCAL_KEY_PATH)) {
    serviceAccount = JSON.parse(fs.readFileSync(LOCAL_KEY_PATH, "utf8"));
  }

  if (serviceAccount) {
    const adminApp =
      getApps().length === 0
        ? initializeApp({ credential: cert(serviceAccount) })
        : getApps()[0];
    db = getFirestore(adminApp);
    console.log("🔥 Firebase Firestore успешно подключен к серверу!");
  } else {
    console.warn("⚠️ FIREBASE_SERVICE_ACCOUNT не настроен");
  }
} catch (fbErr) {
  console.error("❌ Ошибка инициализации Firebase Firestore:", fbErr.message);
}

export { db };
