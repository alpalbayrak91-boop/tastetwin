import { createServer } from "node:http";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { XMLParser } from "fast-xml-parser";
import { load } from "cheerio";
import JSZip from "jszip";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = process.env.TASTETWIN_DIST_DIR
  ? path.resolve(process.env.TASTETWIN_DIST_DIR)
  : path.join(__dirname, "dist");
const dataDir = process.env.TASTETWIN_DATA_DIR
  ? path.resolve(process.env.TASTETWIN_DATA_DIR)
  : path.join(__dirname, "data");
const bridgeCacheFile = path.join(dataDir, "bridge-cache.json");
const preparedExtensionDir = path.join(dataDir, "chrome-extension");
const port = Number(process.env.PORT ?? 5173);
const parser = new XMLParser({
  ignoreAttributes: false,
  trimValues: true,
});
const execFileAsync = promisify(execFile);
const browserUserAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36";
const socialCache = new Map();
const bridgeCache = new Map();
const SOCIAL_CACHE_MS = 5 * 60 * 1000;
const BRIDGE_CACHE_MS = 30 * 24 * 60 * 60 * 1000;
const PUBLIC_SOCIAL_PAGE_LIMIT = 8;

await restoreBridgeCache();

createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "127.0.0.1"}`);

    if (url.pathname === "/api/system/prepare-extension" && req.method === "POST") {
      if (req.headers["x-tastetwin-request"] !== "app") {
        sendJson(res, 403, { error: "app_request_required" });
        return;
      }
      const zip = await JSZip.loadAsync(await readFile(path.join(distDir, "tastetwin-extension.zip")));
      await mkdir(preparedExtensionDir, { recursive: true });
      for (const entry of Object.values(zip.files)) {
        if (entry.dir) continue;
        const relativePath = entry.name.replace(/\\/g, "/");
        if (!relativePath || relativePath.startsWith("/") || relativePath.split("/").includes("..")) {
          throw new Error("Invalid extension ZIP path");
        }
        const destination = path.resolve(preparedExtensionDir, relativePath);
        if (!destination.startsWith(`${path.resolve(preparedExtensionDir)}${path.sep}`)) {
          throw new Error("Invalid extension destination");
        }
        await mkdir(path.dirname(destination), { recursive: true });
        await writeFile(destination, await entry.async("nodebuffer"));
      }
      if (process.platform === "win32" && process.env.TASTETWIN_NO_OPEN !== "1") {
        execFile("explorer.exe", [preparedExtensionDir], () => undefined);
      }
      sendJson(res, 200, { ok: true, path: preparedExtensionDir });
      return;
    }

    if (url.pathname === "/api/letterboxd/rss") {
      const startedAt = Date.now();
      const handles = (url.searchParams.get("handles") ?? "")
        .split(/[,\s]+/)
        .map((handle) => handle.trim().replace(/^@/, ""))
        .filter(Boolean)
        .slice(0, 120);

      if (!handles.length) {
        sendJson(res, 400, { error: "handles_required" });
        return;
      }

      const results = await mapConcurrentSettled(handles, 5, fetchLetterboxdUser);
      const users = results.filter((result) => result.status === "fulfilled").map((result) => result.value);
      const errors = results
        .filter((result) => result.status === "rejected")
        .map((result) => ({ handle: result.input, message: errorMessage(result.reason) }));
      console.log("[rss] complete", { requested: handles.length, loaded: users.length, failed: errors.length, ms: Date.now() - startedAt });
      sendJson(res, 200, { users, errors });
      return;
    }

    if (url.pathname === "/api/letterboxd/social") {
      const startedAt = Date.now();
      const handle = (url.searchParams.get("handle") ?? "").trim().replace(/^@/, "");
      const requestedSource = url.searchParams.get("source") ?? "extension";
      if (!handle) {
        sendJson(res, 400, { error: "handle_required" });
        return;
      }
      let social;
      if (requestedSource === "extension") {
        social = bridgeCache.get(handle.toLowerCase())?.value;
        if (!social) {
          sendJson(res, 404, { error: "extension_scan_required" });
          return;
        }
      } else if (requestedSource === "public") {
        social = await fetchPublicSocial(handle.toLowerCase());
      } else {
        sendJson(res, 400, { error: "invalid_source" });
        return;
      }
      console.log("[social] complete", {
        handle,
        source: social.source,
        following: social.counts?.following,
        followers: social.counts?.followers,
        ms: Date.now() - startedAt,
      });
      sendJson(res, 200, social);
      return;
    }

    if (url.pathname === "/api/letterboxd/bridge" && req.method === "POST") {
      const payload = await readJsonBody(req);
      const social = socialFromExtension(payload);
      bridgeCache.set(social.handle, { savedAt: Date.now(), value: social });
      await persistBridgeCache();
      console.log("[bridge] saved", {
        handle: social.handle,
        following: social.counts.following,
        followers: social.counts.followers,
        network: social.network?.nodes,
      });
      sendJson(res, 200, { ok: true, handle: social.handle, source: social.source });
      return;
    }

    if (url.pathname === "/api/letterboxd/bridge" && req.method === "DELETE") {
      const handle = (url.searchParams.get("handle") ?? "").trim().replace(/^@/, "").toLowerCase();
      if (!/^[a-z0-9_-]{2,32}$/.test(handle)) {
        sendJson(res, 400, { error: "invalid_handle" });
        return;
      }
      bridgeCache.delete(handle);
      await persistBridgeCache();
      sendJson(res, 200, { ok: true, handle });
      return;
    }

    if (url.pathname === "/api/letterboxd/network") {
      const handle = (url.searchParams.get("handle") ?? "").trim().replace(/^@/, "").toLowerCase();
      const bridged = bridgeCache.get(handle)?.value;
      if (!bridged?.networkHandles) {
        sendJson(res, 404, { error: "network_not_scanned" });
        return;
      }
      const offset = Math.max(0, Number.parseInt(url.searchParams.get("offset") ?? "0", 10) || 0);
      const limit = Math.min(120, Math.max(1, Number.parseInt(url.searchParams.get("limit") ?? "120", 10) || 120));
      const candidates = bridged.networkCandidates?.length
        ? bridged.networkCandidates
        : bridged.networkHandles.map((username) => ({ username, displayName: username }));
      const page = candidates.slice(offset, offset + limit);
      sendJson(res, 200, {
        total: candidates.length,
        handles: page.map((member) => member.username),
        members: page,
        nextOffset: offset + limit < candidates.length ? offset + limit : undefined,
      });
      return;
    }

    await serveStatic(url.pathname, res);
  } catch (error) {
    console.error(error);
    sendJson(res, 500, { error: error instanceof Error ? error.message : "server_error" });
  }
}).listen(port, "127.0.0.1", () => {
  console.log(`TasteTwin live server: http://127.0.0.1:${port}/`);
});

