import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { request } from "node:http";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { createTestServer, root } from "../scripts/test-server.mjs";
import { createServer as createViteServer } from "vite";

let server;
before(async () => { server = await createTestServer(); });
after(async () => { await server?.dispose(); });
const progressPath = "/api/extension/progress?handle=apitest";

test("local app, Vite and extension origins work without wildcard CORS", async () => {
  for (const origin of [server.url, "http://127.0.0.1:5174", `chrome-extension://${"a".repeat(32)}`]) {
    const response = await fetch(server.url + progressPath, { headers: { Origin: origin } });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("access-control-allow-origin"), origin);
    assert.equal(response.headers.get("vary"), "Origin");
  }
});

test("untrusted and opaque origins cannot read or write the local bridge", async () => {
  for (const origin of ["https://example.com", "null", "http://localhost.evil.test:5173", "http://127.0.0.1:9999", "chrome-extension://bad-id"]) {
    const response = await fetch(server.url + progressPath, { headers: { Origin: origin } });
    assert.equal(response.status, 403);
    assert.equal(response.headers.get("access-control-allow-origin"), null);
    const write = await fetch(server.url + "/api/extension/progress", { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify({ handle: "apitest", state: "running" }) });
    assert.equal(write.status, 403);
  }
});

test("spoofed Host and cross-site no-cors requests are rejected", async () => {
  const status = await new Promise((resolve, reject) => {
    const req = request(server.url + progressPath, { headers: { Host: "evil.example:5173" } }, (response) => { response.resume(); resolve(response.statusCode); });
    req.on("error", reject); req.end();
  });
  assert.equal(status, 403);
  const response = await fetch(server.url + progressPath, { headers: { "Sec-Fetch-Site": "cross-site" } });
  assert.equal(response.status, 403);
});

test("preflight only permits supported methods and headers", async () => {
  const allowed = await fetch(server.url + "/api/extension/progress", { method: "OPTIONS", headers: { Origin: server.url, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type,x-tastetwin-request" } });
  assert.equal(allowed.status, 204);
  assert.match(allowed.headers.get("access-control-allow-methods"), /POST/);
  const denied = await fetch(server.url + progressPath, { method: "OPTIONS", headers: { Origin: server.url, "Access-Control-Request-Method": "PATCH" } });
  assert.equal(denied.status, 403);
});

test("JSON writes reject form data, malformed input, null and arrays", async () => {
  const endpoint = server.url + "/api/extension/progress";
  assert.equal((await fetch(endpoint, { method: "POST", body: '{}' })).status, 415);
  for (const body of ["{", "null", "[]"]) {
    const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body });
    assert.equal(response.status, 400);
  }
  const large = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ padding: "x".repeat(4 * 1024 * 1024) }) });
  assert.equal(large.status, 413);
  assert.equal((await fetch(server.url + progressPath)).status, 200);
});

test("unknown API endpoints return JSON errors instead of the HTML application", async () => {
  const response = await fetch(server.url + "/api/missing");
  assert.equal(response.status, 404);
  assert.equal((await response.json()).error, "unknown_endpoint");
});

test("Vite development server forwards API requests to the local backend", async () => {
  const previous = process.env.TASTETWIN_API_URL;
  process.env.TASTETWIN_API_URL = server.url;
  let vite;
  try {
    vite = await createViteServer({ server: { port: 0, strictPort: false, host: "127.0.0.1" }, logLevel: "error" });
    await vite.listen();
    const response = await fetch(`http://127.0.0.1:${vite.httpServer.address().port}${progressPath}`, { headers: { Origin: "http://127.0.0.1:5174" } });
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type"), /application\/json/);
    assert.equal(response.headers.get("access-control-allow-origin"), "http://127.0.0.1:5174");
  } finally {
    await vite?.close();
    if (previous === undefined) delete process.env.TASTETWIN_API_URL;
    else process.env.TASTETWIN_API_URL = previous;
  }
});

