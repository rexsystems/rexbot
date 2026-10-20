import { Hono } from "hono";
import type { AppEnv } from "../auth.js";
import type { ChatRequestBody, SseEvent } from "@rex/shared";
import { prepareChatTurn } from "../chatTurn.js";

export { historyToLlm } from "../chatTurn.js";

export const chatRoutes = new Hono<AppEnv>();

function sse(event: SseEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

chatRoutes.post("/chat", async (c) => {
  let body: ChatRequestBody;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }
  const turn = await prepareChatTurn({
    userId: c.get("user").id,
    conversationId: body?.conversationId,
    respondTo: body?.respondTo,
    message: body?.message,
    uploadIds: body?.uploadIds,
    settings: body?.settings,
    timeZone: body?.timeZone,
  });
  if (!turn.ok) return c.json({ error: turn.error }, turn.status);

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        await turn.run((event) => controller.enqueue(encoder.encode(sse(event))));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
});
