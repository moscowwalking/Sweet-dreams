import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import nodemailer from 'nodemailer';
import bodyParser from 'body-parser';

const app = express();

const allowedOrigins = [
  'http://localhost:5500',
  'http://127.0.0.1:5500',
  'http://localhost:3000',
  'https://moscowwalking.github.io'
];

app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    } else {
      console.log('Blocked by CORS:', origin);
      return callback(new Error('Not allowed by CORS'));
    }
  }
}));

app.use(bodyParser.json());

// Настройка почты для Mail.ru
const transporter = nodemailer.createTransport({
  host: 'smtp.mail.ru',
  port: 465,
  secure: true,
  auth: {
    user: process.env.MAIL_USER,
    pass: process.env.MAIL_PASS
  }
});

app.get('/', (_, res) => {
  res.send('ICS mail server is running ✅');
});

// Форматирование даты в локальном времени (Europe/Moscow)
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

    const toEmail = (email || process.env.TO_EMAIL).split(',').map(addr => addr.trim());
    if (!toEmail) {
      return res.status(400).json({ error: 'Не указан email получателя' });
    }

    if (!city || !place || !date || !timeStart || !timeEnd) {
      return res.status(400).json({ error: 'Нужны поля city, place, date (YYYY-MM-DD), timeStart (HH:mm) и timeEnd (HH:mm)' });
    }

    // Разбираем дату/время
    const [year, month, day] = date.split('-').map(Number);
    const [startHour, startMinute] = timeStart.split(':').map(Number);
    const [endHour, endMinute] = timeEnd.split(':').map(Number);

    // Начало и конец (2 часа)
    const start = new Date(year, month - 1, day, startHour, startMinute);
    const end = new Date(year, month - 1, day, endHour, endMinute);

    // Формируем .ics вручную
    const icsString = `BEGIN:VCALENDAR
      VERSION:2.0
      CALSCALE:GREGORIAN
      METHOD:REQUEST
      BEGIN:VEVENT
      UID:${Date.now()}@sweet-dreams
      DTSTAMP:${formatDateLocal(new Date())}
      DTSTART;TZID=Europe/Moscow:${formatDateLocal(start)}
      DTEND;TZID=Europe/Moscow:${formatDateLocal(end)}
      SUMMARY:Встреча 💖
      DESCRIPTION:Скоро увидимся! ${city}, ${place}.
      LOCATION:${place}, ${city}
      STATUS:CONFIRMED
      SEQUENCE:0
      TRANSP:OPAQUE
      END:VEVENT
      END:VCALENDAR`;

    const mailOptions = {
      from: process.env.MAIL_USER,
      to: toEmail,
      subject: 'Событие для календаря 💌',
      text: `Событие: ${city}, ${place}, ${date} с ${timeStart} до ${timeEnd}`,
      html: `<p>Событие: ${city}, ${place}, ${date} с ${timeStart} до ${timeEnd}</p>`,

      attachments: [
        {
          filename: 'event.ics',
          content: icsString,
          contentType: 'text/calendar; charset=UTF-8; method=PUBLISH'
        }
      ]
    };

    try {
      const info = await transporter.sendMail(mailOptions);
      console.log('Email sent:', info.response);
      return res.json({ success: true });
    } catch (e) {
      console.error('Mail error:', e);
      return res.status(500).json({ error: 'Ошибка отправки письма' });
    }
  } catch (e) {
    console.error('Server error:', e);
    return res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Server started on http://localhost:${PORT}`));
