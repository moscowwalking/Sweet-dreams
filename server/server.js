import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import nodemailer from 'nodemailer';
import bodyParser from 'body-parser';

const app = express();

app.use(cors({
  origin: [
    'http://localhost:5500',
    'http://127.0.0.1:5500',
    'http://localhost:3000',
    'https://moscowwalking.github.io/Sweet-dreams/',
    'https://sweet-dreams-rh2g.onrender.com'
  ]
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

app.post('/send-invite', async (req, res) => {
  try {
    const { city, place, date, time, email } = req.body;

    const toEmail = (email || process.env.TO_EMAIL).split(',').map(addr => addr.trim());
    if (!toEmail) {
      return res.status(400).json({ error: 'Не указан email получателя' });
    }

    if (!city || !place || !date || !time) {
      return res.status(400).json({ error: 'Нужны поля city, place, date (YYYY-MM-DD) и time (HH:mm)' });
    }

    // Разбираем дату/время
    const [year, month, day] = date.split('-').map(Number);
    const [hour, minute] = time.split(':').map(Number);

    // Начало и конец (2 часа)
    const start = new Date(year, month - 1, day, hour, minute);
    const end = new Date(start.getTime() + 2 * 60 * 60 * 1000);

    // Функция форматирования даты в формат iCal
    function formatDate(d) {
      return d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
    }

    // Формируем .ics вручную
    const icsString = `BEGIN:VCALENDAR
VERSION:2.0
CALSCALE:GREGORIAN
METHOD:PUBLISH
BEGIN:VEVENT
UID:${Date.now()}@sweet-dreams
DTSTAMP:${formatDate(new Date())}
DTSTART:${formatDate(start)}
DTEND:${formatDate(end)}
SUMMARY:Встреча 💖
DESCRIPTION:Скоро увидимся! ${city}, ${place}.
LOCATION:${place}, ${city}
STATUS:CONFIRMED
SEQUENCE:0
END:VEVENT
END:VCALENDAR`;

    const mailOptions = {
      from: process.env.MAIL_USER,
      to: toEmail,
      subject: 'Событие для календаря 💌',
      text: `Событие: ${city}, ${place}, ${date} в ${time}`,
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
