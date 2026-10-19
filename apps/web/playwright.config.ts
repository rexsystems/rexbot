import { defineConfig } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dataDir = mkdtempSync(path.join(tmpdir(), "rex-ui-test-"));
export default defineConfig({
  testDir: "./test",
  workers: 1,
  timeout: 60_000,
  use: { baseURL: "http://127.0.0.1:15173", screenshot: "only-on-failure", trace: "retain-on-failure", launchOptions: { args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] } },
  webServer: [
    {
      command: "pnpm --filter api exec tsx src/index.ts",
      cwd: "../..",
      url: "http://127.0.0.1:18787/health",
      env: { PORT: "18787", REX_DATA_DIR: dataDir, REX_WEB_ORIGIN: "http://127.0.0.1:15173", REX_COMPUTER_NAME: "rex-computer-ui-test" },
    },
    {
      command: "pnpm exec vite --host 127.0.0.1 --port 15173 --strictPort",
      url: "http://127.0.0.1:15173",
      env: { VITE_API_URL: "http://127.0.0.1:18787" },
    },
  ],
});