async function fetchLetterboxdUser(rawHandle) {
  const handle = rawHandle.toLowerCase();
  if (!/^[a-z0-9_-]{2,32}$/.test(handle)) {
    throw new Error(`Invalid Letterboxd handle: ${rawHandle}`);
  }

  const response = await fetch(`https://letterboxd.com/${encodeURIComponent(handle)}/rss/`, {
    headers: {
      "User-Agent": "TasteTwin/0.2 (+local app)",
      Accept: "application/rss+xml, application/xml;q=0.9, */*;q=0.8",
    },
  });

  if (!response.ok) {
    throw new Error(`Letterboxd RSS failed for ${handle}: ${response.status}`);
  }

  const xml = await response.text();
  const parsed = parser.parse(xml);
  const channel = parsed?.rss?.channel;
  const items = toArray(channel?.item);
  const displayName = String(channel?.title ?? handle).replace(/^Letterboxd\s+-\s+/i, "") || handle;
  const byKey = new Map();

  for (const item of items) {
    const film = filmFromRssItem(item);
    const current = byKey.get(film.key);
    if (current) {
      current.rating = Math.max(current.rating ?? 0, film.rating ?? 0) || current.rating;
      current.liked = current.liked || film.liked;
      current.rewatches += film.rewatches;
      current.watchedDates = [...new Set([...current.watchedDates, ...film.watchedDates])];
      current.review = current.review || film.review;
      current.posterUrl = current.posterUrl || film.posterUrl;
      continue;
    }
    byKey.set(film.key, film);
  }

  return {
    id: `rss-${handle}`,
    handle,
    displayName,
    importedAt: new Date().toISOString(),
    source: "rss",
    films: [...byKey.values()].sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0)),
  };
}

