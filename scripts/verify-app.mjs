import { createRequire } from "node:module";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const screenshotPath = process.env.TASTETWIN_SCREENSHOT ?? "tastetwin-verified.png";
const appUrl = process.env.TASTETWIN_APP_URL;
if (!appUrl) throw new Error("Use npm run test:browser to run against isolated test data");
const { version: appVersion } = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const browser = await chromium.launch({ headless: true, executablePath: process.env.TASTETWIN_CHROMIUM_PATH || undefined });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const consoleErrors = [];

page.on("console", (message) => {
  if (message.type() === "error") consoleErrors.push(message.text());
});
page.on("pageerror", (error) => consoleErrors.push(error.message));

try {
await page.goto(appUrl, { waitUntil: "networkidle" });
await page.evaluate(async () => {
  localStorage.clear();
  await new Promise((resolve) => {
    const request = indexedDB.deleteDatabase("tastetwin");
    request.onsuccess = request.onerror = request.onblocked = () => resolve();
  });
});
await page.reload({ waitUntil: "networkidle" });

const prepareResponsePromise = page.waitForResponse((response) => response.url().endsWith("/api/system/prepare-extension"));
await page.getByRole("button", { name: "Eklenti klasorunu hazirla", exact: true }).click();
const prepareResponse = await prepareResponsePromise;
if (!prepareResponse.ok() || typeof (await prepareResponse.json()).path !== "string") throw new Error("Extension preparation failed after JSON enforcement");

const rows = ["Name,Year,Rating,Letterboxd URI"];
for (let index = 1; index <= 900; index += 1) {
  rows.push(`Film ${index},${1980 + (index % 45)},${index % 5 || 5},https://letterboxd.com/film/film-${index}/`);
}
await page.locator('input[type="file"][accept*=".zip"]').setInputFiles({
  name: "ratings.csv",
  mimeType: "text/csv",
  buffer: Buffer.from(rows.join("\n")),
});
await page.waitForFunction(() => document.querySelector(".source-summary")?.textContent?.includes("900"));
await page.reload({ waitUntil: "networkidle" });
await page.waitForFunction(() => document.querySelector(".source-summary")?.textContent?.includes("900"));

await page.evaluate(async () => {
  const database = await new Promise((resolve, reject) => {
    const request = indexedDB.open("tastetwin");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  let state = await new Promise((resolve, reject) => {
    const request = database.transaction("state", "readonly").objectStore("state").get("app");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  if (state.storageFormat === "profiles-v2") {
    const profiles = await new Promise((resolve, reject) => {
      const request = database.transaction("profiles").objectStore("profiles").getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const byId = new Map(profiles.map(user => [user.id, user]));
    state = { ...state.value, users: state.profileIds.map(id => byId.get(id)) };
  }
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
          watchedDates: [`2025-${String((index % 10) + 1).padStart(2, "0")}-15`],
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
await page.locator(".backup-settings summary").click();
const downloadPromise = page.waitForEvent("download");
await page.getByRole("button", { name: "Tum yerel veriyi yedekle" }).click();
const backupDownload = await downloadPromise;
const backupPath = await backupDownload.path();
const backup = JSON.parse(await readFile(backupPath, "utf8"));
if (
  backup.format !== "tastetwin-backup" ||
  backup.schemaVersion !== 1 ||
  backup.appVersion !== appVersion ||
  backup.state.users.length !== 56 ||
  "tmdbToken" in backup
) {
  throw new Error("Local backup export is incomplete or leaked a token");
}
if (typeof backup.followerBaselines !== "object") throw new Error("Backup is missing follower baselines");

// Personal cloud backup: a sync-client folder (simulated by a temp folder) receives the backup and restores it.
const cloudFolder = await mkdtemp(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".codex-artifacts", "cloud-ui-"));
try {
  await page.getByLabel("Bulut yedek klasoru").fill(cloudFolder);
  await page.locator(".cloud-backup").getByRole("button", { name: "Kaydet", exact: true }).click();
  await page.getByText(/Son yedek:/).waitFor();
  const cloudFiles = await readdir(path.join(cloudFolder, "TasteTwin"));
  if (!cloudFiles.includes("tastetwin-latest.json")) throw new Error("Cloud folder backup was not written");
  const cloudCopy = JSON.parse(await readFile(path.join(cloudFolder, "TasteTwin", "tastetwin-latest.json"), "utf8"));
  if (cloudCopy.state.users.length !== 56 || "tmdbToken" in cloudCopy) throw new Error("Cloud folder backup is incomplete or leaked a token");
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Buluttan geri yukle" }).click();
  await page.getByText(/Yedek geri yuklendi: 56 profil/).waitFor();
  await page.locator(".cloud-backup").getByRole("button", { name: "Kapat", exact: true }).click();
  await page.getByText("Bulut yedegi kapatildi.").waitFor();
} finally {
  await rm(cloudFolder, { recursive: true, force: true });
}
await page.locator(".film-data-health").waitFor();
if (!(await page.locator(".film-data-health").innerText()).includes("film TMDB verili")) {
  throw new Error("Exact film data coverage is missing");
}
await page.locator(".film-workspace-tabs button").filter({ hasText: "Istatistikler" }).click();
await page.locator('[data-testid="film-insights"]').waitFor();
const insightText = await page.locator('[data-testid="film-insights"]').innerText();
if (!insightText.includes("Toplam dakika") || !insightText.includes("1.045 dk") || !insightText.includes("TMDB kapsami")) {
  throw new Error("Film history insight metrics missing");
}
await page.locator(".film-workspace-tabs button").filter({ hasText: "Izleme gecmisi" }).click();
const rhythmText = await page.locator(".viewing-rhythm").innerText();
if (
  !rhythmText.includes("Aylara gore film dagilimi") ||
  !rhythmText.includes("en uzun gun serisi") ||
  !rhythmText.includes("en yogun ay")
) {
  throw new Error("Monthly film distribution missing");
}
await page.locator('[data-testid="film-archive-browser"]').waitFor();
if ((await page.locator(".archive-row").count()) !== 50) throw new Error("Film archive pagination is not rendering 50 rows");
await page.locator(".archive-browser-controls input").fill("Film 899");
if (!(await page.locator('[data-testid="film-archive-browser"]').innerText()).includes("Film 899")) {
  throw new Error("Complete film archive search failed");
}
await page.locator(".archive-browser-controls input").fill("");
await page.locator(".archive-browser-controls select").first().selectOption("watchlist");
if (!(await page.locator('[data-testid="film-archive-browser"]').innerText()).includes("Watchlist Only")) {
  throw new Error("Unwatched watchlist archive filter failed");
}
await page.screenshot({ path: screenshotPath.replace(/\.png$/i, "-history.png"), fullPage: true });
await page.locator(".film-workspace-tabs button").filter({ hasText: "Genel bakis" }).click();
const nextWatchText = await page.locator('[data-testid="next-watch"]').innerText();
if (!nextWatchText.includes("Watchlist Only") || !nextWatchText.includes("verified watchlist synopsis")) {
  throw new Error("TMDB-backed next-watch pick missing");
}
await page.screenshot({ path: screenshotPath.replace(/\.png$/i, "-film.png"), fullPage: true });
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
const csvDownloadPromise = page.waitForEvent("download");
await page.getByRole("button", { name: /Filtrelenenleri CSV indir/ }).click();
const csvDownload = await csvDownloadPromise;
const csvText = await readFile(await csvDownload.path(), "utf8");
if (csvText.trim().split("\r\n").length !== 2057) throw new Error("CSV must export all filtered people across all pages");
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
const filteredCsvPromise = page.waitForEvent("download");
await page.getByRole("button", { name: /Filtrelenenleri CSV indir/ }).click();
const filteredCsv = await readFile(await (await filteredCsvPromise).path(), "utf8");
if (filteredCsv.trim().split("\r\n").length !== 2 || !filteredCsv.includes("member1254")) throw new Error("CSV did not respect the active search filter");
await page.locator(".member-search input").first().fill("");
const activityFilter = page.locator(".social-directory-filters label").filter({ hasText: "Minimum aktiflik" });
if ((await activityFilter.count()) !== 1) throw new Error("Minimum activity filter missing");
await page.getByRole("button", { name: /Bu kriterlerdeki herkesi sec/ }).click();
await page.getByRole("button", { name: /Secilen .* kisiyi listeye ekle/ }).click();
await page.locator('[data-testid="social-review-queue"]').waitFor();
if (!(await page.locator('[data-testid="social-review-queue"]').innerText()).includes("Son tiklama sende kalir")) {
  throw new Error("Filtered social review queue missing");
}
if (!(await page.locator(".queue-tabs").innerText()).includes("1255")) {
  throw new Error("Persistent bulk management queue count missing");
}
await page.request.post(new URL("/api/letterboxd/relationship-event", appUrl).toString(), {
  data: { handle: "member0000", action: "unfollow" },
});
await page.locator(".queue-tabs").filter({ hasText: "Takipten cikilacaklar" }).waitFor();
await page.waitForFunction(() => {
  const text = document.querySelector(".queue-tabs")?.textContent ?? "";
  return text.includes("1254");
});
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
await page.getByLabel("En fazla sure", { exact: true }).selectOption("90");
if ((await page.locator(".together-planner .together-pick").count()) !== 0) throw new Error("92-minute film passed the 90-minute limit");
await page.getByLabel("En fazla sure", { exact: true }).selectOption("120");
if ((await page.locator(".together-planner .together-pick").count()) !== 1) throw new Error("Runtime filter excluded an eligible film");
await page.getByLabel("Sadece ortak watchlist", { exact: true }).check();
if ((await page.locator(".together-planner .together-pick").count()) !== 0) throw new Error("RSS viewing was mislabeled as a mutual watchlist entry");
await page.getByLabel("Sadece ortak watchlist", { exact: true }).uncheck();
if ((await page.locator(".connection-list a").count()) !== 3) throw new Error("Mutual connection list missing");
if ((await page.locator(".negative-impact").count()) !== 1) throw new Error("Divergence penalty missing");
await page.screenshot({ path: screenshotPath.replace(/\.png$/i, "-detail.png") });
await page.setViewportSize({ width: 390, height: 844 });
if (await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2)) throw new Error("Watch-together dialog overflows mobile viewport");
if (await page.locator(".together-planner").evaluate((element) => element.scrollWidth > element.clientWidth + 2)) throw new Error("Watch-together content is clipped inside the mobile dialog");
await page.screenshot({ path: screenshotPath.replace(/\.png$/i, "-detail-mobile.png") });
await page.keyboard.press("Escape");
await page.locator(".match-dialog").waitFor({ state: "detached" });
await page.setViewportSize({ width: 1440, height: 1000 });

await page.getByRole("button", { name: "EN", exact: true }).click();
await page.getByRole("button", { name: /Export filtered CSV/ }).waitFor();
await page.locator(".match-detail-button").first().click();
await page.getByLabel("Maximum runtime", { exact: true }).selectOption("120");
if (!(await page.locator(".together-planner").innerText()).includes("this person rated it 4.5/5")) throw new Error("Watch-together English explanation missing");
await page.keyboard.press("Escape");
await page.getByRole("button", { name: "TR", exact: true }).click();

await page.screenshot({ path: screenshotPath, fullPage: true });
// Restore a portable backup with enough suggestions to exercise real pagination.
const restoredBackup = structuredClone(backup);
const restoredOwner = restoredBackup.state.users.find((user) => user.source === "upload");
const restoredFriend = restoredBackup.state.users.find((user) => user.handle === "member0000");
for (let index = 0; index < 8; index += 1) {
  const suggestion = { key: `shortlist-${index}`, title: `Together ${index}`, year: 2024, watchlist: true, watchedDates: [], rewatches: 0, genres: [], directors: [], countries: [], runtimeMinutes: 80 + index * 10 };
  restoredOwner.films.push(suggestion);
  restoredFriend.films.push({ ...suggestion, watchlist: index === 0, rating: index === 0 ? undefined : 4.5 });
}
await page.locator('input[type="file"][accept*=".json"]').setInputFiles({ name: "tastetwin-backup.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(restoredBackup)) });
await page.getByText(/Yedek geri yuklendi: 56 profil/).waitFor();
await page.reload({ waitUntil: "networkidle" });
await page.locator(".tabs button").nth(1).click();
await page.locator(".member-search input").first().fill("member0000");
await page.locator(".match-detail-button").first().click();
if ((await page.locator(".together-planner .together-pick").count()) !== 6) throw new Error("Shortlist should show six films per page");
await page.getByRole("button", { name: "Sonraki filmler" }).click();
if ((await page.locator(".together-planner .together-pick").count()) !== 3) throw new Error("Shortlist second page lost suggestions");
await page.getByLabel("Sadece ortak watchlist", { exact: true }).check();
if ((await page.locator(".together-planner .together-pick").count()) !== 1 || !(await page.locator(".together-planner").innerText()).includes("Together 0")) throw new Error("Mutual-watchlist filter or pagination reset failed");
await page.getByLabel("Sadece ortak watchlist", { exact: true }).uncheck();
await page.screenshot({ path: screenshotPath.replace(/\.png$/i, "-shortlist.png") });
await page.keyboard.press("Escape");
await page.setViewportSize({ width: 390, height: 844 });
await page.reload({ waitUntil: "networkidle" });
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
if (overflow > 2) throw new Error(`Mobile horizontal overflow: ${overflow}px`);
const overlay = await page.locator("vite-error-overlay, .vite-error-overlay, #webpack-dev-server-client-overlay").count();
if (overlay) throw new Error("Framework error overlay is visible");
if (consoleErrors.length) throw new Error(`Console errors: ${consoleErrors.join(" | ")}`);

console.log(JSON.stringify({ archiveAfterReload: 900, tabs: 2, coverage, score, commonRows, socialTotal: 2056, followerCategory: 1100, mobileOverflow: overflow }));
} catch (error) {
  await page.screenshot({ path: screenshotPath.replace(/\.png$/i, "-failure.png"), fullPage: true }).catch(() => {});
  throw error;
} finally {
  await browser.close();
}
