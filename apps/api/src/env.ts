import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Loads the repository .env without overriding variables already exported in the shell.
const envFile = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../.env");
if (process.env.REX_SKIP_ENV_FILE !== "1" && fs.existsSync(envFile)) process.loadEnvFile(envFile);
