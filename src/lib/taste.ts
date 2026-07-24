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
  const community = buildCommunityStats([target, ...users]);

  return users
    .filter((user) => user.id !== target.id)
    .map((user) => scoreUser(target, targetMap, user, community))
    .sort((a, b) => b.score - a.score);
}

export async function buildMatchesAsync(
  target: UserTaste,
  users: UserTaste[],
  onProgress?: (completed: number, total: number) => void,
): Promise<MatchResult[]> {
  const candidates = users.filter((user) => user.id !== target.id);
  const targetMap = new Map(target.films.map((film) => [film.key, film]));
  const community = buildCommunityStats([target, ...users]);
  const results: MatchResult[] = [];
  const chunkSize = 24;

  for (let offset = 0; offset < candidates.length; offset += chunkSize) {
    const chunk = candidates.slice(offset, offset + chunkSize);
    for (const candidate of chunk) results.push(scoreUser(target, targetMap, candidate, community));
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
  community: CommunityStats,
): MatchResult {
  let totalImpact = 0;
  let totalWeight = 0;
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
    const filmStats = community.films.get(targetFilm.key);
    const discriminativeWeight = getDiscriminativeWeight(filmStats, community.maxRatings);
    let impact = scoreRatingPair(targetRating, candidateRating);
    let signal: MatchResult["commonFilms"][number]["signal"] = "agreement";

    if (targetLoved && candidateLoved) {
      signal = "shared-love";
      sharedLoves.push(targetFilm);
    } else if (targetDisliked && candidateDisliked) {
      signal = "shared-dislike";
      sharedDislikes.push(targetFilm);
    } else if (difference >= 1.5) {
      signal = "divergence";
      divergences.push({ film: targetFilm, targetRating, candidateRating });
    }
    impact = Math.round(clamp(impact * discriminativeWeight, -90, 75));
    totalImpact += impact;
    totalWeight += discriminativeWeight;
    commonFilms.push({
      film: targetFilm,
      targetRating,
      candidateRating,
      agreement,
      impact,
      discriminativeWeight,
      communityMean: filmStats?.mean,
      communityRatings: filmStats?.count ?? 0,
      signal,
    });
  }

  const commonCount = commonFilms.length;
  const divergenceRatio = commonCount ? divergences.length / commonCount : 0;
  const divergencePenalty = Math.round(18 * divergenceRatio ** 1.35);
  const rawScore = commonCount
    ? Math.round(clamp(50 + totalImpact / Math.max(totalWeight, 1) - divergencePenalty, 0, 99))
    : 0;
  const confidence = Math.round(clamp(1 - Math.exp(-commonCount / 8), 0, 1) * 100);
  const evidenceFactor = confidence / 100;
  const score = commonCount ? Math.round(50 + (rawScore - 50) * evidenceFactor) : 0;

  const togetherPick = pickWatchlistFilm(target, candidate, commonFilms);
  const nicheScore = calculateNicheScore(candidate, community);
  const networkSignal = Math.round(
    clamp(Math.log2(1 + (candidate.networkConnectionWeight ?? candidate.networkConnections ?? 0)) * 30, 0, 100),
  );
  const recommendationScore = Math.round(
    clamp(
      score * 0.7 +
        confidence * 0.08 +
        networkSignal * 0.11 +
        nicheScore * 0.06 +
        (candidate.activityScore ?? 0) * 0.05,
      0,
      99,
    ),
  );

  return {
    user: candidate,
    recommendationScore,
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
    divergencePenalty,
    nicheScore,
    reasons: buildReasons(target, candidate, sharedLoves, sharedDislikes, divergences),
    togetherPick,
  };
}

export function scoreRatingPair(a: number, b: number) {
  const difference = Math.abs(a - b);
  const gapPoints = interpolateGapScore(difference);
  const bothLoved = a >= 4 && b >= 4;
  const bothDisliked = a <= 2.5 && b <= 2.5;
  const bothNeutral = a >= 3 && a < 4 && b >= 3 && b < 4;
  const loveDislike = (a >= 4 && b <= 2.5) || (b >= 4 && a <= 2.5);
  const loveNeutral = (a >= 4 && b >= 3 && b < 4) || (b >= 4 && a >= 3 && a < 4);

  let score = gapPoints;
  if (bothLoved) score += 15;
  else if (bothDisliked) score += 8;
  else if (bothNeutral) score += 4;
  if (loveDislike) score -= 25;
  else if (loveNeutral) score -= 8;
  return Math.round(clamp(score, -75, 65));
}

function interpolateGapScore(difference: number) {
  const points = [
    [0, 45],
    [0.5, 34],
    [1, 18],
    [1.5, 0],
    [2, -18],
    [2.5, -32],
    [3, -45],
    [3.5, -55],
    [4.5, -65],
  ] as const;
  for (let index = 1; index < points.length; index += 1) {
    const [rightGap, rightScore] = points[index];
    const [leftGap, leftScore] = points[index - 1];
    if (difference <= rightGap) {
      const ratio = (difference - leftGap) / (rightGap - leftGap);
      return leftScore + (rightScore - leftScore) * ratio;
    }
  }
  return points.at(-1)?.[1] ?? -65;
}

