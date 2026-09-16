import { ENV } from "../config/env.js";

function formatDateLocal(d) {
  const pad = (n) => (n < 10 ? "0" + n : n);
  return (
    d.getFullYear().toString() +
    pad(d.getMonth() + 1) +
    pad(d.getDate()) +
    "T" +
    pad(d.getHours()) +
    pad(d.getMinutes()) +
    pad(d.getSeconds())
  );
}

export function generateIcsString({ city, place, date, timeStart, timeEnd }) {
  const [year, month, day] = date.split("-").map(Number);
  const [startHour, startMinute] = timeStart.split(":").map(Number);
  const [endHour, endMinute] = timeEnd.split(":").map(Number);

  const start = new Date(year, month - 1, day, startHour, startMinute);
  const end = new Date(year, month - 1, day, endHour, endMinute);

  return `BEGIN:VCALENDAR
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
}

export async function sendMeetingInvite({ city, place, date, timeStart, timeEnd, email }) {
  const recipientEmails = [
    email?.trim() || ENV.TO_EMAIL,
    ENV.ADMIN_EMAIL, // по умолчанию "oda2002@mail.ru", либо из .env / Render
  ].filter(Boolean);

  const icsString = generateIcsString({ city, place, date, timeStart, timeEnd });

  const payload = {
    api_key: ENV.UNISENDER_API_KEY,
    message: {
      recipients: recipientEmails.map((e) => ({ email: e })),
      subject: `💌 Встреча: ${city}, ${place}`,
      from_email: ENV.FROM_EMAIL,
      from_name: "Sweet Dreams",
      body: {
        html: `<p>Скоро увидимся в <b>${city}</b>!<br>📍 ${place}<br>📅 ${date}<br>⏰ ${timeStart}–${timeEnd}</p>`,
      },
      attachments: [
        {
          type: "text/calendar",
          name: "invite.ics",
          content: Buffer.from(icsString).toString("base64"),
        },
      ],
    },
  };

  const response = await fetch(
    "https://go2.unisender.ru/ru/transactional/api/v1/email/send.json",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ENV.UNISENDER_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    },
  );

  const data = await response.json();
  if (!response.ok || data.error) {
    throw new Error(data.error?.message || "Ошибка сервиса UniSender");
  }

  return data;
}
