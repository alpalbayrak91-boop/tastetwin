const APP_ORIGIN = "http://127.0.0.1:5173";
const PROGRESS_POST_INTERVAL_MS = 1500;

let lastProgressPostAt = 0;
let pendingProgressTimer;
let pendingProgressPayload;

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "scanProgress") {
    const status = { ...message.payload, updatedAt: message.payload?.updatedAt ?? new Date().toISOString() };
    chrome.storage.local.set({ scanStatus: status });
    queueProgressPost(status);
    return;
  }

  if (message?.type === "scanInterrupted") {
    const status = { ...message.payload, updatedAt: message.payload?.updatedAt ?? new Date().toISOString() };
    chrome.storage.local.set({ scanStatus: status });
    void postProgress(status);
    return;
  }

  if (message?.type === "beginScan") {
    beginScan(message.handle, message.mode, message.startedAt)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: String(error.message ?? error) }));
    return true;
  }

  if (message?.type === "claimPendingScan") {
    claimPendingScan(message.handle)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, error: String(error.message ?? error) }));
    return true;
  }

  if (message?.type === "claimPendingManage") {
    claimPendingManage(message.handle)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, error: String(error.message ?? error) }));
    return true;
  }

  if (message?.type === "relationshipChanged") {
    reportRelationshipChange(message.handle, message.action)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: String(error.message ?? error) }));
    return true;
  }

  if (message?.type === "saveCheckpoint") {
    appFetch("/api/extension/checkpoint", { method: "POST", body: message.checkpoint })
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: String(error.message ?? error) }));
    return true;
  }

  if (message?.type === "loadCheckpoint") {
    appFetch(`/api/extension/checkpoint?handle=${encodeURIComponent(message.handle)}`)
      .then((body) => sendResponse({ ok: true, checkpoint: body.checkpoint }))
      .catch((error) => sendResponse({ ok: false, error: String(error.message ?? error) }));
    return true;
  }

  if (message?.type === "clearCheckpoint") {
    appFetch(`/api/extension/checkpoint?handle=${encodeURIComponent(message.handle)}`, { method: "DELETE" })
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: String(error.message ?? error) }));
    return true;
  }

  if (message?.type === "checkpointStatus") {
    appFetch(`/api/extension/checkpoint?handle=${encodeURIComponent(message.handle)}`)
      .then((body) => sendResponse({ ok: true, checkpoint: summarizeCheckpoint(body.checkpoint) }))
      .catch((error) => sendResponse({ ok: false, error: String(error.message ?? error) }));
    return true;
  }

  if (message?.type !== "saveBridge") return;

  const bridgedPayload = { ...message.payload, scanStage: message.stage };
  sendToTasteTwin(bridgedPayload)
    .then(async () => {
      const { scanHistory = [] } = await chrome.storage.local.get("scanHistory");
      const historyEntry = {
        stage: message.stage ?? (message.payload.network ? "network-complete" : "social-complete"),
        handle: message.payload.handle,
        capturedAt: message.payload.capturedAt ?? new Date().toISOString(),
        following: message.payload.following?.length ?? 0,
        followers: message.payload.followers?.length ?? 0,
        networkNodes: message.payload.network?.nodes ?? 0,
        networkCandidates: message.payload.network?.candidateCount ?? message.payload.network?.candidates?.length ?? 0,
      };
      return chrome.storage.local.set({
        lastScan: { ...bridgedPayload, savedAt: message.payload.capturedAt ?? new Date().toISOString() },
        scanHistory: [historyEntry, ...scanHistory].slice(0, 20),
      });
    })
    .then(() => sendResponse({ ok: true }))
    .catch((error) => sendResponse({ ok: false, error: String(error.message ?? error) }));

  return true;
});

chrome.runtime.onStartup.addListener(() => {
  void markStaleScanInterrupted();
  void resendLastScan();
});
chrome.runtime.onInstalled.addListener(() => {
  void markStaleScanInterrupted();
  void resendLastScan();
});
chrome.tabs.onUpdated.addListener((_tabId, changeInfo) => {
  if (changeInfo.status === "complete" && changeInfo.url?.startsWith(`${APP_ORIGIN}/`)) {
    resendLastScan();
  }
});

// A scan lives inside the Letterboxd tab. If that tab dies without a
// beforeunload event, the stored status would otherwise stay "running"
// forever. Any status older than this is reported as interrupted.
const STALE_STATUS_MS = 3 * 60 * 1000;

