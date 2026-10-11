import type { FilmSignal, Language, UserTaste } from "../types";
import { isWatched } from "./film-insights";
import { csvCell } from "./social-export";

export type ArchiveStatus = "all" | "watched" | "rated" | "loved" | "watchlist" | "unrated-watched" | "rewatched" | "reviewed";
export type ArchiveSort = "recent" | "rating" | "title" | "runtime" | "year" | "network" | "network-gap" | "tmdb";

export type ArchiveFilters = {
  query: string;
  status: ArchiveStatus;
  genre: string;
  director: string;
  country: string;
  language: string;
  minRating: number;
  maxRating: number;
  yearFrom?: number;
  yearTo?: number;
  watchedYear?: number;
  maxRuntime?: number;
  minNetworkRatings: number;
  sort: ArchiveSort;
};

export const defaultArchiveFilters: ArchiveFilters = {
  query: "",
  status: "all",
  genre: "",
  director: "",
  country: "",
  language: "",
  minRating: 0,
  maxRating: 5,
  minNetworkRatings: 0,
  sort: "recent",
};

/** Ratings that other loaded members (RSS or exports) gave each film. */
export type NetworkRating = { mean: number; count: number; raters: Array<{ handle: string; rating: number }> };

export function buildNetworkRatings(owner: UserTaste | undefined, users: UserTaste[]): Map<string, NetworkRating> {
  const byFilm = new Map<string, Array<{ handle: string; rating: number }>>();
  for (const user of users) {
    if (owner && user.id === owner.id) continue;
    for (const film of user.films) {
      if (film.rating === undefined) continue;
      const list = byFilm.get(film.key) ?? [];
      list.push({ handle: user.handle, rating: film.rating });
      byFilm.set(film.key, list);
    }
  }
  const result = new Map<string, NetworkRating>();
  for (const [key, raters] of byFilm) {
    const mean = raters.reduce((sum, rater) => sum + rater.rating, 0) / raters.length;
    result.set(key, { mean: Number(mean.toFixed(2)), count: raters.length, raters: raters.sort((a, b) => b.rating - a.rating) });
  }
  return result;
}

/** Most common values of a metadata field, for filter menus. */
export function archiveFacet(films: FilmSignal[], field: "genres" | "directors" | "countries" | "originalLanguage", limit = 150) {
  const counts = new Map<string, number>();
  for (const film of films) {
    const values = field === "originalLanguage" ? (film.originalLanguage ? [film.originalLanguage] : []) : film[field];
    for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, limit);
}

export function watchedYears(films: FilmSignal[]) {
  const years = new Set<number>();
  for (const film of films) for (const date of film.watchedDates) {
    const year = Number(date.slice(0, 4));
    if (year > 1900) years.add(year);
  }
  return [...years].sort((a, b) => b - a);
}

