import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const screenshotPath = process.env.TASTETWIN_SCREENSHOT ?? "tastetwin-verified.png";
const appUrl = process.env.TASTETWIN_APP_URL ?? "http://127.0.0.1:5173/";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const consoleErrors = [];

page.on("console", (message) => {
  if (message.type() === "error") consoleErrors.push(message.text());
});
page.on("pageerror", (error) => consoleErrors.push(error.message));

await page.goto(appUrl, { waitUntil: "networkidle" });
await page.evaluate(async () => {
  localStorage.clear();
  await new Promise((resolve) => {
    const request = indexedDB.deleteDatabase("tastetwin");
    request.onsuccess = request.onerror = request.onblocked = () => resolve();
  });
});
await page.reload({ waitUntil: "networkidle" });

const rows = ["Name,Year,Rating,Letterboxd URI"];
for (let index = 1; index <= 900; index += 1) {
  rows.push(`Film ${index},${1980 + (index % 45)},${index % 5 || 5},https://letterboxd.com/film/film-${index}/`);
}
await page.locator('input[type="file"]').setInputFiles({
  name: "ratings.csv",
  mimeType: "text/csv",
  buffer: Buffer.from(rows.join("\n")),
});
await page.waitForFunction(() => document.querySelector(".source-summary")?.textContent?.includes("900"));
await page.reload({ waitUntil: "networkidle" });
await page.waitForFunction(() => document.querySelector(".source-summary")?.textContent?.includes("900"));

