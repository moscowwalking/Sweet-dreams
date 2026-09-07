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
import exifr from 'exifr';
import sharp from 'sharp';


const app = express();

// --- Настройка CORS ---
const allowedOrigins = [
  'http://localhost:5500',
  'http://127.0.0.1:5500',
  'http://localhost:3000',
  'https://moscowwalking.github.io',
  'https://sweet-dreams-f8nc.onrender.com'
];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    console.log('🚫 Blocked by CORS:', origin);
    callback(new Error('Not allowed by CORS'));
  }
}));

app.use(bodyParser.json());
app.use(express.static('public'));

// --- Настройка multer ---
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 } // до 15MB
});

// --- Настройки S3 (Яндекс Cloud) ---
const s3 = new AWS.S3({
  endpoint: process.env.YANDEX_ENDPOINT,
  accessKeyId: process.env.YANDEX_ACCESS_KEY,
  secretAccessKey: process.env.YANDEX_SECRET_KEY,
  region: 'ru-central1',
});

const BUCKET_NAME = process.env.YANDEX_BUCKET;

// --- Пути ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PLACES_FILE = path.join(__dirname, 'places.json');

// --- Восстановление places.json из S3 ---
async function restorePlacesFromS3() {
  try {
    const data = await s3.getObject({ Bucket: BUCKET_NAME, Key: 'backups/places.json' }).promise();
    if (data.Body) {
      fs.writeFileSync(PLACES_FILE, data.Body);
      console.log(`✅ places.json restored from S3 (${JSON.parse(data.Body).length} items)`);
      // Автоматически синхронизируем с бакетом
      await syncPlacesWithS3();
    }
  } catch (err) {
    console.log('⚠️ No backup found in S3, starting with empty list');
    if (fs.existsSync(PLACES_FILE)) fs.unlinkSync(PLACES_FILE);
  }
}

