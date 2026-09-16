import express from "express";
import { sendMeetingInvite } from "../services/inviteService.js";

const router = express.Router();

/**
 * POST /send-invite - Отправка приглашения в календарь через UniSender
 */
router.post("/send-invite", async (req, res) => {
  try {
    const { city, place, date, timeStart, timeEnd, email } = req.body;

    if (!city || !place || !date || !timeStart || !timeEnd) {
      return res.status(400).json({
        error: "Необходимы поля: city, place, date, timeStart, timeEnd",
      });
    }

    await sendMeetingInvite({ city, place, date, timeStart, timeEnd, email });
    console.log("✅ Invite sent successfully");
    res.json({ success: true });
  } catch (err) {
    console.error("❌ /send-invite error:", err.message);
    res.status(500).json({ error: "Ошибка отправки приглашения: " + err.message });
  }
});

export default router;
