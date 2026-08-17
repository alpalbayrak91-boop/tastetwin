const STALE_MS = 90 * 1000;
const RUNNING_STATES = ["starting", "social", "social-complete", "network", "network-complete", "retry"];

const statusBox = document.querySelector("#status");
const panel = document.querySelector("#progress-panel");
const barFill = document.querySelector("#bar-fill");
const metaBox = document.querySelector("#progress-meta");
const ageBox = document.querySelector("#progress-age");
const hintBox = document.querySelector("#progress-hint");
const lastScanBox = document.querySelector("#last-scan");
const fullScanButton = document.querySelector("#full-scan");
const resumeButton = document.querySelector("#resume-scan");
const cancelButton = document.querySelector("#cancel-scan");

let currentStatus;
let checkpointSummary;

fullScanButton.addEventListener("click", () => start("full", false));
resumeButton.addEventListener("click", () => start("full", true));
cancelButton.addEventListener("click", () => cancel());

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type !== "scanProgress") return;
  currentStatus = message.payload;
  render();
});

void initialise();
window.setInterval(render, 1000);

async function initialise() {
  const { scanStatus, lastScan } = await chrome.storage.local.get(["scanStatus", "lastScan"]);
  currentStatus = scanStatus;
  renderLastScan(lastScan);
  render();
  await refreshCheckpoint(scanStatus?.handle ?? lastScan?.handle);
}

async function refreshCheckpoint(handle) {
  if (!handle) return;
  try {
    const result = await chrome.runtime.sendMessage({ type: "checkpointStatus", handle });
    checkpointSummary = result?.ok ? result.checkpoint : undefined;
  } catch {
    checkpointSummary = undefined;
  }
  render();
}

function render() {
  const status = currentStatus;
  if (!status) {
    setPanel("idle", "Hazir", "", "");
    setBar(0);
    updateButtons(false);
    return;
  }

  const ageMs = ageOf(status);
  const running = RUNNING_STATES.includes(status.state);
  const stalled = running && ageMs > STALE_MS;

  if (status.state === "complete") {
    const network = status.payload?.network;
    setPanel(
      "idle",
      network
        ? `Bitti: ${count(status.payload?.following)} takip, ${count(status.payload?.followers)} takipci, ${network.candidateCount ?? network.candidates?.length ?? 0} ag adayi`
        : `Bitti: ${count(status.payload?.following)} takip, ${count(status.payload?.followers)} takipci`,
      "",
      "",
    );
    setBar(100);
    renderLastScan(status.payload);
    updateButtons(false);
    return;
  }

  if (status.state === "error") {
    setPanel("bad", status.text ?? "Tarama hatasi", errorLabel(status.code), status.hint ?? "");
    setBar(status.percent ?? 0);
    updateButtons(false);
    return;
  }

  if (status.state === "cancelled") {
    setPanel("warn", status.text ?? "Tarama iptal edildi.", "", status.hint ?? "");
    setBar(status.percent ?? 0);
    updateButtons(false);
    return;
  }

  if (status.state === "interrupted" || stalled) {
    setPanel(
      "bad",
      stalled && status.state !== "interrupted"
        ? "Tarama kesilmis gorunuyor."
        : status.text ?? "Tarama kesildi.",
      `${describePhase(status)} | son isaret ${formatAge(ageMs)} once`,
      status.hint ?? "Sekme kapanmis veya yenilenmis olabilir. Ayni profili acip kaldigin yerden devam et.",
    );
    setBar(status.percent ?? 0);
    updateButtons(false);
    return;
  }

  setPanel("live", status.text ?? "Taraniyor", describePhase(status), status.hint ?? "");
  setBar(status.percent ?? 0);
  ageBox.textContent = `Calisiyor | son isaret ${formatAge(ageMs)} once${elapsedLabel(status)}`;
  updateButtons(true);
}

function updateButtons(running) {
  fullScanButton.disabled = running;
  cancelButton.hidden = !running;
  const canResume = !running && Boolean(checkpointSummary?.connectorIndex);
  resumeButton.hidden = !canResume;
  if (canResume) {
    resumeButton.textContent = `Kaldigi yerden devam et (${checkpointSummary.connectorIndex}/${checkpointSummary.connectorTotal})`;
  }
}

function setPanel(tone, text, meta, hint) {
  panel.className = `panel${tone === "live" ? " live" : tone === "warn" ? " warn" : tone === "bad" ? " bad" : ""}`;
  statusBox.textContent = text;
  metaBox.textContent = meta ?? "";
  ageBox.textContent = "";
  hintBox.textContent = hint ?? "";
}

