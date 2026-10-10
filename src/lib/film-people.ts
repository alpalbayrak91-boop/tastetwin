import type { FilmSignal, Language, UserTaste } from "../types";
import { csvCell } from "./social-export";

export type FilmCondition = "loved" | "liked-heart" | "disliked" | "rated" | "watched" | "high" | "low";

export type FilmCriterion = { key: string; condition: FilmCondition };

export type FilmPeopleOptions = {
  match: "all" | "any";
  lovedAt: number;
  dislikedAt: number;
  excludeOwner?: string;
};

export const defaultFilmPeopleOptions: FilmPeopleOptions = { match: "all", lovedAt: 4, dislikedAt: 2.5 };

export type FilmCatalogEntry = {
  key: string;
  title: string;
  year?: number;
  slug?: string;
  raters: number;
  mean?: number;
};

/** Every film any loaded member rated or logged, for the film picker. */
export function buildFilmCatalog(users: UserTaste[]): FilmCatalogEntry[] {
  const catalog = new Map<string, { film: FilmSignal; ratings: number[]; members: number }>();
  for (const user of users) {
    for (const film of user.films) {
      const entry = catalog.get(film.key) ?? { film, ratings: [], members: 0 };
      if (!entry.film.slug && film.slug) entry.film = { ...entry.film, slug: film.slug };
      entry.members += 1;
      if (film.rating !== undefined) entry.ratings.push(film.rating);
      catalog.set(film.key, entry);
    }
  }
  return [...catalog.values()]
    .map(({ film, ratings, members }) => ({
      key: film.key,
      title: film.title,
      year: film.year,
      slug: film.slug,
      raters: members,
      mean: ratings.length ? Number((ratings.reduce((sum, value) => sum + value, 0) / ratings.length).toFixed(2)) : undefined,
    }))
    .sort((a, b) => b.raters - a.raters || a.title.localeCompare(b.title));
}

export function searchFilmCatalog(catalog: FilmCatalogEntry[], query: string, limit = 12, locale = "tr-TR") {
  const needle = query.trim().toLocaleLowerCase(locale);
  if (!needle) return [];
  return catalog
    .filter((entry) => `${entry.title} ${entry.year ?? ""}`.toLocaleLowerCase(locale).includes(needle))
    .slice(0, limit);
}

export function meetsCondition(film: FilmSignal | undefined, condition: FilmCondition, options: FilmPeopleOptions) {
  if (!film) return false;
  const rating = film.rating;
  switch (condition) {
    case "loved": return (rating !== undefined && rating >= options.lovedAt) || (rating === undefined && film.liked === true);
    case "liked-heart": return film.liked === true;
    case "disliked": return rating !== undefined && rating <= options.dislikedAt;
    case "high": return rating !== undefined && rating >= 4.5;
    case "low": return rating !== undefined && rating <= 1.5;
    case "rated": return rating !== undefined;
    case "watched": return rating !== undefined || film.watched === true || film.watchedDates.length > 0 || film.liked === true;
  }
}

export type FilmPersonResult = {
  user: UserTaste;
  matched: number;
  rows: Array<{ key: string; film?: FilmSignal; met: boolean }>;
};

/**
 * Members whose ratings meet the chosen film conditions. "Unknown" is not
 * "disliked": a member without the film never satisfies a condition, and the
 * result notes how complete each member's data is.
 */
export function findPeopleByFilms(users: UserTaste[], criteria: FilmCriterion[], options: FilmPeopleOptions): FilmPersonResult[] {
  if (!criteria.length) return [];
  const results: FilmPersonResult[] = [];
  for (const user of users) {
    if (options.excludeOwner && user.handle.toLowerCase() === options.excludeOwner.toLowerCase()) continue;
    const films = new Map(user.films.map((film) => [film.key, film]));
    const rows = criteria.map((criterion) => {
      const film = films.get(criterion.key);
      return { key: criterion.key, film, met: meetsCondition(film, criterion.condition, options) };
    });
    const matched = rows.filter((row) => row.met).length;
    if (options.match === "all" ? matched === criteria.length : matched > 0) results.push({ user, matched, rows });
  }
  return results.sort((a, b) =>
    b.matched - a.matched ||
    averageRating(b) - averageRating(a) ||
    a.user.handle.localeCompare(b.user.handle),
  );
}

function averageRating(result: FilmPersonResult) {
  const ratings = result.rows.flatMap((row) => (row.film?.rating === undefined ? [] : [row.film.rating]));
  return ratings.length ? ratings.reduce((sum, value) => sum + value, 0) / ratings.length : -1;
}

export function filmPeopleCsv(results: FilmPersonResult[], criteria: FilmCriterion[], catalog: Map<string, FilmCatalogEntry>, language: Language) {
  const filmTitles = criteria.map((criterion) => {
    const entry = catalog.get(criterion.key);
    return entry ? `${entry.title}${entry.year ? ` (${entry.year})` : ""}` : criterion.key;
  });
  const headings = [
    ...(language === "tr" ? ["Kullanici", "Ad", "Profil", "Uyan kosul", "Tam puan listesi"] : ["Handle", "Name", "Profile", "Conditions met", "Full ratings read"]),
    ...filmTitles,
  ];
  const rows = results.map((result) => [
    result.user.handle,
    result.user.displayName,
    `https://letterboxd.com/${encodeURIComponent(result.user.handle)}/`,
    `${result.matched}/${criteria.length}`,
    result.user.source === "upload" ? "export" : result.user.ratingsScannedAt ?? "",
    ...result.rows.map((row) => (row.film?.rating !== undefined ? row.film.rating : row.film ? (row.film.liked ? "♥" : "✓") : "")),
  ]);
  return "﻿" + [headings, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
