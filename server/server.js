import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import fetch from 'node-fetch';
import fs from 'fs';

const app = express();

// ✅ Разрешённые источники для CORS
const allowedOrigins = [
  'http://localhost:5500',
  'http://127.0.0.1:5500',
  'http://localhost:3000',
  'https://moscowwalking.github.io'
];

app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    console.log('🚫 Blocked by CORS:', origin);
    return callback(new Error('Not allowed by CORS'));
  }
}));

app.use(bodyParser.json());

app.get('/', (_, res) => {
  res.send('✅ ICS mail server with UniSender Go is running');
});

// Функция форматирования даты для ICS
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
    console.log('📩 Получен запрос на /send-invite:');
    console.log(req.body);

    const { city, place, date, timeStart, timeEnd, email } = req.body;

    // Если email не передан — используем тестовый UniSender-адрес
    const recipientEmail = email?.trim() || 'test@unisender.com';
    if (!email) {
      console.log('⚠️ Email не передан — используется тестовый адрес UniSender.');
    }

    if (!city || !place || !date || !timeStart || !timeEnd) {
      return res.status(400).json({ error: 'Необходимы поля: city, place, date, timeStart, timeEnd' });
    }

    // Создаём дату события
    const [year, month, day] = date.split('-').map(Number);
    const [startHour, startMinute] = timeStart.split(':').map(Number);
    const [endHour, endMinute] = timeEnd.split(':').map(Number);

    const start = new Date(year, month - 1, day, startHour, startMinute);
    const end = new Date(year, month - 1, day, endHour, endMinute);

    // Формируем ICS-файл
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

    // Сохраняем временно файл для логов (опционально)
    fs.writeFileSync('/tmp/invite.ics', icsString);
    console.log('📎 Файл invite.ics создан успешно');

    // Формируем тело запроса UniSender Go
    const payload = {
      api_key: process.env.UNISENDER_API_KEY,
      email: {
        from_email: process.env.FROM_EMAIL,
        to_email: recipientEmail,
        subject: `💌 Встреча: ${city}, ${place}`,
        body: {
          html: `<p>Событие: <b>${city}</b>, ${place}, ${date} с ${timeStart} до ${timeEnd}</p>`,
          plaintext: `Событие: ${city}, ${place}, ${date} с ${timeStart} до ${timeEnd}`
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
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    let data;
    try {
      data = await response.json();
    } catch (err) {
      const text = await response.text();
      console.error('❌ UniSender не вернул JSON. Ответ:', text);
      return res.status(500).json({ error: 'Ошибка формата ответа UniSender' });
    }

    console.log('📨 UniSender ответ:', data);

    if (response.ok && !data.error) {
      console.log('✅ Письмо успешно отправлено.');
      return res.json({ success: true });
    } else {
      console.error('💥 UniSender error:', data);
      return res.status(500).json({ error: data.error || 'Ошибка UniSender' });
    }

  } catch (err) {
    console.error('🔥 Server error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Порт для Render
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`✅ Server started on port ${PORT}`));
