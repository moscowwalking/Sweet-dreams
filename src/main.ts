import { MemoriesApp } from "./MemoriesApp";

window.addEventListener("DOMContentLoaded", () => {
  const app = new MemoriesApp();
  app.start().catch((err) => {
    console.error("Failed to start MemoriesApp:", err);
  });
});