async function fetchLetterboxdSocial(rawHandle) {
  const handle = rawHandle.toLowerCase();
  if (!/^[a-z0-9_-]{2,32}$/.test(handle)) {
    throw new Error(`Invalid Letterboxd handle: ${rawHandle}`);
  }

  const bridged = bridgeCache.get(handle);
  if (bridged && Date.now() - bridged.savedAt < BRIDGE_CACHE_MS) return bridged.value;

  const clientId = process.env.LETTERBOXD_CLIENT_ID;
  const clientSecret = process.env.LETTERBOXD_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return fetchPublicSocial(handle);
  }

  try {
    const token = await getLetterboxdToken(clientId, clientSecret);
    const memberId = await resolveMemberId(handle, token);
    const [following, followers] = await Promise.all([
      fetchMemberList(token, memberId, "IsFollowing"),
      fetchMemberList(token, memberId, "IsFollowedBy"),
    ]);
    return buildSocialResult(handle, following, followers, {
      source: "official-api",
      memberId,
    });
  } catch (error) {
    console.warn("[social] official API failed, using public pages", { handle, error: errorMessage(error) });
    return fetchPublicSocial(handle);
  }
}

function socialFromExtension(payload) {
  if (!payload || typeof payload !== "object") throw new Error("Invalid extension payload");
  const handle = String(payload.handle ?? "").toLowerCase();
  if (!/^[a-z0-9_-]{2,32}$/.test(handle)) throw new Error("Invalid Letterboxd handle");
  const following = normalizeBridgeMembers(payload.following);
  const followers = normalizeBridgeMembers(payload.followers);
  const social = buildSocialResult(handle, following, followers, {
    source: "browser-extension",
    complete: true,
    warning: "Complete graph scanned by the local TasteTwin browser extension. No Letterboxd password was collected.",
  });
  if (typeof payload.capturedAt === "string" && !Number.isNaN(Date.parse(payload.capturedAt))) {
    social.checkedAt = payload.capturedAt;
  }
  const network = payload.network;
  if (network && typeof network === "object") {
    const nodes = Number(network.nodes);
    const edges = Number(network.edges);
    if (Number.isInteger(nodes) && nodes >= 0 && nodes <= 10000 && Number.isInteger(edges) && edges >= 0 && edges <= 100000) {
      social.network = { nodes, edges, capped: Boolean(network.capped) };
    }
    if (Array.isArray(network.handles) && network.handles.length <= 10000) {
      const handles = [...new Set(network.handles.map((value) => String(value).toLowerCase()).filter((value) => /^[a-z0-9_-]{2,32}$/.test(value)))];
      social.networkHandles = handles.filter((value) => value !== handle);
      social.network = {
        nodes: social.networkHandles.length + 1,
        edges: social.network?.edges ?? 0,
        capped: Boolean(network.capped),
      };
    }
    if (Array.isArray(network.candidates) && network.candidates.length <= 10000) {
      const rawByHandle = new Map(
        network.candidates.map((candidate) => [String(candidate?.username ?? "").toLowerCase(), candidate]),
      );
      social.networkCandidates = normalizeBridgeMembers(network.candidates)
        .map((member) => {
          const raw = rawByHandle.get(member.username);
          const via = Array.isArray(raw?.via)
            ? [...new Set(raw.via.map((value) => String(value).toLowerCase()).filter((value) => /^[a-z0-9_-]{2,32}$/.test(value)))].slice(0, 1000)
            : [];
          return {
            ...member,
            connections: Math.max(1, Math.min(10000, Number.parseInt(raw?.connections, 10) || via.length || 1)),
            via,
          };
        })
        .sort((a, b) => b.connections - a.connections || a.username.localeCompare(b.username));
      social.networkHandles = social.networkCandidates.map((member) => member.username);
    }
  }
  return social;
}

