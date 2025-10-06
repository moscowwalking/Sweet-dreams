import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import fetch from 'node-fetch'; // убедись, что установлен: npm install node-fetch@3

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
  res.send('ICS mail server with UniSender Go is running ✅');
});

// Форматирование даты для ICS
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

    if (!email || !city || !place || !date || !timeStart || !timeEnd) {
      return res.status(400).json({ error: 'Необходимы поля: email, city, place, date, timeStart, timeEnd' });
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

    // Формируем тело запроса для UniSender Go
    const payload = {
      api_key: process.env.UNISENDER_API_KEY,
      message: {
        recipients: [
          { email: email.trim() }
        ],
        subject: `Встреча 💌: ${city}, ${place}`,
        from_email: process.env.FROM_EMAIL,
        body: {
          html: `<p>Событие: ${city}, ${place}, ${date} с ${timeStart} до ${timeEnd}</p>`,
          plaintext: `Событие: ${city}, ${place}, ${date} с ${timeStart} до ${timeEnd}`
        },
        attachments: [
          {
            type: 'text/calendar',
            name: 'event.ics',
            content: Buffer.from(icsString).toString('base64')
          }
        ]
      }
    };

    const response = await fetch('https://go2.unisender.ru/ru/transactional/api/v1/email/send.json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await response.json();
    console.log('UniSender response:', data);

    if (response.ok && !data.error) {
      return res.json({ success: true });
    } else {
      console.error('UniSender error:', data);
      return res.status(500).json({ error: data.error || 'Ошибка UniSender' });
    }

  } catch (err) {
    console.error('Server error:', err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Server started on http://localhost:${PORT}`));
