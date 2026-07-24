import type { FilmSignal, UserTaste } from "../types";

export type RankedTerm = {
  name: string;
  count: number;
};

export type FilmInsights = {
  watchedFilms: number;
  totalViews: number;
  ratedFilms: number;
  averageRating: number;
  totalRuntimeMinutes: number;
  runtimeCoverage: number;
  metadataCoverage: number;
  topGenres: RankedTerm[];
  topDirectors: RankedTerm[];
  topCast: RankedTerm[];
  topLanguages: RankedTerm[];
  ratingDistribution: RankedTerm[];
  monthlyActivity: RankedTerm[];
  weekdayActivity: RankedTerm[];
};

export type NextWatchMode = "taste" | "short" | "random";

export type NextWatchPick = {
  film: FilmSignal;
  score: number;
  reason: string;
};

const weekdaysTr = ["Paz", "Pzt", "Sal", "Car", "Per", "Cum", "Cmt"];
const weekdaysEn = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function buildFilmInsights(user: UserTaste, language: "tr" | "en"): FilmInsights {
  const watched = user.films.filter(isWatched);
  const rated = watched.filter((film) => film.rating !== undefined);
  const runtimeFilms = watched.filter((film) => (film.runtimeMinutes ?? 0) > 0);
  const dates = watched.flatMap((film) => film.watchedDates);
  const totalViews = watched.reduce((sum, film) => sum + viewCount(film), 0);
  const totalRuntimeMinutes = watched.reduce(
    (sum, film) => sum + (film.runtimeMinutes ?? 0) * viewCount(film),
    0,
  );

  return {
    watchedFilms: watched.length,
    totalViews,
    ratedFilms: rated.length,
    averageRating: rated.length
      ? rated.reduce((sum, film) => sum + (film.rating ?? 0), 0) / rated.length
      : 0,
    totalRuntimeMinutes,
    runtimeCoverage: watched.length ? Math.round((runtimeFilms.length / watched.length) * 100) : 0,
    metadataCoverage: watched.length
      ? Math.round(
          (watched.filter((film) => film.tmdbId && (film.genres.length || film.directors.length)).length /
            watched.length) *
            100,
        )
      : 0,
    topGenres: rankTerms(watched.flatMap((film) => film.genres)),
    topDirectors: rankTerms(watched.flatMap((film) => film.directors)),
    topCast: rankTerms(watched.flatMap((film) => film.cast ?? [])),
    topLanguages: rankTerms(
      watched
        .map((film) => film.originalLanguage)
        .filter((value): value is string => Boolean(value))
        .map(languageName),
    ),
    ratingDistribution: rankRatings(rated),
    monthlyActivity: rankMonths(dates),
    weekdayActivity: rankWeekdays(dates, language),
  };
}

export function buildWatchlistRanking(user: UserTaste, language: "tr" | "en"): NextWatchPick[] {
  const liked = user.films.filter((film) => isWatched(film) && ((film.rating ?? 0) >= 4 || film.liked));
  const likedDirectors = frequency(liked.flatMap((film) => film.directors));
  const likedCast = frequency(liked.flatMap((film) => film.cast ?? []));
  const likedGenres = frequency(liked.flatMap((film) => film.genres));
  const likedKeywords = frequency(liked.flatMap((film) => film.keywords ?? []));
  const recommendationIds = new Set(liked.flatMap((film) => film.tmdbRecommendations ?? []));

  return user.films
    .filter((film) => film.watchlist && !isWatched(film))
    .map((film) => {
      const director = bestOverlap(film.directors, likedDirectors);
      const actor = bestOverlap(film.cast ?? [], likedCast);
      const genre = bestOverlap(film.genres, likedGenres);
      const keyword = bestOverlap(film.keywords ?? [], likedKeywords);
      const recommended = Boolean(film.tmdbId && recommendationIds.has(film.tmdbId));
      const score =
        (recommended ? 12 : 0) +
        director.score * 4 +
        keyword.score * 2.5 +
        actor.score * 1.5 +
        genre.score;
      const evidence =
        director.name ||
        keyword.name ||
        actor.name ||
        genre.name;
      const reason = recommended
        ? language === "tr"
          ? "Sevdigin filmlerin TMDB benzerleri arasinda."
          : "TMDB links it to films you loved."
        : evidence
          ? language === "tr"
            ? `Sevdigin filmlerle ortak sinyal: ${evidence}.`
            : `Shared signal with films you loved: ${evidence}.`
          : language === "tr"
            ? "Watchlistinden rastgele secime uygun."
            : "Available as a random watchlist pick.";
      return { film, score, reason };
    })
    .sort((a, b) => b.score - a.score || a.film.title.localeCompare(b.film.title));
}