function normalizeBridgeMembers(value) {
  if (!Array.isArray(value) || value.length > 10000) throw new Error("Invalid extension member list");
  const members = new Map();
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const username = String(raw.username ?? "").toLowerCase();
    if (!/^[a-z0-9_-]{2,32}$/.test(username)) continue;
    const displayName = String(raw.displayName ?? username).slice(0, 100);
    const avatarUrl = typeof raw.avatarUrl === "string" && raw.avatarUrl.startsWith("https://") ? raw.avatarUrl : undefined;
    members.set(username, { username, displayName, avatarUrl });
  }
  return [...members.values()];
}

async function fetchPublicSocial(handle) {
  const cached = socialCache.get(handle);
  if (cached && Date.now() - cached.savedAt < SOCIAL_CACHE_MS) return cached.value;

  const [followingResult, followersResult] = await Promise.all([
    fetchPublicMemberList(handle, "following"),
    fetchPublicMemberList(handle, "followers"),
  ]);
  const following = followingResult.members;
  const followers = followersResult.members;
  const value = buildSocialResult(handle, following, followers, {
    source: "public-pages",
    complete: followingResult.complete && followersResult.complete,
    warning:
      followingResult.complete && followersResult.complete
        ? "Public Letterboxd pages were read without login."
        : "Letterboxd blocked or limited pagination. These are partial public-page results; use the browser scan for the complete graph.",
  });
  socialCache.set(handle, { savedAt: Date.now(), value });
  return value;
}

function buildSocialResult(handle, following, followers, extra = {}) {
  const followersByName = new Map(followers.map((member) => [member.username.toLowerCase(), member]));
  const followingByName = new Map(following.map((member) => [member.username.toLowerCase(), member]));
  const notFollowingBack = following.filter((member) => !followersByName.has(member.username.toLowerCase()));
  const fans = followers.filter((member) => !followingByName.has(member.username.toLowerCase()));
  const mutuals = following.filter((member) => followersByName.has(member.username.toLowerCase()));

  return {
    available: true,
    handle,
    checkedAt: new Date().toISOString(),
    ...extra,
    counts: {
      following: following.length,
      followers: followers.length,
      mutuals: mutuals.length,
      notFollowingBack: notFollowingBack.length,
      fans: fans.length,
    },
    following,
    followers,
    mutuals,
    notFollowingBack,
    fans,
  };
}

async function fetchPublicMemberList(handle, relationship) {
  const members = new Map();
  let nextPath = `/${encodeURIComponent(handle)}/${relationship}/`;
  let page = 0;
  let complete = true;

  while (nextPath && page < PUBLIC_SOCIAL_PAGE_LIMIT) {
    page += 1;
    let html;
    try {
      html = await fetchLetterboxdHtml(`https://letterboxd.com${nextPath}`);
    } catch (error) {
      if (!members.size) throw error;
      complete = false;
      console.warn("[social] pagination stopped", { handle, relationship, page, error: errorMessage(error) });
      break;
    }
    const $ = load(html);
    const title = $("title").text();
    if (page === 1 && (/page not found/i.test(title) || $(".error-message").length)) {
      throw new Error(`Letterboxd profile not found: ${handle}`);
    }

    $(".member-table .person-summary").each((_, element) => {
      const root = $(element);
      const nameLink = root.find("a.name").first();
      const href = nameLink.attr("href") ?? "";
      const username = href.split("/").filter(Boolean)[0] ?? nameLink.text().trim();
      if (!username || !/^[a-z0-9_-]{2,32}$/i.test(username)) return;
      const displayName = nameLink.text().trim() || username;
      const avatarUrl = normalizeImageUrl(root.find("img").first().attr("src"));
      members.set(username.toLowerCase(), { username, displayName, avatarUrl });
    });

    const next = $(".pagination a.next, .paginate-nextprev a.next").first().attr("href");
    nextPath = next?.startsWith("/") ? next : "";
  }

  if (nextPath) complete = false;

  return { members: [...members.values()], complete };
}

async function fetchLetterboxdHtml(url) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          "User-Agent": browserUserAgent,
          Accept: "text/html,application/xhtml+xml",
          "Accept-Language": "en-US,en;q=0.8",
        },
        signal: AbortSignal.timeout(15000),
      });
      const html = await response.text();
      if (!response.ok) throw new Error(`Letterboxd public page failed: ${response.status}`);
      if (/Just a moment|Enable JavaScript and cookies to continue/i.test(html)) {
        throw new Error("Letterboxd Cloudflare challenge");
      }
      return html;
    } catch (error) {
      lastError = error;
      if (/403|429|Cloudflare challenge/i.test(errorMessage(error))) break;
      if (attempt < 3) await delay(attempt * 450);
    }
  }
  console.warn("[social] fetch blocked, trying curl transport", { url, error: errorMessage(lastError) });
  return fetchLetterboxdHtmlWithCurl(url);
}

