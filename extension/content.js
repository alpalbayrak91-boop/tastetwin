const MAX_NETWORK_NODES = 10000;
const MAX_NETWORK_CONNECTORS = 120;
const MAX_MEMBERS_PER_CONNECTOR = 220;
const MAX_VIA_DETAILS = 25;
const PAGE_DELAY_MS = 1400;
const RETRY_DELAYS_MS = [5000, 12000, 25000];
const HEARTBEAT_MS = 12000;
const CHECKPOINT_EVERY_CONNECTORS = 5;
const SOCIAL_PERCENT_SHARE = 22;
const MAX_RATINGS_MEMBERS = 500;
const MAX_RATINGS_PAGES = 40;

let activeScan;
let lastProgress;
let heartbeatTimer;
let cancelRequestedLocally = false;

class ScanCancelled extends Error {
  constructor() {
    super("Tarama iptal edildi.");
    this.code = "cancelled";
  }
}

class ScanFailure extends Error {
  constructor(code, message, hint) {
    super(message);
    this.code = code;
    this.hint = hint;
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "cancelScan") {
    cancelRequestedLocally = true;
    sendResponse({ ok: true, scanning: Boolean(activeScan) });
    return true;
  }

  if (message?.type === "scanTasteTwin") {
    startScan(message.mode === "social" ? "social" : "full", { resume: message.resume === true })
      .then((payload) => {
        sendResponse({ ok: true, payload });
      })
      .catch((error) => {
        sendResponse({ ok: false, error: String(error.message ?? error) });
      });
    return true;
  }

  return undefined;
});

void claimAppRequestedScan();
void claimAppRequestedManage();

function startScan(mode, options = {}) {
  if (!activeScan) {
    cancelRequestedLocally = false;
    activeScan = runScan(mode, options)
      .then((payload) => {
        notify({ state: "complete", phase: "done", percent: 100, payload });
        return payload;
      })
      .catch((error) => {
        if (error instanceof ScanCancelled) {
          notify({
            state: "cancelled",
            phase: "cancelled",
            percent: lastProgress?.percent ?? 0,
            code: "cancelled",
            text: "Tarama iptal edildi.",
            hint: "Yeni tarama baslatabilir veya kaldigi yerden devam edebilirsin.",
          });
        } else {
          const detail = describeError(error);
          notify({
            state: "error",
            phase: "error",
            percent: lastProgress?.percent ?? 0,
            code: detail.code,
            text: detail.message,
            hint: detail.hint,
          });
        }
        throw error;
      })
      .finally(() => {
        activeScan = undefined;
        stopHeartbeat();
        void clearControl();
      });
  }
  return activeScan;
}

async function claimAppRequestedScan() {
  const handle = currentHandle();
  if (!handle) return;
  try {
    const result = await chrome.runtime.sendMessage({ type: "claimPendingScan", handle });
    if (!result?.ok || !result.pending) return;
    notify({
      state: "starting",
      phase: "starting",
      percent: 0,
      text: "TasteTwin uygulamasindan tarama emri alindi",
      handle,
    });
    if (result.mode === "ratings") {
      await startRatingsScan(handle, result.handles, result.maxPages);
      return;
    }
    await startScan(result.mode === "social" ? "social" : "full", { resume: result.resume === true });
  } catch {
    // The local app may be closed or this page may not be the requested profile.
  }
}

