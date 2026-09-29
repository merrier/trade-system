import fs from "node:fs/promises";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), {
    name: "preserve-report-artifacts",
    async closeBundle() {
      try { await fs.cp("data/reports/morning", "dist-web/data/reports/morning", { recursive: true }); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    }
  }],
  base: "./",
  root: "web",
  build: {
    outDir: "../dist-web",
    emptyOutDir: true
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:8787"
    }
  }
});
