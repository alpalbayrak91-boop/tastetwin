import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const testDirectory = path.join(root, ".codex-test-bridge");
const port = 5191;
const baseUrl = `http://127.0.0.1:${port}`;
let child;

if (!testDirectory.startsWith(`${root}${path.sep}`)) throw new Error("Unsafe bridge test directory");

try {
  await rm(testDirectory, { recursive: true, force: true });
  child = await startServer();
  const scanRequest = await fetch(`${baseUrl}/api/extension/request-scan`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-TasteTwin-Request": "app" },
    body: JSON.stringify({ handle: "tastetwincheck" }),
  }).then((response) => response.json());
  const wrongClaim = await fetch(`${baseUrl}/api/extension/claim-scan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ handle: "anotherprofile" }),
  }).then((response) => response.json());
  const scanClaim = await fetch(`${baseUrl}/api/extension/claim-scan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ handle: "tastetwincheck" }),
  }).then((response) => response.json());
  const repeatedClaim = await fetch(`${baseUrl}/api/extension/claim-scan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ handle: "tastetwincheck" }),
  }).then((response) => response.json());
  if (!scanRequest.ok || wrongClaim.pending || !scanClaim.pending || repeatedClaim.pending) {
    throw new Error(`Automatic scan handoff failed: ${JSON.stringify({ scanRequest, wrongClaim, scanClaim, repeatedClaim })}`);
  }
  const capturedAt = "2026-07-17T12:00:00.000Z";
  const bridgeResponse = await fetch(`${baseUrl}/api/letterboxd/bridge`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      handle: "tastetwincheck",
      capturedAt,
      scanStage: "network-complete",
      following: [member("alpha"), member("beta"), member("gamma")],
      followers: [member("alpha"), member("delta")],
      network: {
        nodes: 7,
        edges: 9,
        capped: false,
        connectorsScanned: 2,
        candidateCount: 2,
        completedAt: capturedAt,
        handles: ["epsilon", "zeta"],
        candidates: [
          candidate("epsilon", "alpha", 120, 0.42),
          candidate("zeta", "delta", 900, 0.29),
        ],
      },
    }),
  });
  if (!bridgeResponse.ok) throw new Error(`Bridge POST failed: ${bridgeResponse.status}`);
  await stopServer(child);
  child = await startServer();

  const social = await fetch(`${baseUrl}/api/letterboxd/social?handle=tastetwincheck`).then((response) => response.json());
  const network = await fetch(`${baseUrl}/api/letterboxd/network?handle=tastetwincheck&limit=120`).then((response) => response.json());
  if (social.source !== "browser-extension" || social.counts.following !== 3 || social.counts.followers !== 2) {
    throw new Error(`Restored social data is invalid: ${JSON.stringify(social)}`);
  }
  if (network.total !== 2 || network.handles.length !== 2) {
    throw new Error(`Restored network data is invalid: ${JSON.stringify(network)}`);
  }
  if (network.members[0].viaDetails?.[0]?.handle !== "alpha" || !network.members[0].connectionWeight) {
    throw new Error(`Weighted connection details were not restored: ${JSON.stringify(network.members[0])}`);
  }
  if (social.checkedAt !== capturedAt || social.scanStage !== "network-complete") {
    throw new Error(`Capture stage was not preserved: ${JSON.stringify({ checkedAt: social.checkedAt, scanStage: social.scanStage })}`);
  }
  console.log(JSON.stringify({ restored: true, automaticHandoff: true, following: 3, followers: 2, networkNodes: 7, weightedConnections: true, checkedAt: social.checkedAt }));
} finally {
  if (child && child.exitCode === null) await stopServer(child);
  await rm(testDirectory, { recursive: true, force: true });
}

function member(username) {
  return { username, displayName: username };
}

function candidate(username, via, followingCount, weight) {
  return {
    ...member(username),
    connections: 1,
    connectionWeight: weight,
    via: [via],
    viaDetails: [{ username: via, displayName: via, followingCount, weight }],
  };
}

function startServer() {
  return new Promise((resolve, reject) => {
    const processChild = spawn(process.execPath, [path.join(root, "server.mjs")], {
      cwd: root,
      env: { ...process.env, PORT: String(port), TASTETWIN_DATA_DIR: testDirectory },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const timer = setTimeout(() => reject(new Error("Bridge test server did not start")), 10000);
    processChild.stdout.setEncoding("utf8");
    processChild.stdout.on("data", (text) => {
      if (!text.includes("TasteTwin live server")) return;
      clearTimeout(timer);
      resolve(processChild);
    });
    processChild.stderr.setEncoding("utf8");
    processChild.stderr.on("data", (text) => {
      if (text.trim()) console.error(text.trim());
    });
    processChild.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function stopServer(processChild) {
  return new Promise((resolve) => {
    if (processChild.exitCode !== null) {
      resolve();
      return;
    }
    processChild.once("exit", resolve);
    processChild.kill();
  });
}