// Reads members' public film pages (/<member>/films/page/N/) slowly, one
// member at a time, and hands each finished member to the local app. RSS only
// shows recent activity; these pages carry every rating the member made public.
function startRatingsScan(owner, handles, maxPages) {
  if (activeScan) return activeScan;
  cancelRequestedLocally = false;
  const members = [...new Set((Array.isArray(handles) ? handles : []).map((value) => String(value).toLowerCase()))]
    .filter((value) => /^[a-z0-9_-]{2,32}$/.test(value))
    .slice(0, MAX_RATINGS_MEMBERS);
  const pageLimit = Math.min(MAX_RATINGS_PAGES, Math.max(1, Number(maxPages) || 8));
  activeScan = runRatingsScan(owner, members, pageLimit)
    .then((summary) => {
      notify({ state: "complete", phase: "done", mode: "ratings", percent: 100, text: `Puan taramasi bitti: ${summary.members} kisi, ${summary.films} film puani`, handle: owner });
      return summary;
    })
    .catch((error) => {
      const detail = error instanceof ScanCancelled
        ? { code: "cancelled", message: "Puan taramasi iptal edildi.", hint: "Taranan kisiler kaydedildi." }
        : describeError(error);
      notify({ state: error instanceof ScanCancelled ? "cancelled" : "error", phase: "error", mode: "ratings", percent: lastProgress?.percent ?? 0, code: detail.code, text: detail.message, hint: detail.hint, handle: owner });
      throw error;
    })
    .finally(() => {
      activeScan = undefined;
      stopHeartbeat();
      void clearControl();
    });
  return activeScan;
}

async function runRatingsScan(owner, members, pageLimit) {
  if (!globalThis.TasteTwinFilmGrid) {
    throw new ScanFailure("parser-missing", "Film sayfasi okuyucu yuklenemedi.", "Eklentiyi chrome://extensions sayfasindan yenile.");
  }
  const startedAt = new Date().toISOString();
  const started = await chrome.runtime.sendMessage({ type: "beginScan", handle: owner, mode: "ratings", startedAt });
  if (!started?.ok) throw new ScanFailure("start-failed", started?.error ?? "Tarama baslatilamadi.", "Sayfayi yenileyip tekrar dene.");
  startHeartbeat();
  let totalFilms = 0;
  let failed = 0;
  for (let index = 0; index < members.length; index += 1) {
    const member = members[index];
    await assertNotCancelled();
    notify({
      state: "ratings",
      phase: "ratings",
      mode: "ratings",
      percent: Math.round((index / Math.max(members.length, 1)) * 100),
      text: `Puanlar okunuyor: @${member} (${index + 1}/${members.length})`,
      current: index,
      total: members.length,
      startedAt,
      handle: owner,
    });
    try {
      const result = await scanMemberFilms(member, pageLimit);
      totalFilms += result.films.length;
      const saved = await chrome.runtime.sendMessage({ type: "saveFilmRatings", payload: { handle: member, ...result, scannedAt: new Date().toISOString() } });
      if (!saved?.ok) throw new ScanFailure("app-offline", "TasteTwin uygulamasina kaydedilemedi.", "TasteTwin acik mi kontrol et; taranan kisiler kayitli.");
    } catch (error) {
      if (error instanceof ScanCancelled || isBlockingError(error) || error?.code === "rate-limited") throw error;
      failed += 1;
    }
    if (index < members.length - 1) await delay(PAGE_DELAY_MS);
  }
  return { members: members.length - failed, failed, films: totalFilms };
}

async function scanMemberFilms(member, pageLimit) {
  const films = new Map();
  let page = 1;
  let complete = false;
  while (page <= pageLimit) {
    await assertNotCancelled();
    const url = page === 1 ? `/${member}/films/` : `/${member}/films/page/${page}/`;
    const response = await fetchPage(url, `@${member} filmleri`);
    const html = await response.text();
    if (/Just a moment|Enable JavaScript and cookies to continue/i.test(html)) {
      throw new ScanFailure("cloudflare", "Letterboxd tarayici dogrulamasi istedi.", "Sekmedeki dogrulamayi tamamla, sonra yeniden baslat.");
    }
    const documentPage = new DOMParser().parseFromString(html, "text/html");
    const parsed = globalThis.TasteTwinFilmGrid.parseFilmGrid(documentPage);
    for (const film of parsed) films.set(film.slug, film);
    if (!parsed.length || !globalThis.TasteTwinFilmGrid.hasNextFilmPage(documentPage, parsed.length)) {
      complete = true;
      break;
    }
    page += 1;
    if (page <= pageLimit) await delay(PAGE_DELAY_MS);
  }
  return { films: [...films.values()], pages: Math.min(page, pageLimit), complete };
}

