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
  const rated = user.films.filter((film) => film.rating !== undefined).length;
  const reviews = user.films.filter((film) => film.review).length;
  const rewatches = user.films.reduce((sum, film) => sum + film.rewatches, 0);
  const watchlist = user.films.filter((film) => film.watchlist).length;
  const loved = user.films.filter((film) => (film.rating ?? 0) >= 4 || film.liked).slice(0, 6);
  const disliked = user.films.filter((film) => film.rating !== undefined && film.rating <= 2.5).slice(0, 6);

  return { rated, reviews, rewatches, watchlist, loved, disliked };
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
  const globalCounts = countFilms(users);
  const targetMap = new Map(target.films.map((film) => [film.key, film]));

  return users
    .filter((user) => user.id !== target.id)
    .map((user) => scoreUser(target, targetMap, user, globalCounts))
    .sort((a, b) => b.score - a.score);
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
  globalCounts: Map<string, number>,
): MatchResult {
  let total = 0;
  let weight = 0;
  const sharedLoves: FilmSignal[] = [];
  const sharedDislikes: FilmSignal[] = [];
  const divergences: MatchResult["divergences"] = [];

  for (const candidateFilm of candidate.films) {
    const targetFilm = targetMap.get(candidateFilm.key);
    if (!targetFilm) continue;
    const rarity = 1 / Math.sqrt(globalCounts.get(candidateFilm.key) ?? 1);
    const targetRating = targetFilm.rating;
    const candidateRating = candidateFilm.rating;
    const targetLoved = (targetRating ?? 0) >= 4 || targetFilm.liked === true;
    const candidateLoved = (candidateRating ?? 0) >= 4 || candidateFilm.liked === true;
    const targetDisliked = targetRating !== undefined && targetRating <= 2.5;
    const candidateDisliked = candidateRating !== undefined && candidateRating <= 2.5;
    const signalWeight = 1 + rarity + (targetFilm.review && candidateFilm.review ? 0.45 : 0);

    let contribution = 0.35;
    if (targetRating !== undefined && candidateRating !== undefined) {
      const diff = Math.abs(targetRating - candidateRating);
      contribution = 1 - Math.min(diff / 4.5, 1);
    }

    if (targetLoved && candidateLoved) {
      contribution = Math.max(contribution, 0.95) + 0.28;
      sharedLoves.push(targetFilm);
    }
    if (targetDisliked && candidateDisliked) {
      contribution += 0.32;
      sharedDislikes.push(targetFilm);
    }
    if ((targetLoved && candidateDisliked) || (targetDisliked && candidateLoved)) {
      contribution -= 0.52;
      divergences.push({ film: targetFilm, targetRating, candidateRating });
    }

    contribution += reviewToneSimilarity(targetFilm.review, candidateFilm.review) * 0.22;
    total += clamp(contribution, -0.3, 1.45) * signalWeight;
    weight += signalWeight;
  }

  const overlapScore = Math.min(1, weight / 18);
  const affinity = weight ? total / weight : 0;
  const metadata = metadataAffinity(target, candidate);
  const commonCount = candidate.films.filter((film) => targetMap.has(film.key)).length;
  const rawScore = clamp((affinity * 0.72 + metadata * 0.2 + overlapScore * 0.08) * 100, 0, 99);
  const confidence = Math.round(clamp(commonCount / 20, 0, 1) * 100);
  const evidenceFactor = confidence / 100;
  const score = commonCount ? Math.round(50 + (rawScore - 50) * evidenceFactor) : 0;

  const togetherPick = candidate.films.find(
    (film) => !targetMap.has(film.key) && ((film.rating ?? 0) >= 4.2 || film.liked === true) && !film.watchlist,
  );

  return {
    user: candidate,
    score,
    confidence,
    candidateFilmCount: candidate.films.length,
    commonCount,
    sharedLoves: uniqueByKey(sharedLoves).slice(0, 5),
    sharedDislikes: uniqueByKey(sharedDislikes).slice(0, 5),
    divergences: divergences.slice(0, 4),
    reasons: buildReasons(target, candidate, sharedLoves, sharedDislikes, divergences),
    togetherPick,
  };
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

function countFilms(users: UserTaste[]) {
  const counts = new Map<string, number>();
  for (const user of users) {
    for (const film of user.films) counts.set(film.key, (counts.get(film.key) ?? 0) + 1);
  }
  return counts;
}

function uniqueByKey(films: FilmSignal[]) {
  return [...new Map(films.map((film) => [film.key, film])).values()];
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
