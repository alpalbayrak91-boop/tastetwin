chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "scanProgress") {
    chrome.storage.local.set({ scanStatus: { ...message.payload, updatedAt: new Date().toISOString() } });
    return;
  }

  if (message?.type === "beginScan") {
    beginScan(message.handle, message.mode)
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

chrome.runtime.onStartup.addListener(() => resendLastScan());
chrome.runtime.onInstalled.addListener(() => resendLastScan());
chrome.tabs.onUpdated.addListener((_tabId, changeInfo) => {
  if (changeInfo.status === "complete" && changeInfo.url?.startsWith("http://127.0.0.1:5173/")) {
    resendLastScan();
  }
});

async function resendLastScan() {
  const { lastScan } = await chrome.storage.local.get("lastScan");
  if (!lastScan?.handle) return;
  try {
    await sendToTasteTwin({ ...lastScan, capturedAt: lastScan.capturedAt ?? lastScan.savedAt });
  } catch {
    // The local app may not be running yet. The scan remains in extension storage.
  }
}

async function beginScan(handle, mode) {
  await chrome.storage.local.set({
    scanStatus: {
      state: "starting",
      text: mode === "social" ? "Sosyal tarama baslatiliyor" : "Sosyal ve ag taramasi baslatiliyor",
      handle,
      updatedAt: new Date().toISOString(),
    },
  });
}

async function claimPendingScan(handle) {
  const response = await fetch("http://127.0.0.1:5173/api/extension/claim-scan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ handle }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error ?? `TasteTwin scan claim failed: ${response.status}`);
  return body;
}

async function claimPendingManage(handle) {
  const response = await fetch("http://127.0.0.1:5173/api/extension/claim-manage", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ handle }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error ?? `TasteTwin manage claim failed: ${response.status}`);
  return body;
}

async function reportRelationshipChange(handle, action) {
  const response = await fetch("http://127.0.0.1:5173/api/letterboxd/relationship-event", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ handle, action }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error ?? `TasteTwin relationship update failed: ${response.status}`);
  return body;
}

async function sendToTasteTwin(payload) {
  const response = await fetch("http://127.0.0.1:5173/api/letterboxd/bridge", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error ?? `TasteTwin bridge failed: ${response.status}`);
  return body;
}
