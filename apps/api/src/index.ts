import "./env.js";
import { serve } from "@hono/node-server";
import type { Server } from "node:http";
import { allowedOrigins, app } from "./app.js";
import { computers } from "./computer.js";
import { attachVncProxy } from "./computer/vncProxy.js";
import { startRoutineScheduler } from "./routines.js";

const port = Number(process.env.PORT || 8787);
const hostname = process.env.REX_HOST?.trim() || "127.0.0.1";
console.log(`Rex API listening on http://${hostname === "0.0.0.0" ? "localhost" : hostname}:${port}`);
const server = serve({ fetch: app.fetch, port, hostname });
attachVncProxy(server as Server, (token) => computers.resolveView(token), () => allowedOrigins);
computers.startIdleWatch();
startRoutineScheduler();
