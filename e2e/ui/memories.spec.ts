import { test, expect } from "@playwright/test";

const BASE_URL = "https://moscowwalking.github.io/Sweet-dreams";

test.describe("Sweet Dreams — UI Tests (Memories Map) 🗺️", () => {
  test("1. Страница воспоминаний загружается, заголовок и карта отображаются", async ({
    page,
  }) => {
    await page.goto(`${BASE_URL}/memories.html`);

    // Проверяем заголовок вкладки в браузере
    await expect(page).toHaveTitle(/Memories — Карта воспоминаний/);

    // Проверяем видимость интерактивной карты Leaflet
    const map = page.locator("#map");
    await expect(map).toBeVisible();

    // Проверяем счетчик любви (дней вместе)
    const loveCounter = page.locator("#loveCounter");
    await expect(loveCounter).toBeVisible();
  });

  test("2. Кнопка 'Загрузить фото' и кнопка 'Назад' присутствуют на странице", async ({
    page,
  }) => {
    await page.goto(`${BASE_URL}/memories.html`);

    // Кнопка перехода назад на главную
    const backBtn = page.locator(".nav-button");
    await expect(backBtn).toBeVisible();
    await expect(backBtn).toHaveText(/Назад/);

    // Кнопка загрузки воспоминаний
    const uploadBtn = page.locator(".upload-btn");
    await expect(uploadBtn).toBeVisible();
  });
});
