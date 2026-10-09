import type { FilmSignal, Language, MatchResult, UserTaste } from "../types";
import { isWatched } from "./film-insights";

export type TogetherPick = NonNullable<MatchResult["togetherPick"]>;

/** Ranks only the owner's unseen watchlist. RSS absence is never proof a friend has not watched a film. */
export function buildWatchTogetherPicks(
  target: UserTaste,
  candidate: UserTaste,
  commonFilms: MatchResult["commonFilms"],
): TogetherPick[] {
  const candidateFilms = new Map(candidate.films.map((film) => [film.key, film]));
  const seeds = commonFilms.filter((item) => item.targetRating >= 4 && item.candidateRating >= 4).map((item) => item.film);
  const terms = (field: "directors" | "genres" | "countries" | "keywords") =>
    new Set(seeds.flatMap((film) => film[field] ?? []).map((term) => term.toLowerCase()));
  const directors = terms("directors");
  const genres = terms("genres");
  const countries = terms("countries");
  const keywords = terms("keywords");
  const recommendedIds = new Set(seeds.flatMap((film) => film.tmdbRecommendations ?? []));
  const picks: TogetherPick[] = [];

  for (const film of target.films) {
    if (!film.watchlist || isWatched(film)) continue;
    const other = candidateFilms.get(film.key);
    if (other?.watchlist && !isWatched(other)) {
      picks.push({ film, kind: "mutual-watchlist" });
      continue;
    }
    if ((other?.rating ?? 0) >= 4) {
      picks.push({ film, kind: "your-watchlist-they-loved", candidateRating: other?.rating });
      continue;
    }
    // Do not recommend something the friend explicitly rated below the shared-love threshold.
    if (other && isWatched(other)) continue;
    const recommendation = Boolean(film.tmdbId && recommendedIds.has(String(film.tmdbId)));
    const keyword = overlap(film.keywords ?? [], keywords);
    const director = overlap(film.directors, directors);
    const genre = overlap(film.genres, genres);
    const country = overlap(film.countries, countries);
    const fitScore = Math.round((Number(recommendation) * 0.45 + keyword * 0.25 + director * 0.18 + genre * 0.08 + country * 0.04) * 100);
    if (!fitScore) continue;
    const signal = recommendation ? "recommendation" : keyword ? "keyword" : director ? "director" : genre ? "genre" : "country";
    picks.push({ film, kind: "taste-fit-watchlist", fitScore, signal });
  }
  const priority = { "mutual-watchlist": 3, "your-watchlist-they-loved": 2, "taste-fit-watchlist": 1 };
  return picks.sort((a, b) => priority[b.kind] - priority[a.kind] || (b.candidateRating ?? b.fitScore ?? 0) - (a.candidateRating ?? a.fitScore ?? 0) || a.film.title.localeCompare(b.film.title));
}

export function filterWatchTogetherPicks(picks: TogetherPick[], maxMinutes = 0, mutualOnly = false) {
  return picks.filter(({ film, kind }) =>
    (!mutualOnly || kind === "mutual-watchlist") &&
    (!maxMinutes || (Number.isFinite(film.runtimeMinutes) && (film.runtimeMinutes ?? 0) > 0 && film.runtimeMinutes! <= maxMinutes)),
  );
}

export function togetherPickReason(pick: TogetherPick, language: Language) {
  if (pick.kind === "mutual-watchlist") return language === "tr" ? "Film ikinizin de watchlistinde; bilinen izleme kaydi yok." : "On both watchlists, with no recorded viewing.";
  if (pick.kind === "your-watchlist-they-loved") return language === "tr" ? `Senin watchlistinde; bu kisi ${pick.candidateRating}/5 verdi.` : `On your watchlist; this person rated it ${pick.candidateRating}/5.`;
  const labels = {
    recommendation: ["TMDB onerisi", "a TMDB recommendation"],
    keyword: ["ortak anahtar kelime", "shared keywords"],
    director: ["ortak yonetmen", "a shared director"],
    genre: ["ortak tur", "a shared genre"],
    country: ["ortak ulke", "a shared country"],
  };
  const label = labels[pick.signal ?? "genre"][language === "tr" ? 0 : 1];
  return language === "tr" ? `Ortak sevdiginiz filmlerden ${label} sinyali. Arkadasinin izleyip izlemedigi bilinmiyor.` : `Linked to shared-loved films by ${label}. Your friend's viewing status is unknown.`;
}

function overlap(values: string[], seeds: Set<string>) {
  return values.length ? values.filter((value) => seeds.has(value.toLowerCase())).length / values.length : 0;
}
