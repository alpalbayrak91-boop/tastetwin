import type { FilmSignal, MatchResult, Recommendation, UserTaste } from "../types";

const toneWords = [
  "lonely",
  "funny",
  "violent",
  "tender",
  "slow",
  "sad",
  "angry",
  "beautiful",
  "weird",
  "cold",
  "komik",
  "yalniz",
  "sert",
  "huzun",
  "tuhaf",
  "karanlik",
  "sicak",
  "guzel",
];

export function getStats(user: UserTaste) {
  const watched = user.films.filter(
    (film) => film.rating !== undefined || film.watchedDates.length > 0 || (film.liked && !film.watchlist),
  ).length;
  const rated = user.films.filter((film) => film.rating !== undefined).length;
  const reviews = user.films.filter((film) => film.review).length;
  const rewatches = user.films.reduce((sum, film) => sum + film.rewatches, 0);
  const watchlist = user.films.filter((film) => film.watchlist).length;
  const loved = user.films.filter((film) => (film.rating ?? 0) >= 4 || film.liked).slice(0, 6);
  const disliked = user.films.filter((film) => film.rating !== undefined && film.rating <= 2.5).slice(0, 6);

  return { watched, rated, reviews, rewatches, watchlist, loved, disliked };
}

export function topTerms(user: UserTaste, field: "genres" | "directors" | "countries", limit = 6) {
  const counts = new Map<string, number>();
  for (const film of user.films) {
    const ratingBoost = film.rating !== undefined ? Math.max(0.4, film.rating / 4) : 0.7;
    for (const value of film[field]) counts.set(value, (counts.get(value) ?? 0) + ratingBoost);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
}

export function decadeTerms(user: UserTaste, limit = 6) {
  const counts = new Map<string, number>();
  for (const film of user.films) {
    if (!film.year) continue;
    const decade = `${Math.floor(film.year / 10) * 10}s`;
    counts.set(decade, (counts.get(decade) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
}

export function buildMatches(target: UserTaste, users: UserTaste[]): MatchResult[] {
  const targetMap = new Map(target.films.map((film) => [film.key, film]));

  return users
    .filter((user) => user.id !== target.id)
    .map((user) => scoreUser(target, targetMap, user))
    .sort((a, b) => b.score - a.score);
}

export async function buildMatchesAsync(
  target: UserTaste,
  users: UserTaste[],
  onProgress?: (completed: number, total: number) => void,
): Promise<MatchResult[]> {
  const candidates = users.filter((user) => user.id !== target.id);
  const targetMap = new Map(target.films.map((film) => [film.key, film]));
  const results: MatchResult[] = [];
  const chunkSize = 24;

  for (let offset = 0; offset < candidates.length; offset += chunkSize) {
    const chunk = candidates.slice(offset, offset + chunkSize);
    for (const candidate of chunk) results.push(scoreUser(target, targetMap, candidate));
    onProgress?.(Math.min(offset + chunk.length, candidates.length), candidates.length);
    await yieldToBrowser();
  }

  return results.sort((a, b) => b.score - a.score);
}

export function buildRecommendations(target: UserTaste, matches: MatchResult[]): Recommendation[] {
  const seen = new Set(target.films.map((film) => film.key));
  const candidates = new Map<string, Recommendation>();

  for (const match of matches.slice(0, 5)) {
    for (const film of match.user.films) {
      if (seen.has(film.key) || ((film.rating ?? 0) < 4 && !film.liked)) continue;
      const current = candidates.get(film.key);
      const score = Math.round(match.score * ((film.rating ?? 3) / 5));
      if (!current || score > current.score) {
        candidates.set(film.key, {
          film,
          from: match.user.displayName,
          score,
          reason: `${match.commonCount} common films, ${match.sharedLoves.length} shared loves`,
        });
      }
    }
  }

  return [...candidates.values()].sort((a, b) => b.score - a.score).slice(0, 8);
}

function scoreUser(
  target: UserTaste,
  targetMap: Map<string, FilmSignal>,
  candidate: UserTaste,
): MatchResult {
  let totalImpact = 0;
  const sharedLoves: FilmSignal[] = [];
  const sharedDislikes: FilmSignal[] = [];
  const divergences: MatchResult["divergences"] = [];
  const commonFilms: MatchResult["commonFilms"] = [];

  for (const candidateFilm of candidate.films) {
    const targetFilm = targetMap.get(candidateFilm.key);
    if (!targetFilm || targetFilm.rating === undefined || candidateFilm.rating === undefined) continue;
    const targetRating = targetFilm.rating;
    const candidateRating = candidateFilm.rating;
    const targetLoved = targetRating >= 4;
    const candidateLoved = candidateRating >= 4;
    const targetDisliked = targetRating <= 2.5;
    const candidateDisliked = candidateRating <= 2.5;
    const difference = Math.abs(targetRating - candidateRating);
    const agreement = Math.round(clamp(1 - difference / 4.5, 0, 1) * 100);
    let impact = Math.round(agreement - 50);
    let signal: MatchResult["commonFilms"][number]["signal"] = "agreement";

    if (targetLoved && candidateLoved) {
      impact += 10;
      signal = "shared-love";
      sharedLoves.push(targetFilm);
    } else if (targetDisliked && candidateDisliked) {
      impact += 6;
      signal = "shared-dislike";
      sharedDislikes.push(targetFilm);
    } else if ((targetLoved && candidateDisliked) || (targetDisliked && candidateLoved)) {
      impact -= 15;
      signal = "divergence";
      divergences.push({ film: targetFilm, targetRating, candidateRating });
    }
    impact = Math.round(clamp(impact, -65, 60));
    totalImpact += impact;
    commonFilms.push({ film: targetFilm, targetRating, candidateRating, agreement, impact, signal });
  }

  const commonCount = commonFilms.length;
  const rawScore = commonCount ? Math.round(clamp(50 + totalImpact / commonCount, 0, 99)) : 0;
  const confidence = Math.round(clamp(commonCount / 20, 0, 1) * 100);
  const evidenceFactor = confidence / 100;
  const score = commonCount ? Math.round(50 + (rawScore - 50) * evidenceFactor) : 0;

  const togetherPick = pickWatchlistFilm(target, candidate);

  return {
    user: candidate,
    score,
    rawScore,
    confidence,
    candidateFilmCount: candidate.films.filter((film) => film.rating !== undefined).length,
    commonCount,
    commonFilms: commonFilms.sort((a, b) => {
      const aEvidence = Number(a.targetRating !== undefined) + Number(a.candidateRating !== undefined);
      const bEvidence = Number(b.targetRating !== undefined) + Number(b.candidateRating !== undefined);
      return bEvidence - aEvidence || a.film.title.localeCompare(b.film.title);
    }),
    sharedLoves: uniqueByKey(sharedLoves),
    sharedDislikes: uniqueByKey(sharedDislikes),
    divergences,
    reasons: buildReasons(target, candidate, sharedLoves, sharedDislikes, divergences),
    togetherPick,
  };
}

function pickWatchlistFilm(target: UserTaste, candidate: UserTaste): MatchResult["togetherPick"] {
  const candidateMap = new Map(candidate.films.map((film) => [film.key, film]));
  const mutualWatchlist = target.films
    .filter((film) => film.watchlist && candidateMap.get(film.key)?.watchlist)
    .sort((a, b) => a.title.localeCompare(b.title))[0];
  if (mutualWatchlist) return { film: mutualWatchlist, kind: "mutual-watchlist" };

  const yourWatchlistTheyLoved = target.films
    .filter((film) => {
      if (!film.watchlist) return false;
      const candidateFilm = candidateMap.get(film.key);
      return candidateFilm?.rating !== undefined && candidateFilm.rating >= 4;
    })
    .map((film) => ({ film, candidateRating: candidateMap.get(film.key)?.rating }))
    .sort((a, b) => (b.candidateRating ?? 0) - (a.candidateRating ?? 0) || a.film.title.localeCompare(b.film.title))[0];
  return yourWatchlistTheyLoved
    ? { ...yourWatchlistTheyLoved, kind: "your-watchlist-they-loved" }
    : undefined;
}

function buildReasons(
  target: UserTaste,
  candidate: UserTaste,
  sharedLoves: FilmSignal[],
  sharedDislikes: FilmSignal[],
  divergences: MatchResult["divergences"],
) {
  const reasons: string[] = [];
  const sharedGenre = topSharedTerm(target, candidate, "genres");
  const sharedDirector = topSharedTerm(target, candidate, "directors");
  if (sharedLoves[0]) reasons.push(`Both rate ${sharedLoves[0].title} as a strong positive signal.`);
  if (sharedDislikes[0]) reasons.push(`Shared dislike matters: ${sharedDislikes[0].title}.`);
  if (sharedGenre) reasons.push(`Taste cluster: ${sharedGenre}.`);
  if (sharedDirector) reasons.push(`Director overlap: ${sharedDirector}.`);
  if (divergences[0]) reasons.push(`Interesting split: ${divergences[0].film.title}.`);
  return reasons.slice(0, 4);
}

function metadataAffinity(a: UserTaste, b: UserTaste) {
  return (
    jaccard(flatten(a.films, "genres"), flatten(b.films, "genres")) * 0.5 +
    jaccard(flatten(a.films, "directors"), flatten(b.films, "directors")) * 0.34 +
    jaccard(flatten(a.films, "countries"), flatten(b.films, "countries")) * 0.16
  );
}

function reviewToneSimilarity(a?: string, b?: string) {
  if (!a || !b) return 0;
  const aTokens = new Set(tokenize(a).filter((token) => toneWords.includes(token)));
  const bTokens = new Set(tokenize(b).filter((token) => toneWords.includes(token)));
  return jaccard([...aTokens], [...bTokens]);
}

function tokenize(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function topSharedTerm(a: UserTaste, b: UserTaste, field: "genres" | "directors" | "countries") {
  const aTerms = new Set(flatten(a.films, field));
  return topTerms(b, field, 10).find(([term]) => aTerms.has(term))?.[0];
}

function flatten(films: FilmSignal[], field: "genres" | "directors" | "countries") {
  return films.flatMap((film) => film[field]);
}

function jaccard(aValues: string[], bValues: string[]) {
  const a = new Set(aValues);
  const b = new Set(bValues);
  if (!a.size || !b.size) return 0;
  const intersection = [...a].filter((value) => b.has(value)).length;
  return intersection / new Set([...a, ...b]).size;
}

function uniqueByKey(films: FilmSignal[]) {
  return [...new Map(films.map((film) => [film.key, film])).values()];
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function yieldToBrowser() {
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
}
