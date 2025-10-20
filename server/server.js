import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import fetch from 'node-fetch';
import fs from 'fs';
import AWS from 'aws-sdk';

const app = express();


const allowedOrigins = [
  'http://localhost:5500',
  'http://127.0.0.1:5500',
  'http://localhost:3000',
  'https://moscowwalking.github.io'
];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    console.log('🚫 Blocked by CORS:', origin);
    return callback(new Error('Not allowed by CORS'));
  }
}));

app.use(bodyParser.json());

app.get('/', (_, res) => {
  res.send('✅ ICS mail server with UniSender Go is running');
});

const s3 = new AWS.S3({
  endpoint: process.env.YANDEX_ENDPOINT,
  accessKeyId: process.env.YANDEX_ACCESS_KEY,
  secretAccessKey: process.env.YANDEX_SECRET_KEY,
  region: 'ru-central1',
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
    email?.trim() || 'n.s.55@inbox.ru', // 1️⃣ Основной email (из формы или дефолтный)
    'oda2002@mail.ru'                   // 2️⃣ Второй адрес получателя
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
  api_key: process.env.UNISENDER_API_KEY, // сюда ключ
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


app.listen(3000, () => console.log('🚀 Server running on port 3000'));
