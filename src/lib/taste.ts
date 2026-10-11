import type { FilmSignal, MatchResult, Recommendation, UserTaste } from "../types";
import { isWatched } from "./film-insights";
import { buildWatchTogetherPicks } from "./watch-together";

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
  const watched = user.films.filter(isWatched).length;
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
  const targetProfile = ratingProfile(target);

  return users
    .filter((user) => user.id !== target.id)
    .map((user) => scoreUser(target, targetMap, user, community, targetProfile))
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
  const targetProfile = ratingProfile(target);
  const results: MatchResult[] = [];
  const chunkSize = 24;

  for (let offset = 0; offset < candidates.length; offset += chunkSize) {
    const chunk = candidates.slice(offset, offset + chunkSize);
    for (const candidate of chunk) results.push(scoreUser(target, targetMap, candidate, community, targetProfile));
    onProgress?.(Math.min(offset + chunk.length, candidates.length), candidates.length);
    await yieldToBrowser();
  }

  return results.sort((a, b) => b.score - a.score);
}

export function buildRecommendations(target: UserTaste, matches: MatchResult[]): Recommendation[] {
  const seen = new Set(target.films.filter(isWatched).map((film) => film.key));
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
  targetProfile: RatingProfile,
): MatchResult {
  const candidateProfile = ratingProfile(candidate);
  const percentilePairs: Array<[number, number]> = [];
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
    percentilePairs.push([targetProfile.percentile(targetRating), candidateProfile.percentile(candidateRating)]);
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
  const absoluteScore = commonCount
    ? Math.round(clamp(50 + totalImpact / Math.max(totalWeight, 1) - divergencePenalty, 0, 99))
    : 0;
  // Relative agreement compares where each film sits within each person's own
  // rating habits, so a harsh rater and a generous rater who order films the
  // same way still agree. It needs enough films to know those habits.
  const relativeScore =
    commonCount >= RELATIVE_MIN_COMMON &&
    targetProfile.count >= RELATIVE_MIN_RATINGS &&
    candidateProfile.count >= RELATIVE_MIN_RATINGS
      ? rankAgreement(percentilePairs)
      : undefined;
  const relativeWeight = relativeScore === undefined ? 0 : RELATIVE_MAX_WEIGHT * clamp((commonCount - 3) / 12, 0, 1);
  const rawScore = commonCount
    ? Math.round(clamp(absoluteScore * (1 - relativeWeight) + (relativeScore ?? 0) * relativeWeight, 0, 99))
    : 0;
  const coRatedMean = (side: 0 | 1) =>
    commonFilms.reduce((sum, row) => sum + (side === 0 ? row.targetRating : row.candidateRating), 0) / Math.max(commonCount, 1);
  const ratingBias = commonCount ? Number((coRatedMean(1) - coRatedMean(0)).toFixed(2)) : 0;
  const confidence = Math.round(clamp(1 - Math.exp(-commonCount / 8), 0, 1) * 100);
  const evidenceFactor = confidence / 100;
  const score = commonCount ? Math.round(50 + (rawScore - 50) * evidenceFactor) : 0;

  const togetherPick = buildWatchTogetherPicks(target, candidate, commonFilms)[0];
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
    absoluteScore,
    relativeScore,
    relativeWeight: Math.round(relativeWeight * 100),
    ratingBias,
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

const RELATIVE_MIN_COMMON = 4;
const RELATIVE_MIN_RATINGS = 8;
const RELATIVE_MAX_WEIGHT = 0.3;

type RatingProfile = { count: number; mean: number; percentile: (rating: number) => number };

/** Where a rating sits in the member's own distribution: 0 = their lowest, 1 = their highest. */
export function ratingProfile(user: UserTaste): RatingProfile {
  const ratings = user.films.flatMap((film) => (film.rating === undefined ? [] : [film.rating])).sort((a, b) => a - b);
  const count = ratings.length;
  const mean = count ? ratings.reduce((sum, value) => sum + value, 0) / count : 0;
  const cache = new Map<number, number>();
  return {
    count,
    mean,
    percentile(rating) {
      const cached = cache.get(rating);
      if (cached !== undefined) return cached;
      let below = 0;
      let equal = 0;
      for (const value of ratings) {
        if (value < rating) below += 1;
        else if (value === rating) equal += 1;
        else break;
      }
      const result = count ? (below + equal / 2) / count : 0.5;
      cache.set(rating, result);
      return result;
    },
  };
}

/** Spearman-style correlation of personal percentiles, mapped to 0-100 (50 = unrelated). */
export function rankAgreement(pairs: Array<[number, number]>) {
  if (pairs.length < 2) return undefined;
  const meanA = pairs.reduce((sum, [a]) => sum + a, 0) / pairs.length;
  const meanB = pairs.reduce((sum, [, b]) => sum + b, 0) / pairs.length;
  let covariance = 0;
  let varianceA = 0;
  let varianceB = 0;
  for (const [a, b] of pairs) {
    covariance += (a - meanA) * (b - meanB);
    varianceA += (a - meanA) ** 2;
    varianceB += (b - meanB) ** 2;
  }
  if (varianceA < 1e-9 || varianceB < 1e-9) return undefined;
  const correlation = covariance / Math.sqrt(varianceA * varianceB);
  return Math.round(clamp(50 + correlation * 50, 0, 100));
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
