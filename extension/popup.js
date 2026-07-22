const status = document.querySelector("#status");
const buttons = [...document.querySelectorAll("button")];

document.querySelector("#social").addEventListener("click", () => start("social"));
document.querySelector("#network").addEventListener("click", () => start("network"));

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type !== "scanProgress") return;
  renderStatus(message.payload);
});

chrome.storage.local.get("scanStatus").then(({ scanStatus }) => {
  if (scanStatus) renderStatus(scanStatus);
});

function renderStatus(progress) {
  if (progress.state === "complete") {
    status.textContent = `Bitti: ${progress.payload.following.length} takip, ${progress.payload.followers.length} takipci`;
    setBusy(false);
  } else if (progress.state === "error") {
    status.textContent = progress.message;
    setBusy(false);
  } else {
    status.textContent = progress.text ?? "Taraniyor";
    setBusy(["starting", "social", "network", "retry"].includes(progress.state));
  }
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
