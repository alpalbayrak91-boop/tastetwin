import type { FilmSignal, UserTaste } from "../types";

const metadataFields = ["genres", "directors", "countries", "cast", "originalLanguage", "runtimeMinutes", "overview", "tmdbVoteAverage", "releaseDate", "posterUrl", "tmdbId", "keywords", "tmdbRecommendations"] as const;

/** An export replaces personal signals, while previously fetched film metadata survives. */
export function preserveFilmMetadata(incoming: UserTaste, previous?: UserTaste): UserTaste {
  if (!previous || previous.handle.toLowerCase() !== incoming.handle.toLowerCase()) return incoming;
  const old = new Map(previous.films.map(f => [f.key, f]));
  return { ...incoming, films: incoming.films.map(f => enrichFromPrevious(f, old.get(f.key))) };
}

function enrichFromPrevious(film: FilmSignal, previous?: FilmSignal): FilmSignal {
  if (!previous) return film;
  const metadata: Record<string, unknown> = {};
  for (const field of metadataFields) {
    const value = film[field];
    if (previous[field] !== undefined && (value === undefined || (Array.isArray(value) && !value.length))) metadata[field] = previous[field];
  }
  return { ...film, ...metadata };
}

/** RSS is a moving window, not a complete export. Absence never deletes old records. */
export function mergeFilmArchive(previous: UserTaste | undefined, incoming: UserTaste): UserTaste {
  if (!previous || previous.handle.toLowerCase() !== incoming.handle.toLowerCase()) return incoming;
  const films = new Map(previous.films.map(f => [f.key, f]));
  for (const next of incoming.films) {
    const old = films.get(next.key);
    const merged = enrichFromPrevious(next, old);
    if (old) {
      // Preserve same-day diary multiplicity, without duplicating each polling result.
      const counts = new Map<string, number>();
      for (const dates of [old.watchedDates, next.watchedDates]) {
        const batch = new Map<string, number>();
        for (const date of dates) batch.set(date, (batch.get(date) ?? 0) + 1);
        for (const [date, count] of batch) counts.set(date, Math.max(count, counts.get(date) ?? 0));
      }
      merged.watchedDates = [...counts].sort(([a], [b]) => a.localeCompare(b)).flatMap(([date, count]) => Array(count).fill(date));
      merged.rewatches = Math.max(old.rewatches, next.rewatches);
      if (old.watched !== undefined || next.watched !== undefined) merged.watched = old.watched || next.watched;
      if (old.watchlist !== undefined) merged.watchlist = old.watchlist;
    }
    films.set(next.key, merged);
  }
  return { ...previous, ...incoming, id: previous.id, source: previous.source,
    importedAt: previous.source === "upload" ? previous.importedAt : incoming.importedAt,
    rssUpdatedAt: incoming.importedAt, films: [...films.values()],
    lastActivityAt: undefined, activityScore: undefined,
  };
}