async function fetchLetterboxdHtmlWithCurl(url) {
  const command = process.platform === "win32" ? "curl.exe" : "curl";
  const { stdout } = await execFileAsync(
    command,
    [
      "-sS",
      "-L",
      "--fail-with-body",
      "--compressed",
      "--max-time",
      "20",
      "-A",
      browserUserAgent,
      "-H",
      "Accept: text/html,application/xhtml+xml",
      "-H",
      "Accept-Language: en-US,en;q=0.8",
      url,
    ],
    { maxBuffer: 12 * 1024 * 1024 },
  );
  if (/Just a moment|Enable JavaScript and cookies to continue/i.test(stdout)) {
    throw new Error("Letterboxd Cloudflare challenge");
  }
  return stdout;
}

function normalizeImageUrl(value) {
  if (!value) return undefined;
  return value.startsWith("//") ? `https:${value}` : value;
}

async function getLetterboxdToken(clientId, clientSecret) {
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
  });
  const response = await fetch("https://api.letterboxd.com/api/v0/auth/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.access_token) {
    throw new Error(`Letterboxd token failed: ${response.status}`);
  }
  return payload.access_token;
}

async function resolveMemberId(handle, token) {
  const head = await fetch(`https://letterboxd.com/${encodeURIComponent(handle)}/`, {
    method: "HEAD",
    headers: {
      "User-Agent": "TasteTwin/0.2 (+local app)",
    },
  });
  const fromHeader = head.headers.get("x-letterboxd-identifier");
  if (fromHeader) return fromHeader;

  const search = await letterboxdApi(token, `/search?input=${encodeURIComponent(handle)}&include=MemberSearchItem&perPage=10`);
  const item = toArray(search.items).find((entry) => {
    const member = entry.member ?? entry;
    return member.username?.toLowerCase() === handle;
  });
  const member = item?.member ?? item;
  if (!member?.id) throw new Error(`Could not resolve Letterboxd member: ${handle}`);
  return member.id;
}

async function fetchMemberList(token, memberId, relationship) {
  const members = [];
  let cursor = "";
  let pages = 0;

  do {
    const params = new URLSearchParams({
      member: memberId,
      memberRelationship: relationship,
      perPage: "100",
    });
    if (cursor) params.set("cursor", cursor);
    const payload = await letterboxdApi(token, `/members?${params.toString()}`);
    for (const entry of toArray(payload.items)) {
      const member = entry.member ?? entry;
      if (!member?.username) continue;
      members.push({
        id: member.id,
        username: member.username,
        displayName: member.displayName ?? member.username,
        avatarUrl: imageUrl(member.avatar),
      });
    }
    cursor = payload.next ?? "";
    pages += 1;
  } while (cursor && pages < 20);

  return members;
}

