import { defineConfig } from "vite";

export default defineConfig({
  // Set BASE_PATH=/autonomi-download-viz/ when deploying under a sub-path (GitHub Pages).
  base: process.env.BASE_PATH ?? "/",
  build: { target: "es2022" },
  // Keep the SDK out of dep pre-bundling so its `new URL(..., import.meta.url)` WASM path resolves in dev.
  optimizeDeps: { exclude: ["@withautonomi/ant-browser-sdk"] },
});
