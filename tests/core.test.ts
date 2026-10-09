import test from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { mergeFilmArchive, preserveFilmMetadata } from "../src/lib/film-archive";
import { readLetterboxdExport } from "../src/lib/letterboxd";
import { buildMatches, buildMatchesAsync, buildRecommendations, scoreRatingPair } from "../src/lib/taste";
import { buildFilmInsights, isWatched } from "../src/lib/film-insights";
import type { FilmSignal, UserTaste } from "../src/types";
import { buildWatchTogetherPicks, filterWatchTogetherPicks, togetherPickReason } from "../src/lib/watch-together";
import { socialDirectoryCsv } from "../src/lib/social-export";
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
