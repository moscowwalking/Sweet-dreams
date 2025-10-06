import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import fetch from 'node-fetch'; // важно для отправки запросов к API

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
    if (allowedOrigins.includes(origin)) return callback(null, true);
    console.log('Blocked by CORS:', origin);
    return callback(new Error('Not allowed by CORS'));
  }
}));

app.use(bodyParser.json());

app.get('/', (_, res) => {
  res.send('ICS mail server with UniSender is running ✅');
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

    const toEmail = (email || process.env.TO_EMAIL).split(',').map(addr => addr.trim());
    if (!toEmail.length) {
      return res.status(400).json({ error: 'Не указан email получателя' });
    }

    if (!city || !place || !date || !timeStart || !timeEnd) {
      return res.status(400).json({ error: 'Нужны поля city, place, date (YYYY-MM-DD), timeStart (HH:mm), timeEnd (HH:mm)' });
    }

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
SUMMARY:Встреча 💖
DESCRIPTION:Скоро увидимся! ${city}, ${place}.
LOCATION:${place}, ${city}
STATUS:CONFIRMED
SEQUENCE:0
TRANSP:OPAQUE
END:VEVENT
END:VCALENDAR`;

    // UniSender требует Base64-вложение
    const base64Ics = Buffer.from(icsString).toString('base64');

    const formData = new URLSearchParams();
    formData.append('api_key', process.env.UNISENDER_API_KEY);
    formData.append('email', toEmail.join(','));
    formData.append('sender_name', process.env.FROM_NAME || 'Sweet Dreams');
    formData.append('sender_email', process.env.FROM_EMAIL);
    formData.append('subject', 'Событие для календаря 💌');
    formData.append('body', `<p>Событие: ${city}, ${place}, ${date} с ${timeStart} до ${timeEnd}</p>`);
    formData.append('list_id', process.env.UNISENDER_LIST_ID || '');
    formData.append('attachments[0][type]', 'text/calendar');
    formData.append('attachments[0][name]', 'event.ics');
    formData.append('attachments[0][content]', base64Ics);

    const response = await fetch('https://api.unisender.com/ru/api/sendEmail?format=json', {
      method: 'POST',
      body: formData
    });

    const result = await response.json();
    console.log('UniSender response:', result);

    if (result.error) {
      throw new Error(result.error);
    }

    res.json({ success: true, result });
  } catch (e) {
    console.error('UniSender error:', e);
    res.status(500).json({ error: e.message || 'Ошибка отправки письма' });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Server started on http://localhost:${PORT}`));
