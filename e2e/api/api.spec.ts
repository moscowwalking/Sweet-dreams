import { test, expect } from "@playwright/test";

// Базовый URL нашего бэкенда на Render
const SERVER_URL = "https://sweet-dreams-f8nc.onrender.com";

test.describe("Sweet Dreams — API & Security Checks 🛡️", () => {
  test("1. GET /health - сервер бодрствует и отдаёт 200 OK", async ({
    request,
  }) => {
    const response = await request.get(`${SERVER_URL}/health`);

    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body).toHaveProperty("status", "ok");
  });

  test("2. ALL /delete-place без API-ключа - блокирует запросы (403 Forbidden)", async ({
    request,
  }) => {
    const response = await request.post(
      `${SERVER_URL}/delete-place?id=test-id`,
    );

    // Проверяем, что замок сработал:
    expect(response.status()).toBe(403);
    const body = await response.json();
    expect(body.error).toContain("Доступ запрещён");
  });

  test("3. ALL /delete-place с НЕВЕРНЫМ ключом - блокирует доступ (403 Forbidden)", async ({
    request,
  }) => {
    const response = await request.post(
      `${SERVER_URL}/delete-place?id=test-id`,
      {
        headers: {
          "x-api-key": "fake-hacker-key-999",
        },
      },
    );

    expect(response.status()).toBe(403);
  });

  test("4. GET /places - публичный эндпоинт отдаёт список точек (200 OK)", async ({
    request,
  }) => {
    const response = await request.get(`${SERVER_URL}/places`);

    expect(response.status()).toBe(200);
    const places = await response.json();
    expect(Array.isArray(places)).toBeTruthy();
  });
});
