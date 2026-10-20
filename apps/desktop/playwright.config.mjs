import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./test",
  use: { baseURL: "http://127.0.0.1:1420", screenshot: "only-on-failure" },
  webServer: { command: "pnpm dev", url: "http://127.0.0.1:1420" },
});
