import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import fetch from 'node-fetch';
import fs from 'fs';
import AWS from 'aws-sdk';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';

const app = express();
app.use(cors());


// --- Разрешённые источники ---
const allowedOrigins = [
  'http://localhost:5500',
  'http://127.0.0.1:5500',
  'http://localhost:3000',
  'https://moscowwalking.github.io',
  'https://sweet-dreams-f8nc.onrender.com'
];

// --- Middleware ---
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    console.log('🚫 Blocked by CORS:', origin);
    return callback(new Error('Not allowed by CORS'));
  }
}));
app.use(bodyParser.json());
app.use(express.static('public'));

// --- Настройка multer ---
const upload = multer({
  storage: multer.memoryStorage(), // <== Исправлено: используем буфер, а не tmp
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB
});

// --- Настройки AWS S3 (Яндекс) ---
const s3 = new AWS.S3({
  endpoint: process.env.YANDEX_ENDPOINT,
  accessKeyId: process.env.YANDEX_ACCESS_KEY,
  secretAccessKey: process.env.YANDEX_SECRET_KEY,
  region: 'ru-central1',
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PLACES_FILE = path.join(__dirname, 'places.json');

// --- Подсчёт мест ---
function getPlacesCount() {
  try {
    if (fs.existsSync(PLACES_FILE)) {
      const data = fs.readFileSync(PLACES_FILE, 'utf8');
      return JSON.parse(data).length || 0;
    }
  } catch {
    return 0;
  }
  return 0;
}

// --- Бэкап в S3 ---
async function backupPlacesToS3() {
  try {
    if (!fs.existsSync(PLACES_FILE)) return;
    const data = fs.readFileSync(PLACES_FILE);
    await s3.upload({
      Bucket: process.env.YANDEX_BUCKET,
      Key: 'backups/places.json',
      Body: data,
      ContentType: 'application/json',
      ACL: 'public-read'
    }).promise();
    console.log('✅ places.json backed up to S3');
  } catch (err) {
    console.error('❌ Backup failed:', err.message);
  }
}

// --- Восстановление из S3 ---
async function restorePlacesFromS3() {
  try {
    const data = await s3.getObject({
      Bucket: process.env.YANDEX_BUCKET,
      Key: 'backups/places.json'
    }).promise();

    if (data.Body) {
      fs.writeFileSync(PLACES_FILE, data.Body);
      const count = JSON.parse(data.Body).length;
      console.log(`✅ places.json restored from S3 with ${count} places`);
    }
  } catch (error) {
    if (error.code === 'NoSuchKey' || error.message.includes('404')) {
      console.log('📝 No backup found in S3. places.json will NOT be recreated.');
      if (fs.existsSync(PLACES_FILE)) {
        fs.unlinkSync(PLACES_FILE);
        console.log('🗑️ Local places.json deleted because backup missing.');
      }
    } else {
      console.error('❌ Restore from S3 failed:', error.message);
    }
  }
}

// --- Проверка здоровья ---
app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    placesCount: getPlacesCount()
  });
});

// --- Получение мест ---
app.get('/places.json', (req, res) => {
  if (!fs.existsSync(PLACES_FILE)) {
    console.log('⚠️ places.json not found, returning empty array');
    return res.json([]);
  }

  try {
    const data = fs.readFileSync(PLACES_FILE, 'utf8');
    const places = data.trim() ? JSON.parse(data) : [];
    console.log(`✅ Returning ${places.length} places`);
    res.json(places);
  } catch (err) {
    console.error('❌ Error reading places.json:', err.message);
    res.json([]);
  }
});

// --- Загрузка фото с GPS ---
app.post('/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Файл не получен' });

    const fileName = `memory-${Date.now()}.jpeg`;
    const filePath = `memories/${fileName}`;

    // Загружаем фото в Yandex Cloud
    await s3.upload({
      Bucket: BUCKET_NAME,
      Key: filePath,
      Body: req.file.buffer,
      ContentType: req.file.mimetype,
      ACL: 'public-read',
    }).promise();

    const fileUrl = `https://${BUCKET_NAME}.storage.yandexcloud.net/${filePath}`;

    // Пытаемся загрузить актуальный places.json
    let places = [];
    try {
      const data = await s3.getObject({ Bucket: BUCKET_NAME, Key: PLACES_FILE }).promise();
      places = JSON.parse(data.Body.toString('utf-8'));
    } catch (err) {
      console.log('⚠️ places.json не найден — создаём новый');
    }

    // Добавляем новую запись
    const newPlace = {
      id: Date.now().toString(),
      coords: req.body.coords ? JSON.parse(req.body.coords) : null,
      thumbUrl: fileUrl,
      origUrl: fileUrl,
      placeTitle: req.body.placeTitle || 'Новое место',
      timestamp: new Date().toISOString(),
      filename: fileName,
    };

    places.push(newPlace);

    // Загружаем обновлённый JSON в облако
    await s3.upload({
      Bucket: BUCKET_NAME,
      Key: PLACES_FILE,
      Body: JSON.stringify(places, null, 2),
      ContentType: 'application/json',
      ACL: 'public-read',
    }).promise();

    res.json({ success: true, fileUrl });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: error.message });
  }
});

// --- Отправка приглашений (оставляем без изменений) ---
function formatDateLocal(d) {
  const pad = n => (n < 10 ? '0' + n : n);
  return (
    d.getFullYear().toString() +
    pad(d.getMonth() + 1) +
    pad(d.getDate()) +
    'T' +
    pad(d.getHours()) +
    pad(d.getMinutes()) +
    pad(d.getSeconds())
  );
}

app.post('/send-invite', async (req, res) => {
  try {
    const { city, place, date, timeStart, timeEnd, email } = req.body;

    if (!city || !place || !date || !timeStart || !timeEnd) {
      return res.status(400).json({ error: 'Необходимы поля: city, place, date, timeStart, timeEnd' });
    }

    const recipientEmails = [
      email?.trim() || 'n.s.55@inbox.ru',
      'oda2002@mail.ru'
    ];

    const [year, month, day] = date.split('-').map(Number);
    const [startHour, startMinute] = timeStart.split(':').map(Number);
    const [endHour, endMinute] = timeEnd.split(':').map(Number);

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
        recipients: recipientEmails.map(email => ({ email })),
        subject: `💌 Встреча: ${city}, ${place}`,
        from_email: 'invite@sandbox-7833842-f4b715.unigosendbox.com',
        from_name: 'Sweet Dreams',
        body: {
          html: `<p>Скоро увидимся в <b>${city}</b>!<br>📍 ${place}<br>📅 ${date}<br>⏰ ${timeStart}–${timeEnd}</p>`
        },
        attachments: [{
          type: 'text/calendar',
          name: 'invite.ics',
          content: Buffer.from(icsString).toString('base64')
        }]
      }
    };

    const response = await fetch('https://go2.unisender.ru/ru/transactional/api/v1/email/send.json', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.UNISENDER_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();
    if (response.ok && !data.error) {
      res.json({ success: true });
    } else {
      res.status(500).json({ error: data.error?.message || 'Ошибка UniSender' });
    }
  } catch (err) {
    res.status(500).json({ error: 'Ошибка сервера: ' + err.message });
  }
});

// --- Запуск ---
const PORT = process.env.PORT || 3000;
restorePlacesFromS3().then(() => {
  app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
  });
});
