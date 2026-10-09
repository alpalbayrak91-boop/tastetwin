import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { request } from "node:http";
import { createTestServer } from "../scripts/test-server.mjs";
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