async function letterboxdApi(token, path) {
  const response = await fetch(`https://api.letterboxd.com/api/v0${path}`, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Letterboxd API failed: ${response.status}`);
  }
  return payload;
}

function imageUrl(image) {
  if (!image) return undefined;
  if (typeof image === "string") return image;
  return image.sizes?.[0]?.url ?? image.url;
}

function filmFromRssItem(item) {
  const title = text(item["letterboxd:filmTitle"]) || parseTitle(text(item.title)).title;
  const year = number(text(item["letterboxd:filmYear"])) ?? parseTitle(text(item.title)).year;
  const tmdbId = text(item["tmdb:movieId"]);
  const link = text(item.link);
  const rating = number(text(item["letterboxd:memberRating"]));
  const liked = /^yes$/i.test(text(item["letterboxd:memberLike"])) || (rating ?? 0) >= 4;
  const rewatch = /^yes$/i.test(text(item["letterboxd:rewatch"])) ? 1 : 0;
  const description = text(item.description);
  const posterUrl = description.match(/<img[^>]+src="([^"]+)"/i)?.[1];
  const review = cleanDescription(description);
  const key = filmKey(title, year, link);

  return {
    key,
    title,
    year,
    uri: link,
    rating,
    liked,
    review,
    watchedDates: [text(item["letterboxd:watchedDate"])].filter(Boolean),
    rewatches: rewatch,
    watchlist: false,
    genres: [],
    directors: [],
    countries: [],
    posterUrl,
    tmdbId,
  };
}

function parseTitle(value) {
  const match = value.match(/^(.*),\s*(\d{4})/);
  return {
    title: match?.[1]?.trim() || value.replace(/\s+-\s+★.*$/, "").trim() || "Untitled",
    year: match ? number(match[2]) : undefined,
  };
}

function filmKey(title, year, _link) {
  const slug = title
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `film-${slug}-${year ?? "unknown"}`;
}

function cleanDescription(html) {
  return html
    .replace(/<p><img[^>]+><\/p>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/Watched on .*?\./gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function text(value) {
  if (value === undefined || value === null) return "";
  return String(value);
}

function number(value) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function toArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

async function mapConcurrent(values, limit, mapper) {
  const results = [];
  for (let index = 0; index < values.length; index += limit) {
    const chunk = values.slice(index, index + limit);
    results.push(...(await Promise.all(chunk.map(mapper))));
  }
  return results;
}

async function mapConcurrentSettled(values, limit, mapper) {
  const results = [];
  for (let index = 0; index < values.length; index += limit) {
    const chunk = values.slice(index, index + limit);
    const settled = await Promise.allSettled(chunk.map(mapper));
    results.push(...settled.map((result, resultIndex) => ({ ...result, input: chunk[resultIndex] })));
  }
  return results;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

async function restoreBridgeCache() {
  try {
    const saved = JSON.parse(await readFile(bridgeCacheFile, "utf8"));
    if (!saved || typeof saved !== "object") return;
    for (const [handle, entry] of Object.entries(saved)) {
      if (!/^[a-z0-9_-]{2,32}$/.test(handle) || !entry || typeof entry !== "object") continue;
      const savedAt = Number(entry.savedAt);
      if (!Number.isFinite(savedAt) || Date.now() - savedAt >= BRIDGE_CACHE_MS) continue;
      const raw = entry.value;
      const value = socialFromExtension({
        handle,
        following: raw.following,
        followers: raw.followers,
        capturedAt: raw.checkedAt,
        network: Array.isArray(raw.networkHandles)
          ? { ...raw.network, handles: raw.networkHandles, candidates: raw.networkCandidates }
          : undefined,
      });
      value.checkedAt = typeof entry.value.checkedAt === "string" ? entry.value.checkedAt : value.checkedAt;
      bridgeCache.set(handle, { savedAt, value });
    }
    if (bridgeCache.size) console.log("[bridge] restored", { accounts: bridgeCache.size });
  } catch (error) {
    if (error?.code !== "ENOENT") console.warn("[bridge] cache restore failed", errorMessage(error));
  }
}

async function persistBridgeCache() {
  await mkdir(dataDir, { recursive: true });
  const serialized = Object.fromEntries(bridgeCache);
  const temporaryFile = `${bridgeCacheFile}.tmp`;
  await writeFile(temporaryFile, JSON.stringify(serialized), "utf8");
  await rename(temporaryFile, bridgeCacheFile);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function serveStatic(pathname, res) {
  const cleanPath = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.join(distDir, cleanPath);
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(path.resolve(distDir))) {
    sendText(res, 403, "Forbidden", "text/plain");
    return;
  }

  const target = existsSync(resolved) ? resolved : path.join(distDir, "index.html");
  const content = await readFile(target);
  sendText(res, 200, content, mimeType(target));
}

function sendJson(res, status, body) {
  sendText(res, status, JSON.stringify(body), "application/json; charset=utf-8");
}

function sendText(res, status, body, contentType) {
  res.writeHead(status, {
    "Content-Type": contentType,
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(body);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 4 * 1024 * 1024) reject(new Error("Bridge payload too large"));
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(body || "{}"));
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function mimeType(filePath) {
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filePath.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  if (filePath.endsWith(".svg")) return "image/svg+xml";
  if (filePath.endsWith(".png")) return "image/png";
  return "application/octet-stream";
}
