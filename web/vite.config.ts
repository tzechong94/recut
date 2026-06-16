/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
// shared/ lives one level up from web/ — allow Vite to serve it.
const repoRoot = resolve(__dirname, "..");

export default defineConfig({
  plugins: [react()],
  server: {
    fs: {
      // permit importing ../shared/caption-style.json (outside web/)
      allow: [repoRoot],
    },
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    css: false,
  },
});