function setBar(percent) {
  const safe = Math.max(0, Math.min(100, Math.round(Number(percent) || 0)));
  barFill.style.width = `${safe}%`;
  if (safe > 0) metaBox.textContent = `%${safe}${metaBox.textContent ? ` | ${metaBox.textContent}` : ""}`;
}

function describePhase(status) {
  if (status.phase === "network" && status.total) {
    return `Ag: ${status.current}/${status.total} baglayici | ${status.nodes ?? 0} hesap | ${status.candidates ?? 0} aday`;
  }
  if (status.phase === "following" || status.phase === "followers") {
    return status.total ? `${status.current}/${status.total} kisi` : `${status.current ?? 0} kisi`;
  }
  if (status.phase === "retry") return "Hiz sinirinda bekleniyor";
  return "";
}

function elapsedLabel(status) {
  const startedAt = Date.parse(status.startedAt ?? "");
  if (!Number.isFinite(startedAt)) return "";
  return ` | toplam ${formatAge(Date.now() - startedAt)}`;
}

function errorLabel(code) {
  const labels = {
    "rate-limited": "Letterboxd hiz siniri (429)",
    forbidden: "Erisim reddedildi (403)",
    cloudflare: "Tarayici dogrulamasi gerekiyor",
    "app-offline": "TasteTwin uygulamasina ulasilamadi",
    "tab-closed": "Sekme kapandi",
    "not-found": "Sayfa bulunamadi",
    "pagination-loop": "Sayfalama dongusu",
    network: "Baglanti hatasi",
  };
  return code ? labels[code] ?? `Hata kodu: ${code}` : "";
}

function ageOf(status) {
  const updatedAt = Date.parse(status.updatedAt ?? "");
  return Number.isFinite(updatedAt) ? Math.max(0, Date.now() - updatedAt) : Number.POSITIVE_INFINITY;
}

function formatAge(ms) {
  if (!Number.isFinite(ms)) return "bilinmiyor";
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds} sn`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} dk`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} saat`;
  return `${Math.round(hours / 24)} gun`;
}

function count(value) {
  return Array.isArray(value) ? value.length : 0;
}

function renderLastScan(scan) {
  if (!scan?.handle) return;
  const timestamp = scan.capturedAt ?? scan.savedAt;
  const date = timestamp ? new Date(timestamp).toLocaleString("tr-TR") : "tarih bilinmiyor";
  const following = count(scan.following);
  const followers = count(scan.followers);
  const network = scan.network?.nodes
    ? ` | ag: ${scan.network.nodes} hesap, ${scan.network.candidateCount ?? scan.network.candidates?.length ?? 0} aday`
    : " | ag henuz taranmadi";
  const age = timestamp ? ` (${formatAge(Date.now() - Date.parse(timestamp))} once)` : "";
  lastScanBox.innerHTML = `<strong>Son basarili tarama</strong><span>@${escapeHtml(scan.handle)} | ${date}${age}</span><span>${following} takip | ${followers} takipci${network}</span>`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
}

async function cancel() {
  await chrome.storage.local.set({ scanControl: { cancelRequestedAt: new Date().toISOString(), source: "popup" } });
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id) chrome.tabs.sendMessage(tab.id, { type: "cancelScan" }, () => void chrome.runtime.lastError);
  setPanel("warn", "Iptal isteniyor; tarama bir sonraki adimda duracak.", "", "");
}

async function start(mode, resume) {
  fullScanButton.disabled = true;
  resumeButton.disabled = true;
  setPanel("live", resume ? "Kaldigi yerden devam ediliyor" : "Tarama baslatiliyor", "", "");
  await chrome.storage.local.remove("scanControl");

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url?.startsWith("https://letterboxd.com/")) {
    setPanel("warn", "Once kendi Letterboxd profil sayfani ac.", "", "letterboxd.com/kullaniciadin/ adresini ac ve tekrar dene.");
    fullScanButton.disabled = false;
    resumeButton.disabled = false;
    return;
  }

  chrome.tabs.sendMessage(tab.id, { type: "scanTasteTwin", mode, resume }, (result) => {
    resumeButton.disabled = false;
    if (chrome.runtime.lastError) {
      setPanel("warn", "Sayfayla baglanti kurulamadi.", "", "Letterboxd sekmesini yenile, sonra tekrar dene.");
      fullScanButton.disabled = false;
      return;
    }
    if (!result?.ok) {
      setPanel("bad", result?.error ?? "Tarama baslatilamadi", "", "");
      fullScanButton.disabled = false;
    }
  });
}
