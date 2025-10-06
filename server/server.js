import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import fetch from 'node-fetch'; // обязательно для Render (иначе будет ошибка)
import fs from 'fs';
import path from 'path';

const app = express();
const PORT = process.env.PORT || 10000;

// --- Настройки CORS ---
app.use(cors({
  origin: [
    'http://localhost:5500',
    'http://127.0.0.1:5500',
    'http://localhost:3000',
    'https://moscowwalking.github.io',
    'https://moscowwalking.github.io/Sweet-dreams/',
    'https://sweet-dreams-f8nc.onrender.com'
  ],
}));

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// --- Основной маршрут отправки приглашения ---
app.post('/send-invite', async (req, res) => {
  try {
    console.log("📩 Получен запрос на /send-invite:");
    console.log(req.body);

    let { email, city, place, date, timeStart, timeEnd } = req.body;

    // ✅ Подставляем тестовую почту, если email не пришёл
    if (!email) {
      console.warn("⚠️ Email не передан — используется тестовый адрес UniSender.");
      email = "invite@sandbox-7833842-f4b715.unigosendbox.com";
    }

    // Проверка обязательных полей
    if (!city || !place || !date || !timeStart || !timeEnd) {
      console.error("❌ Необходимы поля не заполнены:", req.body);
      return res.status(400).json({ error: "Необходимы поля: email, city, place, date, timeStart, timeEnd" });
    }

    // --- Создание файла .ics ---
    const icsContent = `
BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Sweet Dreams//EN
BEGIN:VEVENT
UID:${Date.now()}@sweetdreams
DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').split('.')[0]}Z
DTSTART:${date.replace(/-/g, '')}T${timeStart.replace(':', '')}00Z
DTEND:${date.replace(/-/g, '')}T${timeEnd.replace(':', '')}00Z
SUMMARY:Встреча в ${place}
LOCATION:${city}
DESCRIPTION:Не забудь! ${place} ${date} в ${timeStart}
END:VEVENT
END:VCALENDAR
`;

    const filePath = path.resolve('invite.ics');
    fs.writeFileSync(filePath, icsContent);
    console.log("📎 Файл invite.ics создан успешно");

    // --- Отправка через UniSender API ---
    const apiKey = process.env.UNISENDER_API_KEY;
    const apiUrl = 'https://go2.unisender.ru/ru/api/sendEmail?format=json';

    console.log("🚀 Отправляем письмо через UniSender...");
    const formData = new URLSearchParams();
    formData.append('api_key', apiKey);
    formData.append('email', email);
    formData.append('sender_name', 'Sweet Dreams');
    formData.append('sender_email', email);
    formData.append('subject', '🌙 Sweet Dreams: встреча');
    formData.append('body', `
      <h3>Привет!</h3>
      <p>Скоро увидимся ❤️</p>
      <p><b>${place}</b> — ${date} в ${timeStart}</p>
      <p>Не забудь добавить встречу в календарь!</p>
    `);

    const response = await fetch(apiUrl, {
      method: 'POST',
      body: formData,
    });

    const result = await response.json();
    console.log("📬 Ответ UniSender:", result);

    if (result.error) {
      console.error("❌ UniSender error:", result);
      return res.status(500).json({ error: result.error });
    }

    res.status(200).json({ message: 'Письмо успешно отправлено!' });
  } catch (err) {
    console.error("💥 Ошибка при отправке:", err);
    res.status(500).json({ error: 'Ошибка сервера', details: err.message });
  }
});

// --- Запуск сервера ---
app.listen(PORT, () => {
  console.log(`🚀 Сервер запущен на порту ${PORT}`);
});
