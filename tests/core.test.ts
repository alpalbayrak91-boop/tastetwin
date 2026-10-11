import test from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { mergeFilmArchive, preserveFilmMetadata } from "../src/lib/film-archive";
import { readLetterboxdExport } from "../src/lib/letterboxd";
import { buildMatches, buildMatchesAsync, buildRecommendations, rankAgreement, ratingProfile, scoreRatingPair } from "../src/lib/taste";
import { buildFilmInsights, isWatched } from "../src/lib/film-insights";
import type { FilmSignal, UserTaste } from "../src/types";
import { buildWatchTogetherPicks, filterWatchTogetherPicks, togetherPickReason } from "../src/lib/watch-together";
import { socialDirectoryCsv } from "../src/lib/social-export";
import { archiveCsv, archiveFacet, buildNetworkRatings, defaultArchiveFilters, filterArchive, type ArchiveFilters } from "../src/lib/archive-filters";
import { buildFilmCatalog, filmPeopleCsv, findPeopleByFilms, defaultFilmPeopleOptions, searchFilmCatalog } from "../src/lib/film-people";
import { pickRatingsTargets, scrapedMembersToUsers } from "../src/lib/full-ratings";
import { computeFollowerChanges, followerEventsCsv, type FollowerScan } from "../src/lib/follower-history";
import { buildSocialDirectory, filterAndSortSocialDirectory, paginateSocialDirectory, type SocialDirectoryFilters } from "../src/lib/social-directory";

function film(key: string, overrides: Partial<FilmSignal> = {}): FilmSignal {
  return { key, title: key, watchedDates: [], rewatches: 0, genres: [], directors: [], countries: [], ...overrides };
}
function user(handle: string, films: FilmSignal[]): UserTaste {
  return { id: handle, handle, displayName: handle, source: "upload", importedAt: "2026-09-26T00:00:00Z", films };
}
test("RSS refresh retains history, lower ratings, metadata and diary counts without duplicates", () => {
  const old = user("owner", [film("old"), film("same", { rating: 5, tmdbId: "123", runtimeMinutes: 90, watchlist: true, watchedDates: ["2026-09-01", "2026-09-01"] })]);
  const incoming = { ...user("owner", [film("same", { rating: 2, watchedDates: ["2026-09-01", "2026-09-26"] }), film("new")]), source: "rss" as const };
  const merged = mergeFilmArchive(old, incoming);
  assert.equal(merged.source, "upload");
  assert.equal(merged.films.length, 3);
  const same = merged.films.find(f => f.key === "same")!;
  assert.equal(same.rating, 2);
  assert.equal(same.tmdbId, "123");
  assert.equal(same.runtimeMinutes, 90);
  assert.equal(same.watchlist, true);
  assert.deepEqual(same.watchedDates, ["2026-09-01", "2026-09-01", "2026-09-26"]);
  assert.deepEqual(mergeFilmArchive(merged, incoming).films, merged.films);
});

test("fresh export preserves metadata but replaces personal signals", () => {
  const old = user("owner", [film("same", { rating: 5, liked: true, watchlist: true, genres: ["Drama"], tmdbId: "42" }), film("removed")]);
  const fresh = preserveFilmMetadata(user("owner", [film("same", { rating: 2, liked: false })]), old);
  assert.equal(fresh.films.length, 1);
  assert.equal(fresh.films[0].rating, 2);
  assert.equal(fresh.films[0].liked, false);
  assert.equal(fresh.films[0].watchlist, undefined);
  assert.deepEqual(fresh.films[0].genres, ["Drama"]);
  assert.equal(fresh.films[0].tmdbId, "42");
  assert.equal(preserveFilmMetadata(user("someone_else", [film("same")]), old).films[0].tmdbId, undefined);
});

async function archive(files: Record<string, string>) {
  const zip = new JSZip();
  for (const [name, contents] of Object.entries(files)) zip.file(name, contents);
  return readLetterboxdExport(new File([await zip.generateAsync({ type: "uint8array" })], "export.zip"), "owner");
}

test("CSV supports empty fields, quoted commas and multiline reviews", async () => {
  const result = await readLetterboxdExport(new File(['Name,Year,Rating,Review\n"A, Film",2020,4.5,"line one\nline ""two"""'], "reviews.csv"));
  assert.equal(result.films[0].title, "A, Film");
  assert.equal(result.films[0].review, 'line one\nline "two"');
});