async function claimAppRequestedManage() {
  const handle = currentHandle();
  if (!handle) return;
  try {
    const result = await chrome.runtime.sendMessage({ type: "claimPendingManage", handle });
    if (!result?.ok || !result.pending) return;
    highlightRelationshipControl(result.action);
  } catch {
    // TasteTwin may be closed or this may not be the requested profile.
  }
}

function highlightRelationshipControl(action) {
  const candidates = [
    ...document.querySelectorAll(
      ".js-follow-button, [data-owner-action='follow'], [data-owner-action='unfollow'], .button.-action-follow, .actions-panel button, .actions-panel a",
    ),
  ];
  const control = candidates.find((element) => {
    const text = (element.textContent ?? "").trim().toLowerCase();
    return action === "unfollow"
      ? /following|takiptesin|unfollow/.test(text)
      : /follow|takip et/.test(text) && !/following|unfollow/.test(text);
  });
  const banner = document.createElement("div");
  banner.id = "tastetwin-manage-guide";
  banner.textContent =
    action === "unfollow"
      ? "TasteTwin: Takipten cikmak icin vurgulanan Letterboxd dugmesini sen onayla."
      : "TasteTwin: Takip etmek icin vurgulanan Letterboxd dugmesini sen onayla.";
  Object.assign(banner.style, {
    position: "fixed",
    zIndex: "2147483647",
    right: "20px",
    top: "20px",
    maxWidth: "360px",
    padding: "14px 18px",
    background: "#151515",
    color: "#fff",
    border: "2px solid #ff8000",
    borderRadius: "6px",
    font: "700 14px/1.4 system-ui, sans-serif",
    boxShadow: "0 12px 35px rgba(0,0,0,.35)",
  });
  document.body.append(banner);
  window.setTimeout(() => banner.remove(), 12000);
  if (!control) return;
  control.addEventListener(
    "click",
    () => {
      window.setTimeout(() => {
        chrome.runtime.sendMessage({
          type: "relationshipChanged",
          handle: currentHandle(),
          action,
        }).catch(() => {});
      }, 900);
    },
    { once: true },
  );
  control.scrollIntoView({ behavior: "smooth", block: "center" });
  control.style.outline = "4px solid #ff8000";
  control.style.outlineOffset = "4px";
  control.style.boxShadow = "0 0 0 8px rgba(255,128,0,.24)";
  window.setTimeout(() => {
    control.style.outline = "";
    control.style.outlineOffset = "";
    control.style.boxShadow = "";
  }, 12000);
}