function pickWatchlistFilm(
  target: UserTaste,
  candidate: UserTaste,
  commonFilms: MatchResult["commonFilms"],
): MatchResult["togetherPick"] {
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
    : pickTasteFitWatchlist(target, commonFilms);
}

function pickTasteFitWatchlist(
  target: UserTaste,
  commonFilms: MatchResult["commonFilms"],
): MatchResult["togetherPick"] {
  const seeds = commonFilms
    .filter((item) => item.targetRating >= 4 && item.candidateRating >= 4)
    .map((item) => item.film);
  if (!seeds.length) return undefined;

  const ranked = target.films
    .filter((film) => film.watchlist)
    .map((film) => {
      const directorOverlap = overlapRatio(film.directors, seeds.flatMap((seed) => seed.directors));
      const genreOverlap = overlapRatio(film.genres, seeds.flatMap((seed) => seed.genres));
      const countryOverlap = overlapRatio(film.countries, seeds.flatMap((seed) => seed.countries));
      const keywordOverlap = overlapRatio(film.keywords ?? [], seeds.flatMap((seed) => seed.keywords ?? []));
      const recommendedBySeed =
        film.tmdbId !== undefined &&
        seeds.some((seed) => seed.tmdbRecommendations?.includes(String(film.tmdbId)));
      const fitScore = Math.round(
        (Number(recommendedBySeed) * 0.45 +
          keywordOverlap * 0.25 +
          directorOverlap * 0.18 +
          genreOverlap * 0.08 +
          countryOverlap * 0.04) *
          100,
      );
      return { film, fitScore, directorOverlap, genreOverlap, keywordOverlap, recommendedBySeed };
    })
    .filter((item) => item.fitScore > 0)
    .sort((a, b) => b.fitScore - a.fitScore)[0];
  if (!ranked) return undefined;
  const reason = ranked.recommendedBySeed
    ? "TMDB recommends it from a shared-loved film."
    : ranked.keywordOverlap > 0
      ? "It shares specific TMDB keywords with shared-loved films."
      : ranked.directorOverlap > 0
        ? "Shared-loved films have a director overlap."
        : ranked.genreOverlap > 0
          ? "Shared-loved films have a genre overlap."
          : "Shared-loved films have a country overlap.";
  return { film: ranked.film, kind: "taste-fit-watchlist", fitScore: ranked.fitScore, reason };
}

type FilmCommunityStat = { count: number; mean: number; variance: number };
type CommunityStats = { films: Map<string, FilmCommunityStat>; maxRatings: number };

function buildCommunityStats(users: UserTaste[]): CommunityStats {
  const ratings = new Map<string, number[]>();
  const uniqueUsers = [...new Map(users.map((user) => [user.id, user])).values()];
  for (const user of uniqueUsers) {
    for (const film of user.films) {
      if (film.rating === undefined) continue;
      const values = ratings.get(film.key) ?? [];
      values.push(film.rating);
      ratings.set(film.key, values);
    }
  }
  const films = new Map<string, FilmCommunityStat>();
  let maxRatings = 0;
  for (const [key, values] of ratings) {
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
    films.set(key, { count: values.length, mean, variance });
    maxRatings = Math.max(maxRatings, values.length);
  }
  return { films, maxRatings };
}

function getDiscriminativeWeight(stat: FilmCommunityStat | undefined, maxRatings: number) {
  if (!stat || maxRatings < 2) return 1;
  const reliability = clamp((stat.count - 2) / 8, 0, 1);
  const controversy = clamp(Math.sqrt(stat.variance) / 1.4, 0, 1) * reliability;
  const rarity = clamp(1 - Math.log1p(stat.count) / Math.log1p(maxRatings), 0, 1);
  return Number((1 + controversy * 0.35 + rarity * 0.15).toFixed(2));
}

function calculateNicheScore(candidate: UserTaste, community: CommunityStats) {
  let weightedDeviation = 0;
  let evidence = 0;
  for (const film of candidate.films) {
    if (film.rating === undefined) continue;
    const stat = community.films.get(film.key);
    if (!stat || stat.count < 3) continue;
    const reliability = clamp((stat.count - 2) / 8, 0, 1);
    weightedDeviation += Math.abs(film.rating - stat.mean) * reliability;
    evidence += reliability;
  }
  if (!evidence) return 0;
  return Math.round(clamp((weightedDeviation / evidence / 2) * 100, 0, 100));
}

function overlapRatio(aValues: string[], bValues: string[]) {
  if (!aValues.length || !bValues.length) return 0;
  const b = new Set(bValues.map((value) => value.toLowerCase()));
  return aValues.filter((value) => b.has(value.toLowerCase())).length / aValues.length;
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