test("cloud backup folder receives app backups and serves the latest one back", async () => {
  const folder = await mkdtemp(path.join(root, ".codex-artifacts", "cloud-"));
  const app = { "Content-Type": "application/json", "X-TasteTwin-Request": "app" };
  try {
    const extension = { ...app, Origin: `chrome-extension://${"a".repeat(32)}` };
    assert.equal((await fetch(server.url + "/api/system/cloud-backup", { headers: extension })).status, 403);
    assert.equal((await fetch(server.url + "/api/system/cloud-backup")).status, 403, "the app header is required");
    const relative = await fetch(server.url + "/api/system/cloud-backup/config", { method: "POST", headers: app, body: JSON.stringify({ folder: "relative/dir" }) });
    assert.equal(relative.status, 400);
    assert.equal((await fetch(server.url + "/api/system/cloud-backup", { method: "POST", headers: app, body: "{}" })).status, 409);

    const configured = await fetch(server.url + "/api/system/cloud-backup/config", { method: "POST", headers: app, body: JSON.stringify({ folder }) });
    assert.equal(configured.status, 200);
    assert.equal((await configured.json()).folder, path.resolve(folder));
    assert.equal((await fetch(server.url + "/api/system/cloud-backup", { method: "POST", headers: app, body: JSON.stringify({ format: "other" }) })).status, 400);

    const backup = { format: "tastetwin-backup", schemaVersion: 1, state: { users: [], socialByHandle: {} }, padding: "x".repeat(5 * 1024 * 1024) };
    const written = await fetch(server.url + "/api/system/cloud-backup", { method: "POST", headers: app, body: JSON.stringify(backup) });
    assert.equal(written.status, 200, "backups above the 4 MB bridge limit are accepted");
    const files = await readdir(path.join(folder, "TasteTwin"));
    assert.ok(files.includes("tastetwin-latest.json"));
    assert.ok(files.some((name) => /^tastetwin-\d{4}-\d{2}-\d{2}\.json$/.test(name)));
    assert.ok(!files.some((name) => name.endsWith(".tmp")));

    const latest = await fetch(server.url + "/api/system/cloud-backup/latest", { headers: app });
    assert.equal(latest.status, 200);
    assert.equal((await latest.json()).padding.length, backup.padding.length);
    const status = await (await fetch(server.url + "/api/system/cloud-backup", { headers: app })).json();
    assert.ok(status.latest.bytes > 5 * 1024 * 1024);
    assert.ok(Array.isArray(status.candidates));
  } finally {
    await fetch(server.url + "/api/system/cloud-backup/config", { method: "POST", headers: app, body: JSON.stringify({ folder: "" }) });
    await rm(folder, { recursive: true, force: true });
  }
});

test("ratings scan requests reach the extension and scraped films come back as film records", async () => {
  const app = { "Content-Type": "application/json", "X-TasteTwin-Request": "app" };
  const extension = { "Content-Type": "application/json", Origin: `chrome-extension://${"b".repeat(32)}` };
  assert.equal((await fetch(server.url + "/api/extension/request-ratings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ handle: "owner", handles: ["ece"] }) })).status, 403);
  assert.equal((await fetch(server.url + "/api/extension/request-ratings", { method: "POST", headers: app, body: JSON.stringify({ handle: "owner", handles: [] }) })).status, 400);
  const requested = await fetch(server.url + "/api/extension/request-ratings", { method: "POST", headers: app, body: JSON.stringify({ handle: "owner", handles: ["Ece", "@ece", "bad handle!", "deniz"], maxPages: 99 }) });
  assert.equal(requested.status, 200);
  assert.equal((await requested.json()).members, 2);
  const claimed = await (await fetch(server.url + "/api/extension/claim-scan", { method: "POST", headers: extension, body: JSON.stringify({ handle: "owner" }) })).json();
  assert.equal(claimed.mode, "ratings");
  assert.deepEqual(claimed.handles, ["ece", "deniz"]);
  assert.equal(claimed.maxPages, 40);

  await fetch(server.url + "/api/extension/progress", { method: "POST", headers: extension, body: JSON.stringify({ handle: "owner", state: "complete", mode: "ratings", text: "done" }) });
  const progress = await (await fetch(server.url + "/api/extension/progress?handle=owner")).json();
  assert.equal(progress.progress.mode, "ratings", "the app needs the ratings mode to see the scan finish");

  const films = [
    { slug: "parasite-2019", title: "Parasite", year: 2019, rating: 4.5, liked: true },
    { slug: "bad", title: "Bad rating", rating: 4.3 },
    { slug: "Not A Slug", title: "x", rating: 3 },
    { slug: "parasite-2019", title: "Parasite", year: 2019, rating: 4 },
  ];
  const saved = await fetch(server.url + "/api/extension/film-ratings", { method: "POST", headers: extension, body: JSON.stringify({ handle: "ece", films, complete: true, pages: 1, scannedAt: "2026-10-10T10:00:00.000Z" }) });
  assert.equal(saved.status, 200);
  const { members } = await (await fetch(server.url + "/api/letterboxd/film-ratings?handles=ece")).json();
  assert.equal(members.length, 1);
  assert.equal(members[0].complete, true);
  assert.deepEqual(members[0].films.map((f) => [f.key, f.rating, f.slug]), [["film-parasite-2019", 4, "parasite-2019"], ["film-bad-rating-unknown", undefined, "bad"]]);
  const none = await (await fetch(server.url + "/api/letterboxd/film-ratings?since=2030-01-01T00:00:00Z")).json();
  assert.equal(none.members.length, 0);
  await new Promise((resolve) => setTimeout(resolve, 2000));
  await server.start();
  const restored = await (await fetch(server.url + "/api/letterboxd/film-ratings")).json();
  assert.equal(restored.members.find((member) => member.handle === "ece")?.films.length, 2, "scraped ratings survive a restart");
});
