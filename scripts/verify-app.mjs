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
  };
  const owner = { ...storedOwner, films: [...storedOwner.films, watchlistFilm] };
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
    connectionHandles: ["friendone", "friendtwo", "friendthree"],
    importedAt: new Date().toISOString(),
    source: "rss",
    films: [
      ...owner.films.slice(0, 3).map((film, index) => (index === 2 ? { ...film, rating: 1 } : film)),
      { ...watchlistFilm, watchlist: false, rating: 4.5 },
      ...extras,
    ],
  };
  const following = Array.from({ length: 135 }, (_, index) => ({
    username: `member${String(index).padStart(3, "0")}`,
    displayName: `Member ${index}`,
  }));
  const followers = following.slice(0, 110);
  const social = {
    available: true,
    handle: owner.handle,
    checkedAt: new Date().toISOString(),
    source: "browser-extension",
    complete: true,
    warning: "Verified extension scan",
    counts: { following: 135, followers: 110, mutuals: 110, notFollowingBack: 25, fans: 0 },
    following,
    followers,
    mutuals: followers,
    notFollowingBack: following.slice(110),
    fans: [],
    lostFollowers: [],
    newFollowers: [],
  };
  const nextState = {
    ...state,
    users: [owner, candidate],
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
await page.locator(".tabs button").nth(1).click();
await page.locator(".match-card").first().waitFor();
const coverage = await page.locator(".coverage-line").first().innerText();
const score = Number(await page.locator(".radial-score strong").first().innerText());
if (!coverage.includes("3 filme ikiniz de puan")) throw new Error(`Unexpected coverage text: ${coverage}`);
if (score > 60) throw new Error(`Low-evidence score is still too high: ${score}`);
await page.locator(".match-card").first().click();
await page.locator(".match-dialog").waitFor();
const commonRows = await page.locator(".match-dialog .rating-row:not(.rating-head)").count();
if (commonRows !== 3) throw new Error(`Expected 3 rated common-film rows, found ${commonRows}`);
if ((await page.locator(".match-card .profile-avatar").count()) === 0) throw new Error("Match avatar missing");
if (!(await page.locator(".together-pick").innerText()).includes("Watchlist Only")) {
  throw new Error("Watchlist recommendation missing");
}
if ((await page.locator(".connection-list a").count()) !== 3) throw new Error("Mutual connection list missing");
if ((await page.locator(".negative-impact").count()) !== 1) throw new Error("Divergence penalty missing");
await page.screenshot({ path: screenshotPath.replace(/\.png$/i, "-detail.png") });
await page.locator(".match-dialog .dialog-actions button").click();

await page.locator(".tabs button").nth(2).click();
await page.locator(".social-list").first().waitFor();
const firstSocialTitle = await page.locator(".social-list-title").first().innerText();
if (!firstSocialTitle.includes("135")) throw new Error(`Social total missing: ${firstSocialTitle}`);
if ((await page.locator(".load-more-button").count()) === 0) throw new Error("Social pagination control missing");
await page.locator(".member-search input").first().fill("member134");
if (!(await page.locator(".social-list").first().innerText()).includes("@member134")) {
  throw new Error("Social member search failed");
}

await page.screenshot({ path: screenshotPath, fullPage: true });
await page.setViewportSize({ width: 390, height: 844 });
await page.reload({ waitUntil: "networkidle" });
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
if (overflow > 2) throw new Error(`Mobile horizontal overflow: ${overflow}px`);
const overlay = await page.locator("vite-error-overlay, .vite-error-overlay, #webpack-dev-server-client-overlay").count();
if (overlay) throw new Error("Framework error overlay is visible");
if (consoleErrors.length) throw new Error(`Console errors: ${consoleErrors.join(" | ")}`);

console.log(JSON.stringify({ archiveAfterReload: 900, coverage, score, commonRows, socialTotal: 135, mobileOverflow: overflow }));
await browser.close();