async function runScan(mode, options) {
  const handle = currentHandle();
  if (!handle) {
    throw new ScanFailure(
      "no-handle",
      "Bu sayfa bir Letterboxd profili degil.",
      "Kendi profil, Followers veya Following sayfani ac ve tekrar dene.",
    );
  }

  const startedAt = new Date().toISOString();
  const expected = await expectedCounts(handle);
  const started = await chrome.runtime.sendMessage({ type: "beginScan", handle, mode, startedAt });
  if (!started?.ok) {
    throw new ScanFailure("start-failed", started?.error ?? "Tarama baslatilamadi.", "Sayfayi yenileyip tekrar dene.");
  }
  startHeartbeat();

  const checkpoint = options?.resume ? await loadCheckpoint(handle) : undefined;
  const resumable = checkpoint && checkpoint.mode === mode ? checkpoint : undefined;

  let following = resumable?.following;
  let followers = resumable?.followers;

  if (!Array.isArray(following) || !Array.isArray(followers)) {
    notify({
      state: "social",
      phase: "following",
      percent: 0,
      text: "Following listesi taraniyor",
      current: 0,
      total: expected.following,
      startedAt,
      handle,
      mode,
    });
    following = await scanList(handle, "following", (progress) =>
      notify({
        state: "social",
        phase: "following",
        percent: sharePercent(0, SOCIAL_PERCENT_SHARE / 2, progress.current, expected.following),
        text: `Following: ${progress.current} kisi (sayfa ${progress.page})`,
        current: progress.current,
        total: expected.following,
        startedAt,
        handle,
        mode,
      }),
    );

    notify({
      state: "social",
      phase: "followers",
      percent: SOCIAL_PERCENT_SHARE / 2,
      text: "Followers listesi taraniyor",
      current: 0,
      total: expected.followers,
      startedAt,
      handle,
      mode,
    });
    followers = await scanList(handle, "followers", (progress) =>
      notify({
        state: "social",
        phase: "followers",
        percent: sharePercent(SOCIAL_PERCENT_SHARE / 2, SOCIAL_PERCENT_SHARE / 2, progress.current, expected.followers),
        text: `Followers: ${progress.current} kisi (sayfa ${progress.page})`,
        current: progress.current,
        total: expected.followers,
        startedAt,
        handle,
        mode,
      }),
    );
  } else {
    notify({
      state: "network",
      phase: "resume",
      percent: SOCIAL_PERCENT_SHARE,
      text: `Kaydedilen taramadan devam ediliyor: ${resumable.connectorIndex}/${resumable.connectors.length} baglayici`,
      startedAt,
      handle,
      mode,
    });
  }

  const payload = { handle, following, followers, capturedAt: new Date().toISOString() };
  if (!resumable) {
    await saveStage(payload, "social-complete", "Takip verisi TasteTwin'e kaydedildi; ag taramasi devam ediyor", {
      percent: SOCIAL_PERCENT_SHARE,
      startedAt,
      mode,
    });
  }

  if (mode === "full") {
    payload.network = await scanTwoHopNetwork(handle, following, followers, {
      startedAt,
      mode,
      checkpoint: resumable,
    });
    payload.capturedAt = new Date().toISOString();
    await saveStage(payload, "network-complete", `Ag kaydedildi: ${payload.network.nodes} hesap`, {
      percent: 100,
      startedAt,
      mode,
    });
    await clearCheckpoint(handle);
  }
  return payload;
}

async function saveStage(payload, state, text, extra = {}) {
  const result = await chrome.runtime.sendMessage({ type: "saveBridge", payload, stage: state });
  if (!result?.ok) {
    throw new ScanFailure(
      "app-offline",
      result?.error ?? "Sonuc TasteTwin uygulamasina gonderilemedi.",
      "TasteTwin uygulamasi acik mi? Acip tekrar dene; taranan veri kaybolmadi.",
    );
  }
  notify({ state, phase: state, text, payload, ...extra });
}