await page.evaluate(async () => {
  const database = await new Promise((resolve, reject) => {
    const request = indexedDB.open("tastetwin", 1);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const state = await new Promise((resolve, reject) => {
    const request = database.transaction("state", "readonly").objectStore("state").get("app");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const storedOwner = state.users.find((user) => user.source === "upload");
  const watchlistFilm = {
    key: "film-watchlist-only-2024",
    title: "Watchlist Only",
    year: 2024,
    watchlist: true,
    watchedDates: [],
    rewatches: 0,
    genres: [],
    directors: [],
    countries: [],
    runtimeMinutes: 92,
    cast: ["Watch Star"],
    originalLanguage: "en",
    overview: "A verified watchlist synopsis.",
    tmdbId: "999001",
  };
  const enrichedOwnerFilms = storedOwner.films.map((film, index) =>
    index < 10
      ? {
          ...film,
          runtimeMinutes: 100 + index,
          genres: index % 2 ? ["Drama"] : ["Comedy"],
          directors: ["Verified Director"],
          cast: ["Verified Actor", `Actor ${index}`],
          originalLanguage: index % 2 ? "tr" : "en",
          overview: `Verified overview ${index}`,
          tmdbId: String(1000 + index),
        }
      : film,
  );
  const owner = { ...storedOwner, films: [...enrichedOwnerFilms, watchlistFilm] };
  const extras = Array.from({ length: 17 }, (_, index) => ({
    key: `candidate-${index}`,
    title: `Candidate ${index}`,
    year: 2000 + index,
    rating: 4.5,
    watchedDates: [],
    rewatches: 0,
    genres: [],
    directors: [],
    countries: [],
  }));
  const candidate = {
    id: "rss-candidate",
    handle: "candidate",
    displayName: "Candidate",
    avatarUrl: "/brand/tastetwin-icon.png",
    networkConnections: 3,
    networkConnectionWeight: 1.25,
    connectionHandles: ["friendone", "friendtwo", "friendthree"],
    connectionDetails: ["friendone", "friendtwo", "friendthree"].map((handle, index) => ({
      handle,
      displayName: `Friend ${index + 1}`,
      avatarUrl: "/brand/tastetwin-icon.png",
      followingCount: 100 + index * 50,
      weight: 0.4,
    })),
    lastActivityAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
    activity30Days: 7,
    activity90Days: 15,
    activityScore: 82,
    importedAt: new Date().toISOString(),
    source: "rss",
    films: [
      ...owner.films.slice(0, 3).map((film, index) => (index === 2 ? { ...film, rating: 1 } : film)),
      { ...watchlistFilm, watchlist: false, rating: 4.5 },
      ...extras,
    ],
  };
  const following = Array.from({ length: 1255 }, (_, index) => ({
    username: `member${String(index).padStart(4, "0")}`,
    displayName: `Member ${index}`,
  }));
  const followers = following.slice(0, 1100);
  const networkCandidates = Array.from({ length: 800 }, (_, index) => ({
    username: `network${String(index).padStart(4, "0")}`,
    displayName: `Network ${index}`,
    connections: 1 + (index % 12),
    connectionWeight: 0.1 + (index % 10) / 10,
    via: ["member0000"],
  }));
  const social = {
    available: true,
    handle: owner.handle,
    checkedAt: new Date().toISOString(),
    previousCheckedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    source: "browser-extension",
    complete: true,
    warning: "Verified extension scan",
    counts: { following: 1255, followers: 1100, mutuals: 1100, notFollowingBack: 155, fans: 0 },
    following,
    followers,
    mutuals: followers,
    notFollowingBack: following.slice(1100),
    fans: [],
    lostFollowers: [{ username: "lostmember", displayName: "Lost Member" }],
    newFollowers: [{ username: "member0000", displayName: "Member 0" }],
    network: { nodes: 2056, edges: 4000, capped: false, candidateCount: 800, connectorsScanned: 40 },
    networkCandidates,
  };
  const nextState = {
    ...state,
    users: [
      owner,
      ...Array.from({ length: 55 }, (_, index) => ({
        ...candidate,
        id: `rss-candidate-${index}`,
        handle: `member${String(index).padStart(4, "0")}`,
        displayName: `Member ${index}`,
      })),
    ],
    activeId: owner.id,
    accountHandle: owner.handle,
    socialByHandle: { [owner.handle]: social },
  };
  await new Promise((resolve, reject) => {
    const transaction = database.transaction("state", "readwrite");
    transaction.objectStore("state").put(nextState, "app");
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  database.close();
});

await page.reload({ waitUntil: "networkidle" });
if ((await page.locator(".tabs button").count()) !== 2) throw new Error("The app should expose only Film and Social tabs");
if ((await page.getByText("Paylasim karti", { exact: true }).count()) !== 0) throw new Error("Share card tab is still visible");
if ((await page.getByText("Zevk eslesmeleri", { exact: true }).count()) !== 0) throw new Error("Separate taste-match tab is still visible");
await page.locator('[data-testid="film-insights"]').waitFor();
const insightText = await page.locator('[data-testid="film-insights"]').innerText();
if (!insightText.includes("Izleme suresi") || !insightText.includes("TMDB kapsami")) {
  throw new Error("Film history insight metrics missing");
}
const nextWatchText = await page.locator('[data-testid="next-watch"]').innerText();
if (!nextWatchText.includes("Watchlist Only") || !nextWatchText.includes("verified watchlist synopsis")) {
  throw new Error("TMDB-backed next-watch pick missing");
}
await page.locator(".tabs button").nth(1).click();
await page.locator(".social-directory").waitFor();
await page.locator(".match-detail-button").first().waitFor();
const directoryTitle = await page.locator(".social-directory-title").innerText();
if (!directoryTitle.includes("2056")) throw new Error(`Social directory total missing: ${directoryTitle}`);
if (!(await page.locator(".directory-pagination").innerText()).includes("1/21")) {
  throw new Error("Social directory pagination missing");
}
if ((await page.locator(".social-directory-list li").count()) !== 100) {
  throw new Error("Social directory page size is wrong");
}
await page.locator(".directory-pagination button").last().click();
if (!(await page.locator(".directory-pagination").innerText()).includes("2/21")) {
  throw new Error("Social directory next page failed");
}
if (!(await page.locator(".history-explainer").innerText()).includes("arasinda degismis olabilir")) {
  throw new Error("Follower-change time window missing");
}
const categoryButtons = page.locator(".social-category-grid button");
if ((await categoryButtons.count()) !== 9) throw new Error("Social category buttons are incomplete");
await categoryButtons.filter({ hasText: "Takipcilerin" }).click();
if (!(await page.locator(".directory-summary").innerText()).includes("1100 kisi")) {
  throw new Error("Clickable follower category does not include the full list");
}
await categoryButtons.filter({ hasText: "Yeni takipci" }).click();
if (!(await page.locator(".directory-summary").innerText()).includes("1 kisi")) throw new Error("New follower category failed");
await categoryButtons.filter({ hasText: "Takipten cikan" }).click();
if (!(await page.locator(".directory-summary").innerText()).includes("1 kisi")) throw new Error("Lost follower category failed");
await categoryButtons.filter({ hasText: "Tum sosyal veriler" }).click();
await page.locator(".member-search input").first().fill("member1254");
if (!(await page.locator(".social-directory").innerText()).includes("@member1254")) {
  throw new Error("Social member search failed");
}
if (!(await page.locator(".social-directory-list .profile-arrow").first().getAttribute("href"))?.includes("letterboxd.com/member1254")) {
  throw new Error("Social directory Letterboxd link missing");
}
await page.locator(".member-search input").first().fill("");
const activityFilter = page.locator(".social-directory-filters label").filter({ hasText: "Minimum aktiflik" });
if ((await activityFilter.count()) !== 1) throw new Error("Minimum activity filter missing");
await page.locator('[data-testid="social-action-workbench"] .workbench-summary').click();
if (!(await page.locator('[data-testid="social-action-workbench"]').innerText()).includes("Maksimum aktiflik")) {
  throw new Error("Activity-aware social action rules missing");
}
await page.locator(".member-search input").first().fill("member0000");
const score = Number(await page.locator(".directory-score strong").first().innerText());
await page.locator(".match-detail-button").first().click();
await page.locator(".match-dialog").waitFor();
const commonRows = await page.locator(".match-dialog .rating-row:not(.rating-head)").count();
const coverage = await page.locator(".coverage-line").first().innerText();
if (commonRows !== 3 || !coverage.includes("3 ortak puanli film")) {
  throw new Error(`Social taste detail is incomplete: ${JSON.stringify({ commonRows, coverage })}`);
}
if (!(await page.locator(".together-pick").first().innerText()).includes("Watchlist Only")) {
  throw new Error("Watchlist recommendation missing");
}
if ((await page.locator(".connection-list a").count()) !== 3) throw new Error("Mutual connection list missing");
if ((await page.locator(".negative-impact").count()) !== 1) throw new Error("Divergence penalty missing");
await page.screenshot({ path: screenshotPath.replace(/\.png$/i, "-detail.png") });
await page.locator(".match-dialog .dialog-actions button").click();

await page.screenshot({ path: screenshotPath, fullPage: true });
await page.setViewportSize({ width: 390, height: 844 });
await page.reload({ waitUntil: "networkidle" });
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
if (overflow > 2) throw new Error(`Mobile horizontal overflow: ${overflow}px`);
const overlay = await page.locator("vite-error-overlay, .vite-error-overlay, #webpack-dev-server-client-overlay").count();
if (overlay) throw new Error("Framework error overlay is visible");
if (consoleErrors.length) throw new Error(`Console errors: ${consoleErrors.join(" | ")}`);

console.log(JSON.stringify({ archiveAfterReload: 900, tabs: 2, coverage, score, commonRows, socialTotal: 2056, followerCategory: 1100, mobileOverflow: overflow }));
await browser.close();
