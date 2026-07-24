const MAX_NETWORK_NODES = 10000;
const PAGE_DELAY_MS = 1400;
const RETRY_DELAYS_MS = [5000, 12000, 25000];

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "scanTasteTwin") return;
  runScan(message.mode === "network" ? "network" : "social")
    .then(async (payload) => ({ payload, result: await chrome.runtime.sendMessage({ type: "saveBridge", payload }) }))
    .then(({ payload, result }) => {
      if (!result?.ok) throw new Error(result?.error ?? "Could not send scan to TasteTwin");
      notify({ state: "complete", payload });
      sendResponse({ ok: true, payload });
    })
    .catch((error) => {
      notify({ state: "error", message: String(error.message ?? error) });
      sendResponse({ ok: false, error: String(error.message ?? error) });
    });
  return true;
});

async function runScan(mode) {
  const handle = currentHandle();
  if (!handle) throw new Error("Open your Letterboxd profile, Followers, or Following page first.");

  const started = await chrome.runtime.sendMessage({ type: "beginScan", handle, mode });
  if (!started?.ok) throw new Error(started?.error ?? "TasteTwin taramasi baslatilamadi");

  notify({ state: "social", text: "Following taraniyor", current: 0 });
  const following = await scanList(handle, "following", (progress) => notify({ state: "social", ...progress }));
  notify({ state: "social", text: "Followers taraniyor", current: 0 });
  const followers = await scanList(handle, "followers", (progress) => notify({ state: "social", ...progress }));
  const payload = { handle, following, followers, capturedAt: new Date().toISOString() };

  if (mode === "network") {
    payload.network = await scanTwoHopNetwork(handle, following);
  }
  return payload;
}

async function scanTwoHopNetwork(owner, directFollowing) {
  const nodes = new Set([owner, ...directFollowing.map((member) => member.username)]);
  const directHandles = new Set([owner, ...directFollowing.map((member) => member.username)]);
  const candidates = new Map();
  let edges = directFollowing.length;
  let capped = false;

  for (let index = 0; index < directFollowing.length; index += 1) {
    if (nodes.size >= MAX_NETWORK_NODES) {
      capped = true;
      break;
    }
    const member = directFollowing[index];
    notify({
      state: "network",
      text: `Ag taraniyor: ${member.username}`,
      current: index + 1,
      total: directFollowing.length,
      nodes: nodes.size,
    });
    const remaining = MAX_NETWORK_NODES - nodes.size;
    const theirs = await scanList(member.username, "following", undefined, remaining);
    edges += theirs.length;
    for (const next of theirs) {
      nodes.add(next.username);
      if (directHandles.has(next.username)) continue;
      const current = candidates.get(next.username);
      candidates.set(next.username, {
        ...next,
        connections: (current?.connections ?? 0) + 1,
        via: [...new Set([...(current?.via ?? []), member.username])],
        avatarUrl: current?.avatarUrl || next.avatarUrl,
        displayName: current?.displayName || next.displayName,
      });
    }
  }

  const rankedCandidates = [...candidates.values()].sort(
    (a, b) => b.connections - a.connections || a.username.localeCompare(b.username),
  );
  return {
    nodes: nodes.size,
    edges,
    capped,
    handles: rankedCandidates.map((candidate) => candidate.username),
    candidates: rankedCandidates,
  };
}

async function scanList(handle, relationship, onProgress, maxMembers = Number.POSITIVE_INFINITY) {
  const members = new Map();
  const visited = new Set();
  let url = `/${encodeURIComponent(handle)}/${relationship}/`;
  let page = 0;

  while (url && members.size < maxMembers) {
    const absoluteUrl = new URL(url, location.origin).href;
    if (visited.has(absoluteUrl)) throw new Error(`${relationship} pagination repeated at page ${page + 1}`);
    visited.add(absoluteUrl);
    const response = await fetchPage(url, relationship);
    const html = await response.text();
    if (/Just a moment|Enable JavaScript and cookies to continue/i.test(html)) {
      throw new Error("Letterboxd asked for a browser challenge. Complete it in the tab, then retry.");
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

function notify(payload) {
  chrome.runtime.sendMessage({ type: "scanProgress", payload });
}

async function fetchPage(url, relationship) {
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
    const response = await fetch(url, { credentials: "include", cache: "no-store" });
    if (response.ok) return response;
    if (![403, 429].includes(response.status) || attempt === RETRY_DELAYS_MS.length) {
      throw new Error(`${relationship} page failed: ${response.status}`);
    }
    const waitMs = RETRY_DELAYS_MS[attempt];
    notify({ state: "retry", text: `Letterboxd ${response.status} verdi; ${Math.ceil(waitMs / 1000)} saniye sonra tekrar deneniyor` });
    await delay(waitMs);
  }
  throw new Error(`${relationship} page failed`);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