async function scanTwoHopNetwork(owner, directFollowing, directFollowers, context) {
  const directMembers = uniqueMembers([...directFollowing, ...directFollowers]);
  const followedMembers = uniqueMembers(directFollowing);
  const directHandles = new Set([owner, ...directMembers.map((member) => member.username)]);
  const checkpoint = context.checkpoint;

  const nodes = new Set(checkpoint?.nodes ?? directHandles);
  const candidates = new Map(
    (checkpoint?.candidates ?? []).map((candidate) => [candidate.username, candidate]),
  );
  const daySeed = checkpoint?.daySeed ?? new Date().toISOString().slice(0, 10);
  // Only people the owner deliberately follows can seed discovery. A daily
  // stable shuffle spreads the scan over different circles without jumping
  // into arbitrary followers' networks. A resumed scan keeps the original
  // connector order so no circle is scanned twice.
  const connectorNames = checkpoint?.connectors;
  const connectors = connectorNames
    ? connectorNames
        .map((username) => followedMembers.find((member) => member.username === username) ?? { username, displayName: username })
    : seededShuffle(followedMembers, `${owner}-${daySeed}`).slice(0, MAX_NETWORK_CONNECTORS);

  let edges = checkpoint?.edges ?? directMembers.length;
  let capped = false;
  let failedConnectors = checkpoint?.failedConnectors ?? 0;
  let connectorsScanned = checkpoint?.connectorsScanned ?? 0;
  const startIndex = checkpoint?.connectorIndex ?? 0;

  for (let index = startIndex; index < connectors.length; index += 1) {
    await assertNotCancelled();
    if (nodes.size >= MAX_NETWORK_NODES) {
      capped = true;
      break;
    }
    const member = connectors[index];
    notify({
      state: "network",
      phase: "network",
      percent: sharePercent(SOCIAL_PERCENT_SHARE, 100 - SOCIAL_PERCENT_SHARE, index, connectors.length),
      text: `Ag taraniyor: ${member.username}`,
      current: index + 1,
      total: connectors.length,
      nodes: nodes.size,
      candidates: candidates.size,
      failedConnectors,
      startedAt: context.startedAt,
      handle: owner,
      mode: context.mode,
    });
    const remaining = MAX_NETWORK_NODES - nodes.size;
    let theirs;
    try {
      theirs = await scanList(
        member.username,
        "following",
        undefined,
        Math.min(remaining, MAX_MEMBERS_PER_CONNECTOR),
      );
    } catch (error) {
      if (error instanceof ScanCancelled) throw error;
      if (isBlockingError(error)) throw error;
      failedConnectors += 1;
      continue;
    }
    connectorsScanned += 1;
    edges += theirs.length;
    const connectorWeight = Number(
      Math.max(0.04, 1 / Math.log2(Math.max(3, theirs.length + 2))).toFixed(3),
    );
    for (const next of theirs) {
      nodes.add(next.username);
      if (directHandles.has(next.username)) continue;
      const current = candidates.get(next.username);
      const viaDetails = [
        ...(current?.viaDetails ?? []),
        {
          username: member.username,
          displayName: member.displayName,
          avatarUrl: member.avatarUrl,
          followingCount: theirs.length,
          weight: connectorWeight,
        },
      ].slice(-MAX_VIA_DETAILS);
      candidates.set(next.username, {
        ...next,
        connections: (current?.connections ?? 0) + 1,
        connectionWeight: Number(((current?.connectionWeight ?? 0) + connectorWeight).toFixed(3)),
        via: [...new Set([...(current?.via ?? []), member.username])].slice(-MAX_VIA_DETAILS),
        viaDetails,
        avatarUrl: current?.avatarUrl || next.avatarUrl,
        displayName: current?.displayName || next.displayName,
      });
    }

    if ((index + 1) % CHECKPOINT_EVERY_CONNECTORS === 0) {
      await saveCheckpoint({
        handle: owner,
        mode: context.mode,
        daySeed,
        startedAt: context.startedAt,
        connectorIndex: index + 1,
        connectors: connectors.map((connector) => connector.username),
        connectorsScanned,
        failedConnectors,
        edges,
        nodes: [...nodes],
        candidates: [...candidates.values()],
        following: directFollowing,
        followers: directFollowers,
      });
    }
  }

  const rankedCandidates = [...candidates.values()].sort(
    (a, b) =>
      b.connectionWeight - a.connectionWeight ||
      b.connections - a.connections ||
      stableHash(`${daySeed}-${a.username}`) - stableHash(`${daySeed}-${b.username}`),
  );
  return {
    nodes: nodes.size,
    edges,
    capped,
    connectorsScanned,
    failedConnectors,
    completedAt: new Date().toISOString(),
    candidateCount: rankedCandidates.length,
    handles: rankedCandidates.map((candidate) => candidate.username),
    candidates: rankedCandidates,
  };
}

function uniqueMembers(members) {
  return [...new Map(members.map((member) => [member.username, member])).values()];
}

function seededShuffle(values, seed) {
  return [...values].sort(
    (a, b) => stableHash(`${seed}-${a.username}`) - stableHash(`${seed}-${b.username}`),
  );
}

