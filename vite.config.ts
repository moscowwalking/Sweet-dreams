import { defineConfig } from "vite";
import { resolve } from "path";

export default defineConfig({
  build: {
    outDir: "dist",
    emptyOutDir: false,
    rollupOptions: {
      input: resolve(__dirname, "src/main.ts"),
      output: {
        entryFileNames: "memories.bundle.js",
        format: "es",
      },
    },
  },
  server: {
    port: 5173,
    open: false,
  },
});