test("full ZIP preserves current ratings and does not double-count a reviewed rewatch", async () => {
  const result = await archive({
    "ratings.csv": "Name,Year,Rating\nFilm,2020,4.5",
    "diary.csv": "Name,Year,Rating,Watched Date,Rewatch\nFilm,2020,2,2024-01-01,No\nFilm,2020,3,2025-01-01,Yes",
    "reviews.csv": "Name,Year,Rating,Watched Date,Rewatch,Review\nFilm,2020,3,2025-01-01,Yes,Review",
    "watched.csv": "Name,Year,Date\nFilm,2020,2026-09-01",
  });
  assert.equal(result.films[0].rating, 4.5);
  assert.equal(result.films[0].rewatches, 1);
  assert.deepEqual(result.films[0].watchedDates, ["2024-01-01", "2025-01-01"]);
  assert.equal(buildFilmInsights(result, "en").totalViews, 2);
});

test("ZIP is supported in Node and browsers without relying on FileReader", async () => {
  assert.equal((await archive({ "ratings.csv": "Name,Year,Rating\nFilm,2020,4" })).films.length, 1);
});

test("watched.csv records watched status without inventing diary dates", async () => {
  const result = await readLetterboxdExport(new File(["Name,Year,Date\nFilm,2020,2026-09-01"], "watched.csv"));
  assert.equal(isWatched(result.films[0]), true);
  assert.equal(buildFilmInsights(result, "en").diaryEntries, 0);
});

test("diary import uses the latest dated rating regardless of row order", async () => {
  const result = await readLetterboxdExport(new File(["Name,Year,Rating,Watched Date\nFilm,2020,4.5,2025-01-01\nFilm,2020,2,2024-01-01"], "diary.csv"));
  assert.equal(result.films[0].rating, 4.5);
});

test("empty or unrelated CSV cannot silently replace an archive", async () => {
  await assert.rejects(readLetterboxdExport(new File(["Username,URL\nowner,https://letterboxd.com/owner/"], "profile.csv")));
});

test("only co-rated films contribute evidence and asynchronous matching agrees", async () => {
  const owner = user("owner", [film("rated", { rating: 4 }), film("watchlist", { watchlist: true }), film("unrated", { watchedDates: ["2025-01-01"] })]);
  const candidate = user("candidate", owner.films.map((f) => ({ ...f, rating: 4 })));
  const matches = buildMatches(owner, [candidate]);
  assert.equal(matches[0].commonCount, 1);
  assert.deepEqual(await buildMatchesAsync(owner, [candidate]), matches);
});

test("rating sentiment and sparse evidence retain their intended meaning", () => {
  assert.ok(scoreRatingPair(2, 4) < scoreRatingPair(3, 5));
  assert.ok(scoreRatingPair(3, 5) < scoreRatingPair(0.5, 2.5));
  const match = buildMatches(user("owner", [film("one", { rating: 5 })]), [user("candidate", [film("one", { rating: 5 })])])[0];
  assert.ok(match.score > 50 && match.score < match.rawScore);
});

test("watch-together excludes watched films even when still marked watchlist", () => {
  const owner = user("owner", [film("already seen", { rating: 5, watchlist: true }), film("unseen", { watchlist: true })]);
  const candidate = user("candidate", [film("already seen", { watchlist: true }), film("unseen", { rating: 4.5 })]);
  assert.equal(buildMatches(owner, [candidate])[0].togetherPick?.film.key, "unseen");
});

test("recommendations can include unseen watchlist entries", () => {
  const owner = user("owner", [film("seed", { rating: 4 }), film("unseen", { watchlist: true })]);
  const candidate = user("candidate", [film("seed", { rating: 4 }), film("unseen", { rating: 4.5 })]);
  assert.equal(buildRecommendations(owner, buildMatches(owner, [candidate]))[0]?.film.key, "unseen");
});

test("same-day diary viewings survive, while invalid ratings never become evidence", async () => {
  const result = await readLetterboxdExport(new File(["Name,Year,Rating,Watched Date,Rewatch\nFilm,2020,0,2025-01-01,No\nFilm,2020,6,2025-01-01,Yes"], "diary.csv"));
  assert.equal(result.films[0].rating, undefined);
  assert.equal(result.films[0].watchedDates.length, 2);
  assert.equal(buildFilmInsights(result, "en").diaryEntries, 2);
});