function stableHash(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

async function scanList(handle, relationship, onProgress, maxMembers = Number.POSITIVE_INFINITY) {
  const members = new Map();
  const visited = new Set();
  let url = `/${encodeURIComponent(handle)}/${relationship}/`;
  let page = 0;

  while (url && members.size < maxMembers) {
    await assertNotCancelled();
    const absoluteUrl = new URL(url, location.origin).href;
    if (visited.has(absoluteUrl)) {
      throw new ScanFailure(
        "pagination-loop",
        `${relationship} sayfalamasi ${page + 1}. sayfada kendini tekrar etti.`,
        "Letterboxd sayfa yapisi degismis olabilir; sayfayi yenileyip tekrar dene.",
      );
    }
    visited.add(absoluteUrl);
    const response = await fetchPage(url, relationship);
    const html = await response.text();
    if (/Just a moment|Enable JavaScript and cookies to continue/i.test(html)) {
      throw new ScanFailure(
        "cloudflare",
        "Letterboxd tarayici dogrulamasi istedi.",
        "Sekmedeki dogrulamayi tamamla, sonra taramaya kaldigi yerden devam et.",
      );
    }
    const documentPage = new DOMParser().parseFromString(html, "text/html");
    for (const member of parseMembers(documentPage)) {
      members.set(member.username, member);
      if (members.size >= maxMembers) break;
    }
    page += 1;
    onProgress?.({ text: `${relationship}: ${members.size} kisi`, current: members.size, page });
    url = documentPage
      .querySelector('a[rel="next"], .pagination a.next, .paginate-nextprev a.next, .pagination .next a')
      ?.getAttribute("href") ?? "";
    if (url) await delay(PAGE_DELAY_MS);
  }

  return [...members.values()];
}

function parseMembers(documentPage) {
  return [...documentPage.querySelectorAll(".member-table .person-summary, main .person-summary")]
    .map((element) => {
      const name = element.querySelector("a.name, .person-summary-name a");
      const href = name?.getAttribute("href") ?? "";
      const username = href.split("/").filter(Boolean)[0]?.toLowerCase();
      if (!username || !/^[a-z0-9_-]{2,32}$/.test(username)) return undefined;
      const avatarUrl = element.querySelector("img")?.src;
      return { username, displayName: name.textContent.trim() || username, avatarUrl };
    })
    .filter(Boolean);
}

function currentHandle() {
  const handle = location.pathname.split("/").filter(Boolean)[0]?.toLowerCase();
  return /^[a-z0-9_-]{2,32}$/.test(handle ?? "") ? handle : "";
}

function sharePercent(base, span, current, total) {
  if (!Number.isFinite(total) || total <= 0) return Math.round(base + span * 0.5);
  const ratio = Math.max(0, Math.min(1, current / total));
  return Math.round(base + span * ratio);
}

async function expectedCounts(handle) {
  try {
    const { lastScan } = await chrome.storage.local.get("lastScan");
    if (lastScan?.handle !== handle) return {};
    return {
      following: Array.isArray(lastScan.following) ? lastScan.following.length : undefined,
      followers: Array.isArray(lastScan.followers) ? lastScan.followers.length : undefined,
    };
  } catch {
    return {};
  }
}

function notify(payload) {
  lastProgress = { ...payload, updatedAt: new Date().toISOString() };
  chrome.runtime.sendMessage({ type: "scanProgress", payload: lastProgress }).catch(() => {});
}

function startHeartbeat() {
  stopHeartbeat();
  heartbeatTimer = window.setInterval(() => {
    if (!lastProgress) return;
    chrome.runtime
      .sendMessage({ type: "scanProgress", payload: { ...lastProgress, updatedAt: new Date().toISOString(), heartbeat: true } })
      .catch(() => {});
  }, HEARTBEAT_MS);
}

function stopHeartbeat() {
  if (heartbeatTimer) window.clearInterval(heartbeatTimer);
  heartbeatTimer = undefined;
}

window.addEventListener("beforeunload", () => {
  if (!activeScan) return;
  chrome.runtime.sendMessage({
    type: "scanInterrupted",
    payload: {
      ...(lastProgress ?? {}),
      state: "interrupted",
      code: "tab-closed",
      text: "Sekme kapandigi veya yenilendigi icin tarama kesildi.",
      hint: "Ayni profili acip kaldigin yerden devam et.",
      updatedAt: new Date().toISOString(),
    },
  }).catch(() => {});
});

async function assertNotCancelled() {
  if (cancelRequestedLocally) throw new ScanCancelled();
  try {
    const { scanControl } = await chrome.storage.local.get("scanControl");
    if (scanControl?.cancelRequestedAt) throw new ScanCancelled();
  } catch (error) {
    if (error instanceof ScanCancelled) throw error;
  }
}

async function clearControl() {
  try {
    await chrome.storage.local.remove("scanControl");
  } catch {
    // Storage may be unavailable while the tab is closing.
  }
}

async function saveCheckpoint(checkpoint) {
  try {
    const result = await chrome.runtime.sendMessage({ type: "saveCheckpoint", checkpoint });
    if (!result?.ok) return;
  } catch {
    // Losing a checkpoint is not fatal; the scan keeps running in memory.
  }
}

async function loadCheckpoint(handle) {
  try {
    const result = await chrome.runtime.sendMessage({ type: "loadCheckpoint", handle });
    return result?.ok ? result.checkpoint : undefined;
  } catch {
    return undefined;
  }
}

async function clearCheckpoint(handle) {
  try {
    await chrome.runtime.sendMessage({ type: "clearCheckpoint", handle });
  } catch {
    // The app may already be closed.
  }
}

function isBlockingError(error) {
  return error instanceof ScanFailure && ["cloudflare", "rate-limited", "app-offline"].includes(error.code);
}

function describeError(error) {
  if (error instanceof ScanFailure) {
    return { code: error.code, message: error.message, hint: error.hint };
  }
  const raw = String(error?.message ?? error);
  if (/Failed to fetch|NetworkError/i.test(raw)) {
    return {
      code: "network",
      message: "Baglanti kurulamadi.",
      hint: "Internet baglantini ve TasteTwin uygulamasinin acik oldugunu kontrol et.",
    };
  }
  return { code: "unknown", message: raw, hint: "Sayfayi yenileyip tekrar dene." };
}

async function fetchPage(url, relationship) {
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
    await assertNotCancelled();
    const response = await fetch(url, { credentials: "include", cache: "no-store" });
    if (response.ok) return response;
    if (response.status === 404) {
      throw new ScanFailure(
        "not-found",
        `${relationship} sayfasi bulunamadi (404).`,
        "Kullanici adi degismis veya hesap kapanmis olabilir.",
      );
    }
    if (response.status !== 429 || attempt === RETRY_DELAYS_MS.length) {
      if (response.status === 429) {
        throw new ScanFailure(
          "rate-limited",
          "Letterboxd hiz sinirina takildi (429).",
          "15-30 dakika bekleyip kaldigin yerden devam et. Taranan kisim kaydedildi.",
        );
      }
      if (response.status === 403) {
        throw new ScanFailure(
          "forbidden",
          "Letterboxd erisimi reddetti (403).",
          "Letterboxd'a giris yaptigindan emin ol, sayfayi yenile ve devam et.",
        );
      }
      throw new ScanFailure(
        "http-error",
        `${relationship} sayfasi ${response.status} dondu.`,
        "Biraz bekleyip kaldigin yerden devam et.",
      );
    }
    const retryAfter = response.headers.get("Retry-After");
    const retryAt = retryAfter && !/^\d+$/.test(retryAfter) ? Date.parse(retryAfter) - Date.now() : Number(retryAfter) * 1000;
    const waitMs = Math.max(RETRY_DELAYS_MS[attempt], Number.isFinite(retryAt) ? retryAt : 0);
    notify({
      ...(lastProgress ?? {}),
      state: "retry",
      phase: "retry",
      code: String(response.status),
      text: `Letterboxd ${response.status} verdi; ${Math.ceil(waitMs / 1000)} saniye sonra tekrar deneniyor`,
      hint: "Bu normal bir hiz siniri geri cekilmesi. Bekle.",
    });
    await delay(waitMs);
  }
  throw new ScanFailure("http-error", `${relationship} sayfasi alinamadi.`, "Biraz bekleyip tekrar dene.");
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
