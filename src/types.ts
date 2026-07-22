export type Language = "tr" | "en";

export type FilmSignal = {
  key: string;
  title: string;
  year?: number;
  uri?: string;
  rating?: number;
  liked?: boolean;
  review?: string;
  watchedDates: string[];
  rewatches: number;
  watchlist?: boolean;
  genres: string[];
  directors: string[];
  countries: string[];
  posterUrl?: string;
  tmdbId?: string;
};

export type UserTaste = {
  id: string;
  handle: string;
  displayName: string;
  importedAt: string;
  source: "rss" | "upload";
  films: FilmSignal[];
};

export type MatchResult = {
  user: UserTaste;
  score: number;
  confidence: number;
  candidateFilmCount: number;
  commonCount: number;
  sharedLoves: FilmSignal[];
  sharedDislikes: FilmSignal[];
  divergences: Array<{ film: FilmSignal; targetRating?: number; candidateRating?: number }>;
  reasons: string[];
  togetherPick?: FilmSignal;
};

export type Recommendation = {
  film: FilmSignal;
  from: string;
  score: number;
  reason: string;
};