// --- Получение всех ключей из S3 с префиксом (пагинация) ---
async function getAllBucketObjects(prefix = 'memories/') {
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
    (response.Contents || []).forEach(item => {
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
    console.warn('⚠️ S3 credentials не настроены, пропускаем синхронизацию');
    return { success: false, reason: 'S3 not configured' };
  }

  try {
    console.log('🔄 Синхронизация places.json с реальными файлами в бакете S3...');
    const s3Keys = await getAllBucketObjects('memories/');
    console.log(`📦 Найдено реальных файлов в S3 (memories/): ${s3Keys.size}`);

    let places = [];
    try {
      const data = await s3.getObject({ Bucket: BUCKET_NAME, Key: 'backups/places.json' }).promise();
      if (data.Body) {
        places = JSON.parse(data.Body.toString());
      }
    } catch (e) {
      if (fs.existsSync(PLACES_FILE)) {
        places = JSON.parse(fs.readFileSync(PLACES_FILE, 'utf8'));
      }
    }

    if (!Array.isArray(places)) {
      console.warn('⚠️ places.json не является массивом данных');
      return { success: false, error: 'Invalid places format' };
    }

    const beforeCount = places.length;
    const cleaned = places.filter(place => {
      let key = null;
      if (place.filename) {
        key = place.filename.startsWith('memories/') ? place.filename : `memories/${place.filename}`;
      }
      if (!key) {
        const url = place.origUrl || place.thumbUrl || '';
        const match = url.match(/memories\/[^?#]+/);
        if (match) key = match[0];
      }

      if (!key || !s3Keys.has(key)) {
        console.log(`🧹 Удаляем запись об удаленном файле: id=${place.id}, key=${key || 'неизвестен'}`);
        return false;
      }
      return true;
    });

    const removedCount = beforeCount - cleaned.length;
    console.log(`✅ Синхронизация завершена: было ${beforeCount}, осталось ${cleaned.length} (удалено ${removedCount})`);

    fs.writeFileSync(PLACES_FILE, JSON.stringify(cleaned, null, 2));

    await s3.putObject({
      Bucket: BUCKET_NAME,
      Key: 'backups/places.json',
      Body: JSON.stringify(cleaned, null, 2),
      ContentType: 'application/json',
      ACL: 'public-read'
    }).promise();

    console.log('💾 backups/places.json успешно обновлен в S3');
    return { success: true, beforeCount, currentCount: cleaned.length, removedCount };
  } catch (err) {
    console.error('❌ Ошибка синхронизации с S3:', err);
    return { success: false, error: err.message };
  }
}

// Эндпоинт ручного вызова синхронизации
app.get('/sync-places', async (req, res) => {
  const result = await syncPlacesWithS3();
  res.json(result);
});

app.post('/update-caption', async (req, res) => {
  try {
    const { id, photoIndex = 0, caption } = req.body;
    console.log('📥 Получен запрос на обновление подписи:', { id, photoIndex, caption });

    const fileData = await s3.getObject({
      Bucket: BUCKET_NAME,
      Key: 'backups/places.json'
    }).promise();

    const places = JSON.parse(fileData.Body.toString());

    // Находим по ID (уникальный и точный)
    const foundIndex = places.findIndex(p => p.id === id);

    if (foundIndex === -1) {
      console.warn('⚠️ Место не найдено для id:', id);
      return res.status(404).json({ success: false, error: 'Место не найдено' });
    }

    const found = places[foundIndex];

    // Обновляем подпись
    if (found.photos && Array.isArray(found.photos) && found.photos[photoIndex]) {
      found.photos[photoIndex].caption = caption;
    } else {
      found.caption = caption;
    }

    await s3.putObject({
      Bucket: BUCKET_NAME,
      Key: 'backups/places.json',
      Body: JSON.stringify(places, null, 2),
      ContentType: 'application/json'
    }).promise();

    console.log(`✅ Подпись сохранена у места id=${id}`);
    res.json({ success: true });
  } catch (err) {
    console.error('❌ Ошибка при обновлении подписи:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// --- Загрузка фото с логированием ---
app.post('/upload', (req, res) => {
  console.log('📥 /upload request received');
  console.log('Headers:', req.headers['content-type']);

  upload.any()(req, res, async (err) => {
    if (err instanceof multer.MulterError) {
      console.error('⚠️ MulterError:', err.code, err.message, err.stack);
      return res.status(500).json({ error: err.message, code: err.code });
    } else if (err) {
      console.error('⚠️ Unknown upload error:', err);
      return res.status(500).json({ error: 'Unknown upload error: ' + err.message });
    }

    console.log('--- req.files ---');
    console.log(req.files); // массив всех файлов
    console.log('--- req.body ---');
    console.log(req.body);  // все остальные поля

    // ищем файл с полем 'file'
    const exifDateFromClient = req.body.exifDate
    const file = req.files?.find(f => f.fieldname === 'file');
    if (!file) {
      console.warn('⚠️ Файл "file" не найден в запросе');
      return res.status(400).json({ error: 'Файл "file" не найден в запросе' });
    }

    try {
      const fileName = `memory-${Date.now()}.jpeg`;
      const filePath = `memories/${fileName}`;
      const id = Date.now().toString();
      let exifDate = null;
                try {
                  const exifData = await exifr.parse(file.buffer);
                  console.log('🔍 EXIF данные:', exifData);
                  
                  if (exifData && exifData.DateTimeOriginal) {
                    const date = new Date(exifData.DateTimeOriginal);
                    const day = date.getDate().toString().padStart(2, '0');
                    const month = (date.getMonth() + 1).toString().padStart(2, '0');
                    const year = date.getFullYear().toString().slice(-2);
                    exifDate = `${day}.${month}.${year}`;
                    console.log('✅ EXIF дата найдена:', exifDate);
                  } else {
                    // Если нет EXIF даты, используем текущую дату
                    const date = new Date();
                    const day = date.getDate().toString().padStart(2, '0');
                    const month = (date.getMonth() + 1).toString().padStart(2, '0');
                    const year = date.getFullYear().toString().slice(-2);
                    exifDate = `${day}.${month}.${year}`;
                    console.log('⚠️ EXIF дата не найдена, используем текущую:', exifDate);
                  }
                } catch (exifErr) {
                  // При ошибке тоже используем текущую дату
                  const date = new Date();
                  const day = date.getDate().toString().padStart(2, '0');
                  const month = (date.getMonth() + 1).toString().padStart(2, '0');
                  const year = date.getFullYear().toString().slice(-2);
                  exifDate = `${day}.${month}.${year}`;
                  console.log('❌ Ошибка EXIF, используем текущую дату:', exifDate);
                }
      try {
        const exifData = await exifr.parse(file.buffer);
        console.log('🔍 EXIF данные:', exifData);
        
        if (exifData && exifData.DateTimeOriginal) {
          const date = new Date(exifData.DateTimeOriginal);
          const day = date.getDate().toString().padStart(2, '0');
          const month = (date.getMonth() + 1).toString().padStart(2, '0');
          const year = date.getFullYear().toString().slice(-2);
          exifDate = `${day}.${month}.${year}`;
          console.log('✅ EXIF дата найдена:', exifDate);
        } else {
          // Если нет EXIF даты, используем текущую дату
          const date = new Date();
          const day = date.getDate().toString().padStart(2, '0');
          const month = (date.getMonth() + 1).toString().padStart(2, '0');
          const year = date.getFullYear().toString().slice(-2);
          exifDate = `${day}.${month}.${year}`;
          console.log('⚠️ EXIF дата не найдена, используем текущую:', exifDate);
        }
      } catch (exifErr) {
        // При ошибке тоже используем текущую дату
        const date = new Date();
        const day = date.getDate().toString().padStart(2, '0');
        const month = (date.getMonth() + 1).toString().padStart(2, '0');
        const year = date.getFullYear().toString().slice(-2);
        exifDate = `${day}.${month}.${year}`;
        console.log('❌ Ошибка EXIF, используем текущую дату:', exifDate);
      }

      await s3.upload({
        Bucket: BUCKET_NAME,
        Key: filePath,
        Body: file.buffer,
        ContentType: file.mimetype,
        ACL: 'public-read',
      }).promise();
      // Оптимизация изображений через Sharp (WebP)
      let origBuffer, thumbBuffer;
      let origFileName = `memory-${id}.webp`;
      let thumbFileName = `thumb-${id}.webp`;
      let origContentType = 'image/webp';
      let thumbContentType = 'image/webp';

      const fileUrl = `https://${BUCKET_NAME}.storage.yandexcloud.net/${filePath}`;
      console.log('✅ Файл загружен в S3:', fileUrl);
      try {
        [origBuffer, thumbBuffer] = await Promise.all([
          sharp(file.buffer)
            .rotate()
            .resize(1920, 1920, { fit: 'inside', withoutEnlargement: true })
            .webp({ quality: 82 })
            .toBuffer(),
          sharp(file.buffer)
            .rotate()
            .resize(320, 320, { fit: 'cover' })
            .webp({ quality: 80 })
            .toBuffer()
        ]);
        console.log(`🖼️ Sharp сжатие: ${(file.buffer.length / 1024).toFixed(1)}KB -> WebP ${(origBuffer.length / 1024).toFixed(1)}KB, Thumb ${(thumbBuffer.length / 1024).toFixed(1)}KB`);
      } catch (sharpErr) {
        console.warn('⚠️ Ошибка Sharp, используем исходный файл:', sharpErr.message);
        origBuffer = file.buffer;
        thumbBuffer = file.buffer;
        origFileName = `memory-${id}.jpeg`;
        thumbFileName = origFileName;
        origContentType = file.mimetype || 'image/jpeg';
        thumbContentType = origContentType;
      }

      const origPath = `memories/${origFileName}`;
      const thumbPath = `memories/thumbs/${thumbFileName}`;

      const uploadTasks = [
        s3.upload({
          Bucket: BUCKET_NAME,
          Key: origPath,
          Body: origBuffer,
          ContentType: origContentType,
          ACL: 'public-read',
        }).promise()
      ];

      if (thumbPath !== origPath) {
        uploadTasks.push(
          s3.upload({
            Bucket: BUCKET_NAME,
            Key: thumbPath,
            Body: thumbBuffer,
            ContentType: thumbContentType,
            ACL: 'public-read',
          }).promise()
        );
      }

      await Promise.all(uploadTasks);

      const origUrl = `https://${BUCKET_NAME}.storage.yandexcloud.net/${origPath}`;
      const thumbUrl = thumbPath === origPath ? origUrl : `https://${BUCKET_NAME}.storage.yandexcloud.net/${thumbPath}`;
      console.log('✅ Файлы загружены в S3:', { origUrl, thumbUrl });

      // сохраняем в places.json
      let places = [];
      try {
        const data = fs.existsSync(PLACES_FILE) ? fs.readFileSync(PLACES_FILE, 'utf8') : '[]';
        places = JSON.parse(data);
      } catch (readErr) {
        console.error('❌ Ошибка чтения places.json:', readErr);
        places = [];
      }

      const newPlace = {
        id,
        coords: req.body.coords ? JSON.parse(req.body.coords) : null,
        thumbUrl,
        origUrl,
        placeTitle: req.body.placeTitle || 'Новое место',
        timestamp: new Date().toISOString(),
        filename: origFileName,
        exifDate: exifDateFromClient || exifDate, 
      };

      places.push(newPlace);
      fs.writeFileSync(PLACES_FILE, JSON.stringify(places, null, 2));
      console.log('✅ Новое место добавлено в places.json');

      // бэкап в S3
      await s3.upload({
        Bucket: BUCKET_NAME,
        Key: 'backups/places.json',
        Body: JSON.stringify(places, null, 2),
        ContentType: 'application/json',
        ACL: 'public-read',
      }).promise();
      console.log('✅ places.json сохранён в S3 backup');

      res.json({ success: true, fileUrl: origUrl, thumbUrl });
    } catch (uploadErr) {
      console.error('❌ Ошибка обработки загрузки:', uploadErr);
      res.status(500).json({ error: uploadErr.message, stack: uploadErr.stack });
    }
  });
});

// --- Отправка приглашений с логированием ---
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
    console.log('📨 /send-invite request body:', req.body);

    const { city, place, date, timeStart, timeEnd, email } = req.body;
    if (!city || !place || !date || !timeStart || !timeEnd) {
      return res.status(400).json({ error: 'Необходимы поля: city, place, date, timeStart, timeEnd' });
    }

    const recipientEmails = [
      email?.trim() || process.env.TO_EMAIL,
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
        from_email: process.env.FROM_EMAIL,
        from_name: 'Sweet Dreams',
        body: { html: `<p>Скоро увидимся в <b>${city}</b>!<br>📍 ${place}<br>📅 ${date}<br>⏰ ${timeStart}–${timeEnd}</p>` },
        attachments: [{ type: 'text/calendar', name: 'invite.ics', content: Buffer.from(icsString).toString('base64') }]
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
      console.log('✅ Invite sent successfully');
      res.json({ success: true });
    } else {
      console.error('❌ UniSender error:', data);
      res.status(500).json({ error: data.error?.message || 'Ошибка UniSender', data });
    }
  } catch (err) {
    console.error('❌ /send-invite error:', err.stack || err);
    res.status(500).json({ error: 'Ошибка сервера: ' + err.message, stack: err.stack });
  }
});

function cleanPlacesJson() {
  try {
    const path = './places.json';
    if (!fs.existsSync(path)) return;

    const raw = fs.readFileSync(path, 'utf8');
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) return;

    const before = data.length;
    const cleaned = data.filter(p => p.origUrl || p.thumbUrl);
    if (cleaned.length !== before) {
      fs.writeFileSync(path, JSON.stringify(cleaned, null, 2));
      console.log(`🧹 Очищен places.json: удалено ${before - cleaned.length} пустых записей`);
    }
  } catch (err) {
    console.error('❌ Ошибка очистки places.json:', err);
  }
}

// вызываем после загрузки сервера
cleanPlacesJson();
// --- Запуск сервера ---
const PORT = process.env.PORT || 3000;
restorePlacesFromS3().then(() => {
  app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
});
