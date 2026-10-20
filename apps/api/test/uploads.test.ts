import { test } from "node:test";
import { asUser, TEST_USER } from "./helpers.js";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DEFAULT_SETTINGS } from "@rex/shared";

function pdfFixture() {
  const stream = "BT /F1 12 Tf 72 720 Td (PDF package upgrade verified) Tj ET";
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>", `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];
  let text = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) { offsets.push(Buffer.byteLength(text)); text += `${index + 1} 0 obj\n${object}\nendobj\n`; }
  const start = Buffer.byteLength(text);
  text += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;
  return Buffer.from(text);
}

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
    const pdf = await (await upload("fixture.pdf", "application/pdf", pdfFixture())).json() as { id: string };
    const { runTool } = await import("../src/tools/index.js");
    const extracted = await runTool("read_upload", JSON.stringify({ upload_id: pdf.id }), DEFAULT_SETTINGS, { userMessageId: "fixture", ownerId: TEST_USER.id });
    assert.match(extracted, /PDF package upgrade verified/);
    assert.equal((await asUser(uploadRoutes).request(`/uploads/${image.id}`, { method: "DELETE" })).status, 200);
    assert.equal((await asUser(uploadRoutes).request(`/uploads/${image.id}/content`)).status, 404);
    assert.equal((await asUser(uploadRoutes).request("/uploads/unknown/content")).status, 404);
    const { chatRoutes } = await import("../src/routes/chat.js");
    const invalid = await asUser(chatRoutes).request("/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: "", uploadIds: ["missing"], settings: { llmApiKey: "test-only-key" } }) });
    assert.equal(invalid.status, 400);
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM messages").get() as { count: number }).count, 0);
  } finally { db.close(); rmSync(directory, { recursive: true, force: true }); }
});