export function filterArchive(
  films: FilmSignal[],
  filters: ArchiveFilters,
  networkRatings: Map<string, NetworkRating> = new Map(),
  locale = "tr-TR",
) {
  const query = filters.query.trim().toLocaleLowerCase(locale);
  const hasRatingRange = filters.minRating > 0 || filters.maxRating < 5;
  return films
    .filter((film) => {
      if (query) {
        const haystack = [film.title, film.year ?? "", ...film.directors, ...(film.cast ?? []).slice(0, 8)].join(" ").toLocaleLowerCase(locale);
        if (!haystack.includes(query)) return false;
      }
      switch (filters.status) {
        case "watched": if (!isWatched(film)) return false; break;
        case "rated": if (film.rating === undefined) return false; break;
        case "loved": if (!(film.liked || (film.rating ?? 0) >= 4)) return false; break;
        case "watchlist": if (!film.watchlist || isWatched(film)) return false; break;
        case "unrated-watched": if (!isWatched(film) || film.rating !== undefined) return false; break;
        case "rewatched": if (film.rewatches < 1) return false; break;
        case "reviewed": if (!film.review) return false; break;
      }
      if (filters.genre && !film.genres.includes(filters.genre)) return false;
      if (filters.director && !film.directors.includes(filters.director)) return false;
      if (filters.country && !film.countries.includes(filters.country)) return false;
      if (filters.language && film.originalLanguage !== filters.language) return false;
      if (hasRatingRange && (film.rating === undefined || film.rating < filters.minRating || film.rating > filters.maxRating)) return false;
      if (filters.yearFrom && (!film.year || film.year < filters.yearFrom)) return false;
      if (filters.yearTo && (!film.year || film.year > filters.yearTo)) return false;
      if (filters.watchedYear && !film.watchedDates.some((date) => date.startsWith(String(filters.watchedYear)))) return false;
      if (filters.maxRuntime && (!film.runtimeMinutes || film.runtimeMinutes > filters.maxRuntime)) return false;
      if (filters.minNetworkRatings > 0 && (networkRatings.get(film.key)?.count ?? 0) < filters.minNetworkRatings) return false;
      return true;
    })
    .sort((a, b) => {
      const byTitle = a.title.localeCompare(b.title);
      switch (filters.sort) {
        case "rating": return (b.rating ?? -1) - (a.rating ?? -1) || byTitle;
        case "title": return byTitle;
        case "runtime": return (b.runtimeMinutes ?? -1) - (a.runtimeMinutes ?? -1) || byTitle;
        case "year": return (b.year ?? 0) - (a.year ?? 0) || byTitle;
        case "tmdb": return (b.tmdbVoteAverage ?? -1) - (a.tmdbVoteAverage ?? -1) || byTitle;
        case "network": return (networkRatings.get(b.key)?.mean ?? -1) - (networkRatings.get(a.key)?.mean ?? -1)
          || (networkRatings.get(b.key)?.count ?? 0) - (networkRatings.get(a.key)?.count ?? 0) || byTitle;
        case "network-gap": return networkGap(b, networkRatings) - networkGap(a, networkRatings) || byTitle;
        default: return latestTimestamp(b) - latestTimestamp(a) || byTitle;
      }
    });
}

/** How far your rating sits from your network's average; unknown gaps sort last. */
function networkGap(film: FilmSignal, networkRatings: Map<string, NetworkRating>) {
  const network = networkRatings.get(film.key);
  return film.rating === undefined || !network ? -1 : Math.abs(film.rating - network.mean);
}

function latestTimestamp(film: FilmSignal) {
  return [...film.watchedDates, film.activityDate]
    .filter((value): value is string => Boolean(value))
    .reduce((latest, value) => Math.max(latest, Date.parse(value) || 0), 0);
}

export function archiveCsv(films: FilmSignal[], networkRatings: Map<string, NetworkRating>, language: Language) {
  const headings = language === "tr"
    ? ["Film", "Yil", "Puanim", "Ag ortalamasi", "Ag puan sayisi", "Izleme sayisi", "Son izleme", "Watchlist", "Sure (dk)", "Tur", "Yonetmen", "Ulke", "Dil", "TMDB puani", "Letterboxd"]
    : ["Film", "Year", "My rating", "Network mean", "Network ratings", "Viewings", "Last viewing", "Watchlist", "Runtime (min)", "Genres", "Directors", "Countries", "Language", "TMDB rating", "Letterboxd"];
  const rows = films.map((film) => {
    const network = networkRatings.get(film.key);
    return [
      film.title, film.year ?? "", film.rating ?? "", network?.mean ?? "", network?.count ?? "",
      film.watchedDates.length || (isWatched(film) ? 1 : 0), [...film.watchedDates].sort().at(-1) ?? "",
      film.watchlist ? "1" : "", film.runtimeMinutes ?? "", film.genres.join("; "), film.directors.join("; "),
      film.countries.join("; "), film.originalLanguage ?? "", film.tmdbVoteAverage ?? "", film.uri ?? "",
    ];
  });
  return "﻿" + [headings, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