test("watch-together ranks mutual list, friend loves, then explainable shared-taste signals", () => {
  const seed = film("seed", { rating: 5, tmdbRecommendations: ["42"], directors: ["Director"] });
  const owner = user("owner", [seed, film("mutual", { watchlist: true, runtimeMinutes: 90 }), film("loved", { watchlist: true }), film("fit", { watchlist: true, tmdbId: "42", runtimeMinutes: 120 }), film("disliked", { watchlist: true, directors: ["Director"] }), film("no evidence", { watchlist: true })]);
  const friend = user("friend", [seed, film("mutual", { watchlist: true }), film("loved", { rating: 4.5 }), film("disliked", { rating: 2 })]);
  owner.films.push(film("watched without rating", { watchlist: true, directors: ["Director"] }));
  friend.films.push(film("watched without rating", { watched: true }));
  const picks = buildWatchTogetherPicks(owner, friend, buildMatches(owner, [friend])[0].commonFilms);
  assert.deepEqual(picks.map((pick) => pick.film.key), ["mutual", "loved", "fit"]);
  assert.equal(picks[2].signal, "recommendation");
  assert.match(togetherPickReason(picks[2], "en"), /unknown/);
  assert.match(togetherPickReason(picks[1], "tr"), /4.5\/5/);
  assert.deepEqual(filterWatchTogetherPicks(picks, 90).map((pick) => pick.film.key), ["mutual"]);
  assert.deepEqual(filterWatchTogetherPicks(picks, 0, true).map((pick) => pick.film.key), ["mutual"]);
  assert.equal(filterWatchTogetherPicks(picks, 60).length, 0);
});

test("friend's watched watchlist film is not mislabeled as unseen mutual watchlist", () => {
  const picks = buildWatchTogetherPicks(user("owner", [film("movie", { watchlist: true })]), user("friend", [film("movie", { watchlist: true, rating: 4.5 })]), []);
  assert.equal(picks[0].kind, "your-watchlist-they-loved");
});

const defaultFilters: SocialDirectoryFilters = { query: "", myFollow: "any", followsMe: "any", source: "all", activity: "any", activityAge: "any", category: "all", minTaste: 0, maxTaste: 100, minActivity: 0, maxActivity: 100, minConnections: 0, maxConnections: 9999, sort: "name" };

test("social directory includes unrated accounts, normalizes handles and independently filters both directions", () => {
  const entries = buildSocialDirectory({ following: [{ username: "Alice", displayName: "Alice" }], followers: [{ username: "alice", displayName: "Alice" }, { username: "bob", displayName: "Bob" }], newFollowers: [], lostFollowers: [], networkCandidates: [{ username: "carol", displayName: "Carol" }] }, []);
  assert.equal(entries.length, 3);
  assert.deepEqual(filterAndSortSocialDirectory(entries, { ...defaultFilters, myFollow: "no", followsMe: "yes" }).map((entry) => entry.username), ["bob"]);
  assert.deepEqual(filterAndSortSocialDirectory(entries, { ...defaultFilters, source: "network" }).map((entry) => entry.username), ["carol"]);
  assert.equal(paginateSocialDirectory(entries, 99, 2).page, 2);
  assert.equal(paginateSocialDirectory(entries, 99, 2).items.length, 1);
});

