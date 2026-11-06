import { defineConfig } from "@playwright/test";
import { existsSync } from "node:fs";

export default defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  use: {
    browserName: "chromium",
    headless: true,
    launchOptions: existsSync("/usr/bin/chromium") ? { executablePath: "/usr/bin/chromium", args: ["--no-sandbox"] } : {},
    viewport: { width: 1440, height: 900 },
    baseURL: "http://127.0.0.1:3000",
  },
  webServer: { command: "npm run dev", url: "http://127.0.0.1:3000", reuseExistingServer: !process.env.CI },
});
