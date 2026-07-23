const status = document.querySelector("#status");
const lastScanBox = document.querySelector("#last-scan");
const buttons = [...document.querySelectorAll("button")];

document.querySelector("#social").addEventListener("click", () => start("social"));
document.querySelector("#network").addEventListener("click", () => start("network"));

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type !== "scanProgress") return;
  renderStatus(message.payload);
});

chrome.storage.local.get(["scanStatus", "lastScan"]).then(({ scanStatus, lastScan }) => {
  if (scanStatus) renderStatus(scanStatus);
  renderLastScan(lastScan);
});

function renderStatus(progress) {
  if (progress.state === "complete") {
    status.textContent = `Bitti: ${progress.payload.following.length} takip, ${progress.payload.followers.length} takipci`;
    renderLastScan(progress.payload);
    setBusy(false);
  } else if (progress.state === "error") {
    status.textContent = progress.message;
    setBusy(false);
  } else {
    status.textContent = progress.text ?? "Taraniyor";
    setBusy(["starting", "social", "network", "retry"].includes(progress.state));
  }
}

function renderLastScan(scan) {
  if (!scan?.handle) return;
  const timestamp = scan.capturedAt ?? scan.savedAt;
  const date = timestamp ? new Date(timestamp).toLocaleString("tr-TR") : "tarih bilinmiyor";
  const following = Array.isArray(scan.following) ? scan.following.length : 0;
  const followers = Array.isArray(scan.followers) ? scan.followers.length : 0;
  const network = scan.network?.nodes ? ` | ag: ${scan.network.nodes}` : "";
  lastScanBox.innerHTML = `<strong>Son basarili tarama</strong><span>@${escapeHtml(scan.handle)} | ${date}</span><span>${following} takip | ${followers} takipci${network}</span>`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
}

async function start(mode) {
  setBusy(true);
  status.textContent = mode === "network" ? "Ag haritasi baslatiliyor" : "Tarama baslatiliyor";
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url?.startsWith("https://letterboxd.com/")) {
    status.textContent = "Once kendi Letterboxd profil sayfani ac.";
    setBusy(false);
    return;
  }
  chrome.tabs.sendMessage(tab.id, { type: "scanTasteTwin", mode }, (result) => {
    if (chrome.runtime.lastError) {
      status.textContent = "Sayfayi yenile, sonra tekrar dene.";
      setBusy(false);
      return;
    }
    if (!result?.ok) {
      status.textContent = result?.error ?? "Tarama baslatilamadi";
      setBusy(false);
    }
  });
}

function setBusy(busy) {
  buttons.forEach((button) => { button.disabled = busy; });
}
