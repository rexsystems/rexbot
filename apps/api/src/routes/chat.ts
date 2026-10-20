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
  // Decouple the turn from the HTTP stream so a reload/tab close does not kill work.
  let forward: ((event: SseEvent) => void) | null = null;
  const buffered: SseEvent[] = [];
  const turnDone = turn.run((event) => {
    if (forward) forward(event);
    else buffered.push(event);
  });
  void turnDone.catch(() => undefined);

  const stream = new ReadableStream({
    start(controller) {
      const push = (event: SseEvent) => {
        try {
          controller.enqueue(encoder.encode(sse(event)));
        } catch {
          forward = null;
        }
      };
      forward = push;
      for (const event of buffered.splice(0)) push(event);
      void turnDone.finally(() => {
        forward = null;
        try {
          controller.close();
        } catch {
          /* client already gone */
        }
      });
    },
    cancel() {
      forward = null;
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
