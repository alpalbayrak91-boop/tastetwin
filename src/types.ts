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
  avatarUrl?: string;
  networkConnections?: number;
  connectionHandles?: string[];
  importedAt: string;
  source: "rss" | "upload";
  films: FilmSignal[];
};

export type MatchResult = {
  user: UserTaste;
  score: number;
  rawScore: number;
  confidence: number;
  candidateFilmCount: number;
  commonCount: number;
  commonFilms: Array<{
    film: FilmSignal;
    targetRating: number;
    candidateRating: number;
    agreement: number;
    impact: number;
    signal: "shared-love" | "shared-dislike" | "divergence" | "agreement";
  }>;
  sharedLoves: FilmSignal[];
  sharedDislikes: FilmSignal[];
  divergences: Array<{ film: FilmSignal; targetRating?: number; candidateRating?: number }>;
  reasons: string[];
  togetherPick?: {
    film: FilmSignal;
    kind: "mutual-watchlist" | "your-watchlist-they-loved";
    candidateRating?: number;
  };
};

export type Recommendation = {
  film: FilmSignal;
  from: string;
  score: number;
  reason: string;
};
