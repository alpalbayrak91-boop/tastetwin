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

  if (message?.type !== "saveBridge") return;

  sendToTasteTwin(message.payload)
    .then(async (response) => {
      return chrome.storage.local.set({
        lastScan: { ...message.payload, savedAt: message.payload.capturedAt ?? new Date().toISOString() },
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
      text: mode === "network" ? "Ag taramasi baslatiliyor" : "Sosyal tarama baslatiliyor",
      handle,
      updatedAt: new Date().toISOString(),
    },
  });
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
