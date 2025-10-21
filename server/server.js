import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import fetch from 'node-fetch';
import fs from 'fs';
import AWS from 'aws-sdk';
import multer from 'multer';
import path from 'path';


const app = express();

const allowedOrigins = [
  'http://localhost:5500',
  'http://127.0.0.1:5500',
  'http://localhost:3000',
  'https://moscowwalking.github.io',
  'https://sweet-dreams-f8nc.onrender.com'
];

// Middleware для логирования запросов
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.url}`);
  next();
});

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    console.log('🚫 Blocked by CORS:', origin);
    return callback(new Error('Not allowed by CORS'));
  }
}));

app.use(bodyParser.json());
app.use(express.static('public'));

// Настройка multer для временного хранения файлов
const upload = multer({ 
  dest: '/tmp/uploads/',
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  }
});

// Создаем папку для временных файлов если её нет
if (!fs.existsSync('/tmp/uploads')) {
  fs.mkdirSync('/tmp/uploads', { recursive: true });
}

const s3 = new AWS.S3({
  endpoint: process.env.YANDEX_ENDPOINT,
  accessKeyId: process.env.YANDEX_ACCESS_KEY,
  secretAccessKey: process.env.YANDEX_SECRET_KEY,
  region: 'ru-central1',
});

import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Файл для хранения мест
const PLACES_FILE = path.join(__dirname, 'places.json');

// Поддерживаемые форматы изображений
const SUPPORTED_FORMATS = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/heif', 'image/heic'];

// Инициализация файла places.json если его нет
function initPlacesFile() {
  if (!fs.existsSync(PLACES_FILE)) {
    fs.writeFileSync(PLACES_FILE, JSON.stringify([]));
    console.log('✅ Created places.json');
  }
}

// Функция для получения названия места по координатам
function getPlaceName(coords) {
  const [lat, lon] = coords;
  // Простая логика - можно подключить геокодинг позже
  if (lat > 55.7 && lat < 55.8 && lon > 37.5 && lon < 37.7) {
    return 'Москва';
  }
  return 'Новое место';
}

// Функция для получения количества мест
function getPlacesCount() {
  try {
    if (fs.existsSync(PLACES_FILE)) {
      const data = fs.readFileSync(PLACES_FILE, 'utf8');
      const places = JSON.parse(data);
      return places.length;
    }
  } catch (error) {
    console.error('Error counting places:', error);
  }
  return 0;
}

// Функция для сохранения places.json в S3
async function backupPlacesToS3() {
  try {
    if (!fs.existsSync(PLACES_FILE)) {
      console.log('No places.json to backup');
      return;
    }
    
    const data = fs.readFileSync(PLACES_FILE);
    const s3Params = {
      Bucket: process.env.YANDEX_BUCKET,
      Key: 'backups/places.json',
      Body: data,
      ContentType: 'application/json',
      ACL: 'public-read',
    };
    
    await s3.upload(s3Params).promise();
    console.log('✅ places.json backed up to S3');
  } catch (error) {
    console.error('❌ Backup failed:', error);
  }
}

// Функция для восстановления places.json из S3
// Функция для восстановления places.json из S3
async function restorePlacesFromS3() {
  try {
    const s3Params = {
      Bucket: process.env.YANDEX_BUCKET,
      Key: 'backups/places.json',
    };

    console.log('🔄 Attempting to restore places from S3...');
    const data = await s3.getObject(s3Params).promise();

    if (data.Body) {
      fs.writeFileSync(PLACES_FILE, data.Body);
      const places = JSON.parse(data.Body);
      console.log(`✅ places.json restored from S3 with ${places.length} photos`);
    } else {
      throw new Error('Empty backup file');
    }
  } catch (error) {
    if (error.code === 'NoSuchKey') {
      console.log('📝 No backup found in S3.');
      // Проверяем, существует ли локальный файл
      if (fs.existsSync(PLACES_FILE)) {
        console.log('🔍 Local places.json exists. Attempting to delete...');
        try {
          fs.unlinkSync(PLACES_FILE); // Удаляем локальный файл
          console.log('🗑️ Local places.json deleted successfully.');
        } catch (unlinkErr) {
          console.error('❌ Failed to delete local places.json:', unlinkErr.message);
          // Даже если не удалось удалить, инициализируем пустой файл
          initPlacesFile();
          return;
        }
      } else {
        console.log('🔍 Local places.json does not exist, proceeding to init.');
      }
      initPlacesFile(); // Создаём новый пустой файл
      console.log('📄 Fresh empty places.json initialized.');
    } else {
      console.error('❌ Restore from S3 failed with error:', error.message);
      // Если восстановление из S3 не удалось по другой причине, всё равно убедимся, что файл существует
      if (!fs.existsSync(PLACES_FILE)) {
        console.log('🔄 Initializing places.json as it does not exist after error.');
        initPlacesFile();
      } else {
        console.log('⚠️ Keeping existing local places.json after S3 error.');
        
      }
    }
  }
}

// Эндпоинт для проверки здоровья сервера
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    placesCount: getPlacesCount()
  });
});

// Эндпоинт для получения мест
app.get('/places.json', (req, res) => {
  initPlacesFile();
  try {
    const data = fs.readFileSync(PLACES_FILE, 'utf8');
    
    // Добавляем проверку на пустой файл
    if (!data || data.trim() === '') {
      console.log('places.json is empty, returning empty array');
      return res.json([]);
    }
    
    const places = JSON.parse(data);
    console.log(`✅ Returning ${places.length} places from places.json`);
    res.json(places);
  } catch (error) {
    console.error('❌ Error reading places.json:', error);
    // Всегда возвращаем валидный JSON, даже при ошибке
    res.json([]);
  }
});

// Эндпоинт для загрузки фото (для карты воспоминаний)
app.post('/upload', upload.single('photo'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Файл не загружен' });
    }

    // определяем тип файла сразу
    let detectedMime = req.file.mimetype;

    console.log('📸 Received file:', {
      originalname: req.file.originalname,
      mimetype: detectedMime,
      size: req.file.size
    });

    // если пришёл неизвестный формат, пробуем определить по расширению
    if (detectedMime === 'application/octet-stream') {
      const ext = path.extname(req.file.originalname).toLowerCase();
      if (ext === '.heic' || ext === '.heif') detectedMime = 'image/heic';
      else if (ext === '.jpg' || ext === '.jpeg') detectedMime = 'image/jpeg';
      else if (ext === '.png') detectedMime = 'image/png';
      else if (ext === '.gif') detectedMime = 'image/gif';
      else if (ext === '.webp') detectedMime = 'image/webp';
    }

    // проверяем формат файла
    if (!SUPPORTED_FORMATS.includes(detectedMime)) {
      return res.status(400).json({ error: `Неподдерживаемый формат файла: ${detectedMime}` });
    }

    // получаем координаты из тела запроса
    let gps = null;
    if (req.body.gps) {
      try {
        gps = JSON.parse(req.body.gps);
        console.log('📍 GPS from request:', gps);
      } catch {
        console.log('⚠️ Invalid GPS data');
      }
    }

    // буфер и финальный тип
    let fileBuffer;
    let finalMimetype = detectedMime;

    // конвертируем HEIC/HEIF в JPEG
   if (detectedMime === 'image/heic' || detectedMime === 'image/heif') {
  console.log('⚠️ Skipping HEIC conversion, uploading original file');
  fileBuffer = fs.readFileSync(req.file.path);
  finalMimetype = 'image/heic';
}

    // имя файла и параметры для S3
    const fileExtension = finalMimetype.split('/')[1];
    const filename = `memory-${Date.now()}.${fileExtension}`;

    const s3Params = {
      Bucket: process.env.YANDEX_BUCKET,
      Key: filename,
      Body: fileBuffer,
      ContentType: finalMimetype,
      ACL: 'public-read',
    };

    const s3Upload = await s3.upload(s3Params).promise();
    console.log('✅ Photo uploaded to Yandex Cloud:', s3Upload.Location);

    const photo = {
      id: Date.now().toString(),
      coords: gps ? [gps.latitude, gps.longitude] : [55.75, 37.61],
      thumbUrl: s3Upload.Location,
      origUrl: s3Upload.Location,
      placeTitle: getPlaceName(photo.coords),
      timestamp: new Date().toISOString(),
      filename: filename,
      originalFilename: req.file.originalname
    };

    initPlacesFile();
    const places = JSON.parse(fs.readFileSync(PLACES_FILE, 'utf8'));
    places.push(photo);
    fs.writeFileSync(PLACES_FILE, JSON.stringify(places, null, 2));

    await backupPlacesToS3();
    fs.unlinkSync(req.file.path);

    res.json({ success: true, photo });

  } catch (error) {
    console.error('Upload error:', error);
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    res.status(500).json({ error: 'Ошибка загрузки файла: ' + error.message });
  }
});

// Эндпоинт для получения всех фото
app.get('/photos', (req, res) => {
  initPlacesFile();
  try {
    const data = fs.readFileSync(PLACES_FILE, 'utf8');
    res.json(JSON.parse(data));
  } catch (error) {
    res.json([]);
  }
});

// Статические файлы (если нужно)
app.use('/uploads', express.static('public/uploads'));

// Ваши существующие эндпоинты остаются без изменений
app.get('/', (_, res) => {
  res.send('✅ ICS mail server with UniSender Go is running');
});

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

    fs.writeFileSync('/tmp/invite.ics', icsString);

    const payload = {
      api_key: process.env.UNISENDER_API_KEY,
      message: {
        recipients: recipientEmails.map(address => ({
          email: address,
          substitutions: { to_name: "Друг" },
          metadata: { campaign_id: "test-invite" }
        })),
        subject: `💌 Встреча: ${city}, ${place}`,
        from_email: 'invite@sandbox-7833842-f4b715.unigosendbox.com', 
        from_name: 'Sweet Dreams',
        body: {
          html: `<p>Скоро увидимся в <b>${city}</b>!<br>📍 ${place}<br>📅 ${date}<br>⏰ ${timeStart}–${timeEnd}</p>`,
          plaintext: `Скоро увидимся в ${city}, ${place}, ${date}, ${timeStart}–${timeEnd}`
        },
        attachments: [
          {
            type: 'text/calendar',
            name: 'invite.ics',
            content: Buffer.from(icsString).toString('base64')
          }
        ]
      }
    };

    console.log('🚀 Отправляем письмо через UniSender...');
    const response = await fetch('https://go2.unisender.ru/ru/transactional/api/v1/email/send.json', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.UNISENDER_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();
    console.log('📨 Ответ UniSender:', data);

    if (response.ok && !data.error) {
      res.json({ success: true, message: 'Письмо успешно отправлено!', data });
    } else {
      res.status(500).json({ error: data.error?.message || 'Ошибка UniSender', details: data });
    }
  } catch (err) {
    console.error('🔥 Ошибка сервера:', err);
    res.status(500).json({ error: 'Ошибка сервера: ' + err.message });
  }
});

app.post('/upload-photo', async (req, res) => {
  try {
    const { imageBase64, filename } = req.body;

    if (!imageBase64 || !filename) {
      return res.status(400).json({ error: 'Необходимы поля: imageBase64, filename' });
    }

    const buffer = Buffer.from(imageBase64, 'base64');

    const params = {
      Bucket: process.env.YANDEX_BUCKET,
      Key: filename,
      Body: buffer,
      ContentType: 'image/jpeg',
      ACL: 'public-read',
    };

    const upload = await s3.upload(params).promise();
    console.log('✅ Фото загружено:', upload.Location);

    res.json({
      success: true,
      message: 'Фото успешно загружено!',
      url: upload.Location,
    });
  } catch (err) {
    console.error('🔥 Ошибка загрузки фото:', err);
    res.status(500).json({ error: 'Ошибка загрузки: ' + err.message });
  }
});

const PORT = process.env.PORT || 3000;
// Восстанавливаем данные из S3 при старте
restorePlacesFromS3().then(() => {
  app.listen(PORT, () => {
    console.log('🚀 Server running on port 3000');
    console.log('📸 Available endpoints:');
    console.log('   GET  /health - проверка здоровья сервера');
    console.log('   GET  /places.json - карта воспоминаний');
    console.log('   POST /upload - загрузка фото с GPS');
    console.log('   GET  /photos - все фото');
    console.log('   POST /send-invite - отправка приглашений');
    console.log('   POST /upload-photo - загрузка фото (base64)');
    console.log(`📍 Currently have ${getPlacesCount()} photos in database`);
  });
});