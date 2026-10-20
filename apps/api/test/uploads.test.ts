import { test } from "node:test";
import { asUser, TEST_USER } from "./helpers.js";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

test("attachments serve raster previews, keep active formats as downloads, and clean up removed drafts", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "rex-upload-test-"));
  process.env.REX_DATA_DIR = directory;
  const { db } = await import("../src/db.js");
  try {
    const { uploadRoutes } = await import("../src/routes/uploads.js");
    const upload = (name: string, type: string, data: Uint8Array | string) => {
      const body = new FormData(); body.append("file", new Blob([data], { type }), name);
      return asUser(uploadRoutes).request("/uploads", { method: "POST", body });
    };
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6l8AAAAASUVORK5CYII=", "base64");
    const saved = await upload("photo.png", "image/png", png);
    assert.equal(saved.status, 200);
    const image = await saved.json() as { id: string; mimeType: string };
    assert.equal(image.mimeType, "image/png");
    const content = await asUser(uploadRoutes).request(`/uploads/${image.id}/content`);
    assert.equal(content.headers.get("content-type"), "image/png");
    assert.equal(content.headers.get("x-content-type-options"), "nosniff");
    assert.match(content.headers.get("content-disposition")!, /^inline;/);
    assert.deepEqual(Buffer.from(await content.arrayBuffer()), png);
    assert.equal((await upload("bad.png", "image/png", "<script>bad</script>")).status, 400);
    const vector = await (await upload("picture.svg", "image/svg+xml", '<svg xmlns="http://www.w3.org/2000/svg"/>')).json() as { id: string };
    const vectorContent = await asUser(uploadRoutes).request(`/uploads/${vector.id}/content`);
    assert.equal(vectorContent.headers.get("content-type"), "application/octet-stream");
    assert.match(vectorContent.headers.get("content-disposition")!, /^attachment;/);
    assert.equal((await asUser(uploadRoutes).request(`/uploads/${image.id}`, { method: "DELETE" })).status, 200);
    assert.equal((await asUser(uploadRoutes).request(`/uploads/${image.id}/content`)).status, 404);
    assert.equal((await asUser(uploadRoutes).request("/uploads/unknown/content")).status, 404);
    const { chatRoutes } = await import("../src/routes/chat.js");
    const invalid = await asUser(chatRoutes).request("/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: "", uploadIds: ["missing"], settings: { llmApiKey: "test-only-key" } }) });
    assert.equal(invalid.status, 400);
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM messages").get() as { count: number }).count, 0);
  } finally { db.close(); rmSync(directory, { recursive: true, force: true }); }
});
