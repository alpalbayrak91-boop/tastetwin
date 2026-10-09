// Local desktop/Vite clients and installed Chrome extensions with host permission.
// Deployments can narrow the latter to exact extension origins with the env setting.
export function enforceRequestPolicy(req, res, port) {
  res.setHeader("Vary", "Origin");
  res.setHeader("X-Content-Type-Options", "nosniff");
  const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  if (port === 80) { hosts.add("localhost"); hosts.add("127.0.0.1"); }
  if (!hosts.has(req.headers.host)) return reject(res, 403, "invalid_host");
  const origin = req.headers.origin;
  const appOrigins = new Set([`http://127.0.0.1:${port}`, `http://localhost:${port}`, "http://127.0.0.1:5174", "http://localhost:5174"]);
  const configuredExtensions = process.env.TASTETWIN_EXTENSION_ORIGINS?.split(",").map((value) => value.trim());
  const extensionAllowed = typeof origin === "string" && /^chrome-extension:\/\/[a-p]{32}$/.test(origin) &&
    (!configuredExtensions || configuredExtensions.includes(origin));
  if (origin && !appOrigins.has(origin) && !extensionAllowed) return reject(res, 403, "origin_not_allowed");
  // A browser no-cors request can omit Origin. Do not let it mutate or read local state.
  if (!origin && req.headers["sec-fetch-site"] === "cross-site") return reject(res, 403, "cross_site_request");
  if (origin) res.setHeader("Access-Control-Allow-Origin", origin);
  if (req.method === "OPTIONS") {
    const method = req.headers["access-control-request-method"];
    const headers = String(req.headers["access-control-request-headers"] ?? "").toLowerCase().split(",").map((header) => header.trim()).filter(Boolean);
    if (!origin || !["GET", "POST", "DELETE"].includes(method) || headers.some((header) => !["content-type", "x-tastetwin-request"].includes(header))) {
      return reject(res, 403, "preflight_not_allowed");
    }
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-TasteTwin-Request");
    res.writeHead(204);
    res.end();
    return false;
  }
  if (req.method === "POST" && String(req.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase() !== "application/json") {
    return reject(res, 415, "json_required");
  }
  return true;
}

function reject(res, status, error) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify({ error }));
  return false;
}