test("social CSV exports all supplied rows, preserves Unicode and quotes spreadsheet formulas", () => {
  const entries = buildSocialDirectory({ following: [{ username: "alice", displayName: 'Çağrı, "film"' }, { username: "bob", displayName: '=HYPERLINK("bad")' }], followers: [], newFollowers: [], lostFollowers: [] }, []);
  const csv = socialDirectoryCsv(entries, "tr");
  assert.ok(csv.startsWith("\uFEFF"));
  assert.match(csv, /"Çağrı, ""film"""/);
  assert.match(csv, /"'=HYPERLINK/);
  assert.equal(csv.trim().split("\r\n").length, 3);
  assert.match(csv, /"Evet","Hayir","","","","",""/);
});

function followerScan(checkedAt: string, names: string[], overrides: Partial<FollowerScan> = {}): FollowerScan {
  const followers = names.map((username) => ({ username, displayName: username.toUpperCase() }));
  return { checkedAt, complete: true, scanStage: "social-complete", followers, counts: { following: 10, followers: followers.length, mutuals: 3 }, ...overrides };
}

test("follower history records who followed and unfollowed between complete scans", () => {
  const first = computeFollowerChanges(followerScan("2026-10-01T10:00:00Z", ["ada", "bora"]), undefined, []);
  assert.equal(first.changes.followerEvents.length, 0, "the first scan is only a baseline");
  const second = computeFollowerChanges(followerScan("2026-10-05T10:00:00Z", ["bora", "cem"]), first.snapshot, first.changes.followerEvents);
  assert.deepEqual(second.changes.newFollowers.map((m) => m.username), ["cem"]);
  assert.deepEqual(second.changes.lostFollowers.map((m) => m.username), ["ada"]);
  assert.deepEqual(second.changes.followerEvents.map((e) => [e.username, e.kind, e.since]), [
    ["cem", "followed", "2026-10-01T10:00:00Z"],
    ["ada", "unfollowed", "2026-10-01T10:00:00Z"],
  ]);
  const third = computeFollowerChanges(followerScan("2026-10-09T10:00:00Z", ["bora", "cem", "ada"]), second.snapshot, second.changes.followerEvents);
  assert.equal(third.changes.followerEvents.length, 3, "a returning follower is a new event, earlier ones are kept");
  assert.equal(third.changes.history.length, 3);
});

test("re-polling the same scan keeps new and lost followers instead of wiping them", () => {
  const first = computeFollowerChanges(followerScan("2026-10-01T10:00:00Z", ["ada", "bora"]), undefined, []);
  const scan = followerScan("2026-10-05T10:00:00Z", ["bora", "cem"]);
  const second = computeFollowerChanges(scan, first.snapshot, []);
  const repeated = computeFollowerChanges(scan, second.snapshot, second.changes.followerEvents);
  assert.equal(repeated.snapshot, undefined, "the stored snapshot is left alone");
  assert.deepEqual(repeated.changes.lostFollowers.map((m) => m.username), ["ada"]);
  assert.deepEqual(repeated.changes.newFollowers.map((m) => m.username), ["cem"]);
  assert.equal(repeated.changes.history.length, 2);
  assert.equal(repeated.changes.followerEvents.length, 2);
  assert.equal(repeated.changes.previousCheckedAt, "2026-10-01T10:00:00Z");

  const network = computeFollowerChanges({ ...scan, checkedAt: "2026-10-05T12:00:00Z", scanStage: "network-complete", network: { candidateCount: 40 } }, second.snapshot, second.changes.followerEvents);
  assert.deepEqual(network.changes.lostFollowers.map((m) => m.username), ["ada"]);
  assert.equal(network.changes.history.length, 2);
  assert.equal(network.changes.history[1].networkCandidates, 40);
  assert.equal(second.snapshot!.history![1].networkCandidates, undefined, "the earlier snapshot is not mutated");
});

test("partial scans never become the comparison baseline", () => {
  const first = computeFollowerChanges(followerScan("2026-10-01T10:00:00Z", ["ada", "bora"]), undefined, []);
  const partial = computeFollowerChanges(followerScan("2026-10-02T10:00:00Z", ["ada"], { complete: false }), first.snapshot, []);
  assert.equal(partial.snapshot, undefined);
  assert.equal(partial.changes.lostFollowers.length, 0);
});

test("follower history CSV is newest first and neutralizes spreadsheet formulas", () => {
  const first = computeFollowerChanges(followerScan("2026-10-01T10:00:00Z", ["ada"]), undefined, []);
  const second = computeFollowerChanges(followerScan("2026-10-05T10:00:00Z", ["=cmd"]), first.snapshot, []);
  const csv = followerEventsCsv(second.changes.followerEvents, "tr");
  const lines = csv.trim().split("\r\n");
  assert.equal(lines.length, 3);
  assert.match(lines[1], /Takipten cikti/);
  assert.match(lines[2], /^"'=cmd"/);
});

test("relative rank agreement treats a harsh rater who orders films the same way as a match", () => {
  const ratings = [5, 4.5, 4.5, 4, 4, 3.5, 3.5, 3, 3, 2.5, 2, 1.5];
  const owner = user("owner", ratings.map((rating, index) => film(`f${index}`, { rating })));
  const harsh = user("harsh", ratings.map((rating, index) => film(`f${index}`, { rating: Math.max(0.5, rating - 1.5) })));
  const shuffled = user("shuffled", ratings.map((_, index) => film(`f${index}`, { rating: Math.max(0.5, ratings[(index * 5) % ratings.length] - 1.5) })));
  const [harshMatch] = buildMatches(owner, [harsh]);
  const [shuffledMatch] = buildMatches(owner, [shuffled]);
  assert.ok(harshMatch.relativeScore! >= 95, "same ordering on a lower scale is near-perfect rank agreement");
  assert.ok(harshMatch.rawScore > harshMatch.absoluteScore!, "rank agreement lifts the raw affinity");
  assert.ok(harshMatch.ratingBias! < -1.3);
  assert.ok(shuffledMatch.relativeScore! < harshMatch.relativeScore!);
  assert.ok(harshMatch.score > shuffledMatch.score);
});

test("relative agreement stays out of sparse comparisons and flat raters", () => {
  const owner = user("owner", [film("a", { rating: 5 }), film("b", { rating: 3 })]);
  assert.equal(buildMatches(owner, [user("c", [film("a", { rating: 5 }), film("b", { rating: 3 })])])[0].relativeScore, undefined);
  assert.equal(rankAgreement([[0.2, 0.5], [0.8, 0.5]]), undefined);
  const profile = ratingProfile(user("p", [film("x", { rating: 2 }), film("y", { rating: 4 }), film("z", { rating: 4 })]));
  assert.equal(profile.percentile(2), 1 / 6);
  assert.equal(profile.percentile(4), (1 + 1) / 3);
});

test("archive filters combine metadata, ranges, diary year and network ratings", () => {
  const owner = user("owner", [
    film("a", { rating: 4.5, year: 1999, genres: ["Drama"], directors: ["Lynch"], watchedDates: ["2025-03-01"], runtimeMinutes: 140 }),
    film("b", { rating: 2, year: 2010, genres: ["Comedy"], watchedDates: ["2026-01-02"], runtimeMinutes: 90 }),
    film("c", { watchlist: true, year: 2020, genres: ["Drama"] }),
    film("d", { watched: true, year: 2001, rewatches: 1 }),
  ]);
  const friend = user("friend", [film("a", { rating: 2 }), film("b", { rating: 4 }), film("c", { rating: 5 })]);
  const other = user("other", [film("c", { rating: 4 })]);
  const network = buildNetworkRatings(owner, [owner, friend, other]);
  assert.equal(network.get("c")?.mean, 4.5);
  assert.equal(network.get("c")?.count, 2);
  assert.equal(network.has("d"), false);
  const run = (patch: Partial<ArchiveFilters>) => filterArchive(owner.films, { ...defaultArchiveFilters, ...patch }, network).map((f) => f.key);
  assert.deepEqual(run({ genre: "Drama", sort: "title" }), ["a", "c"]);
  assert.deepEqual(run({ minRating: 4 }), ["a"]);
  assert.deepEqual(run({ yearFrom: 2000, yearTo: 2015, sort: "year" }), ["b", "d"]);
  assert.deepEqual(run({ watchedYear: 2026 }), ["b"]);
  assert.deepEqual(run({ maxRuntime: 100 }), ["b"]);
  assert.deepEqual(run({ status: "unrated-watched" }), ["d"]);
  assert.deepEqual(run({ status: "watchlist", minNetworkRatings: 2 }), ["c"]);
  assert.deepEqual(run({ query: "lynch" }), ["a"]);
  assert.deepEqual(run({ sort: "network" }).slice(0, 2), ["c", "b"]);
  assert.deepEqual(run({ sort: "network-gap" }).slice(0, 2), ["a", "b"]);
  assert.deepEqual(archiveFacet(owner.films, "genres"), [["Drama", 2], ["Comedy", 1]]);
  const csv = archiveCsv(filterArchive(owner.films, { ...defaultArchiveFilters, genre: "Drama", sort: "title" }, network), network, "en").trim().split("\r\n");
  assert.equal(csv.length, 3);
  assert.match(csv[2], /"4.5","2"/);
});

test("scraped film pages become RSS users without replacing exports or repeating a scan", () => {
  const owner = { ...user("owner", [film("a", { rating: 5 })]), source: "upload" as const };
  const known = { ...user("ece", [film("a", { rating: 4 })]), id: "rss-ece", source: "rss" as const, displayName: "Ece" };
  const scraped = [
    { handle: "ece", scannedAt: "2026-10-10T10:00:00Z", complete: true, films: [film("a", { rating: 3.5, slug: "a" }), film("b", { rating: 2 })] },
    { handle: "owner", scannedAt: "2026-10-10T10:00:00Z", films: [film("a", { rating: 1 })] },
    { handle: "new", scannedAt: "2026-10-10T10:00:00Z", films: [film("c", { rating: 4 })] },
  ];
  const incoming = scrapedMembersToUsers(scraped, [owner, known], "owner");
  assert.deepEqual(incoming.map((u) => u.id), ["rss-ece", "rss-new"]);
  assert.equal(incoming[0].displayName, "Ece");
  assert.equal(incoming[0].ratingsComplete, true);
  const merged = mergeFilmArchive(known, incoming[0]);
  assert.equal(merged.films.find((f) => f.key === "a")?.rating, 3.5, "the full page rating is current");
  assert.equal(merged.ratingsScannedAt, "2026-10-10T10:00:00Z");
  assert.equal(scrapedMembersToUsers(scraped, [owner, merged], "owner").some((u) => u.handle === "ece"), false);
});

test("ratings targets skip fresh reads and prefer never-read, higher-ranked members", () => {
  const now = new Date().toISOString();
  const users = [
    { ...user("fresh", []), source: "rss" as const, ratingsScannedAt: now },
    { ...user("old", []), source: "rss" as const, ratingsScannedAt: "2020-01-01T00:00:00Z" },
    { ...user("me", []), source: "upload" as const },
  ];
  const targets = pickRatingsTargets([{ handle: "fresh", rank: 99 }, { handle: "old", rank: 90 }, { handle: "low", rank: 10 }, { handle: "high", rank: 80 }, { handle: "me", rank: 100 }, { handle: "High", rank: 1 }], users, 3);
  assert.deepEqual(targets, ["high", "low", "old"]);
});

test("film-based people search separates lovers, haters and unknown", () => {
  const people = [
    user("lover", [film("a", { rating: 5 }), film("b", { rating: 4 })]),
    user("hater", [film("a", { rating: 1 }), film("b", { rating: 2 })]),
    user("mixed", [film("a", { rating: 4.5 }), film("b", { rating: 1.5 })]),
    user("heart", [film("a", { liked: true, watched: true })]),
    user("unknown", [film("z", { rating: 5 })]),
  ];
  const names = (criteria: Parameters<typeof findPeopleByFilms>[1], match: "all" | "any" = "all") =>
    findPeopleByFilms(people, criteria, { ...defaultFilmPeopleOptions, match }).map((r) => r.user.handle);
  assert.deepEqual(names([{ key: "a", condition: "loved" }]), ["lover", "mixed", "heart"]);
  assert.deepEqual(names([{ key: "a", condition: "loved" }, { key: "b", condition: "loved" }]), ["lover"]);
  assert.deepEqual(names([{ key: "a", condition: "loved" }, { key: "b", condition: "disliked" }]), ["mixed"]);
  assert.deepEqual(names([{ key: "a", condition: "disliked" }, { key: "b", condition: "disliked" }], "any"), ["hater", "mixed"]);
  assert.ok(!names([{ key: "a", condition: "disliked" }]).includes("unknown"), "missing film is not a dislike");
  const catalog = buildFilmCatalog(people);
  assert.equal(catalog[0].key, "a");
  assert.equal(catalog[0].raters, 4);
  assert.deepEqual(searchFilmCatalog(catalog, "b").map((e) => e.key), ["b"]);
  const results = findPeopleByFilms(people, [{ key: "a", condition: "rated" }], defaultFilmPeopleOptions);
  const csv = filmPeopleCsv(results, [{ key: "a", condition: "rated" }], new Map(catalog.map((e) => [e.key, e])), "en").trim().split("\r\n");
  assert.equal(csv.length, 4);
  assert.match(csv[1], /"lover".*"5"$/);
});
