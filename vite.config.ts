import { defineConfig } from "vite";
import { resolve } from "path";

export default defineConfig({
  root: ".",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: resolve(__dirname, "index.html"),
        memoriesDev: resolve(__dirname, "memories-dev.html"),
      },
    },
  },
  server: {
    port: 5173,
    open: false,
  },
});