export function pickNextWatch(
  ranking: NextWatchPick[],
  mode: NextWatchMode,
  seed = Date.now(),
): NextWatchPick | undefined {
  if (!ranking.length) return undefined;
  if (mode === "taste") {
    const best = ranking.slice(0, Math.min(8, ranking.length));
    return best[Math.abs(seed) % best.length];
  }
  if (mode === "short") {
    const short = ranking
      .filter((item) => (item.film.runtimeMinutes ?? Number.POSITIVE_INFINITY) <= 100)
      .sort((a, b) => (a.film.runtimeMinutes ?? 9999) - (b.film.runtimeMinutes ?? 9999));
    return short[Math.abs(seed) % short.length] ?? ranking[Math.abs(seed) % ranking.length];
  }
  return ranking[Math.abs(seed) % ranking.length];
}

export function isWatched(film: FilmSignal) {
  return (
    film.rating !== undefined ||
    film.watchedDates.length > 0 ||
    film.rewatches > 0 ||
    (film.liked === true && !film.watchlist)
  );
}

export function formatRuntime(totalMinutes: number, language: "tr" | "en") {
  if (!totalMinutes) return language === "tr" ? "Veri yok" : "No data";
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  return days
    ? language === "tr"
      ? `${days} gun ${hours} saat`
      : `${days}d ${hours}h`
    : language === "tr"
      ? `${hours} saat`
      : `${hours}h`;
}

function viewCount(film: FilmSignal) {
  return Math.max(1, film.watchedDates.length, film.rewatches + 1);
}

function rankTerms(values: string[], limit = 8): RankedTerm[] {
  return [...frequency(values)]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, limit);
}

function rankRatings(films: FilmSignal[]): RankedTerm[] {
  const counts = new Map<string, number>();
  for (const film of films) {
    const key = String(film.rating);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => Number(a.name) - Number(b.name));
}

function rankMonths(dates: string[]): RankedTerm[] {
  const counts = new Map<string, number>();
  for (const value of dates) {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) continue;
    const key = `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, "0")}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(-12);
}

function rankWeekdays(dates: string[], language: "tr" | "en"): RankedTerm[] {
  const names = language === "tr" ? weekdaysTr : weekdaysEn;
  const counts = Array.from({ length: 7 }, () => 0);
  for (const value of dates) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) counts[parsed.getDay()] += 1;
  }
  return names.map((name, index) => ({ name, count: counts[index] }));
}

function frequency(values: string[]) {
  const counts = new Map<string, number>();
  for (const raw of values) {
    const value = raw.trim();
    if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return counts;
}

function bestOverlap(values: string[], counts: Map<string, number>) {
  return values.reduce(
    (best, name) => {
      const score = counts.get(name) ?? 0;
      return score > best.score ? { name, score } : best;
    },
    { name: "", score: 0 },
  );
}

function languageName(code: string) {
  try {
    return new Intl.DisplayNames(["tr"], { type: "language" }).of(code) ?? code.toUpperCase();
  } catch {
    return code.toUpperCase();
  }
}