async function markStaleScanInterrupted() {
  const { scanStatus } = await chrome.storage.local.get("scanStatus");
  if (!scanStatus || !isRunningState(scanStatus.state)) return;
  const updatedAt = Date.parse(scanStatus.updatedAt ?? "");
  if (Number.isFinite(updatedAt) && Date.now() - updatedAt < STALE_STATUS_MS) return;
  await chrome.storage.local.set({
    scanStatus: {
      ...scanStatus,
      state: "interrupted",
      code: "tab-closed",
      text: "Tarama kesilmis. Tarayici veya sekme kapanmis olabilir.",
      hint: "Ayni profili acip kaldigin yerden devam et.",
      updatedAt: new Date().toISOString(),
      interruptedFrom: scanStatus.state,
    },
  });
}

function isRunningState(state) {
  return ["starting", "social", "social-complete", "network", "network-complete", "retry"].includes(state);
}

function summarizeCheckpoint(checkpoint) {
  if (!checkpoint?.handle) return undefined;
  return {
    handle: checkpoint.handle,
    mode: checkpoint.mode,
    startedAt: checkpoint.startedAt,
    savedAt: checkpoint.savedAt,
    connectorIndex: checkpoint.connectorIndex ?? 0,
    connectorTotal: Array.isArray(checkpoint.connectors) ? checkpoint.connectors.length : 0,
    nodes: Array.isArray(checkpoint.nodes) ? checkpoint.nodes.length : 0,
    candidates: Array.isArray(checkpoint.candidates) ? checkpoint.candidates.length : 0,
  };
}

function queueProgressPost(status) {
  pendingProgressPayload = status;
  const elapsed = Date.now() - lastProgressPostAt;
  if (elapsed >= PROGRESS_POST_INTERVAL_MS) {
    void flushProgress();
    return;
  }
  if (pendingProgressTimer) return;
  pendingProgressTimer = setTimeout(() => {
    pendingProgressTimer = undefined;
    void flushProgress();
  }, PROGRESS_POST_INTERVAL_MS - elapsed);
}

async function flushProgress() {
  const payload = pendingProgressPayload;
  pendingProgressPayload = undefined;
  if (!payload) return;
  lastProgressPostAt = Date.now();
  await postProgress(payload);
}

async function postProgress(status) {
  try {
    const body = await appFetch("/api/extension/progress", { method: "POST", body: status });
    if (body?.cancelRequested) {
      await chrome.storage.local.set({ scanControl: { cancelRequestedAt: new Date().toISOString(), source: "app" } });
    }
  } catch {
    // The local app may be closed. Progress still lives in extension storage.
  }
}

async function resendLastScan() {
  const { lastScan } = await chrome.storage.local.get("lastScan");
  if (!lastScan?.handle) return;
  try {
    await sendToTasteTwin({ ...lastScan, capturedAt: lastScan.capturedAt ?? lastScan.savedAt });
  } catch {
    // The local app may not be running yet. The scan remains in extension storage.
  }
}

async function beginScan(handle, mode, startedAt) {
  await chrome.storage.local.remove("scanControl");
  await chrome.storage.local.set({
    scanStatus: {
      state: "starting",
      phase: "starting",
      percent: 0,
      text: mode === "social" ? "Sosyal tarama baslatiliyor" : "Sosyal ve ag taramasi baslatiliyor",
      handle,
      mode,
      startedAt: startedAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  });
}

async function claimPendingScan(handle) {
  return appFetch("/api/extension/claim-scan", { method: "POST", body: { handle } });
}

async function claimPendingManage(handle) {
  return appFetch("/api/extension/claim-manage", { method: "POST", body: { handle } });
}

async function reportRelationshipChange(handle, action) {
  return appFetch("/api/letterboxd/relationship-event", { method: "POST", body: { handle, action } });
}

async function sendToTasteTwin(payload) {
  return appFetch("/api/letterboxd/bridge", { method: "POST", body: payload });
}

async function appFetch(pathname, options = {}) {
  const init = { method: options.method ?? "GET" };
  if (options.body !== undefined) {
    init.headers = { "Content-Type": "application/json" };
    init.body = JSON.stringify(options.body);
  }
  const response = await fetch(`${APP_ORIGIN}${pathname}`, init);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.error ?? `TasteTwin ${pathname} failed: ${response.status}`);
  }
  return body;
}
