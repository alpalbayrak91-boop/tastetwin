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
  cast?: string[];
  originalLanguage?: string;
  runtimeMinutes?: number;
  overview?: string;
  tmdbVoteAverage?: number;
  releaseDate?: string;
  posterUrl?: string;
  tmdbId?: string;
  keywords?: string[];
  tmdbRecommendations?: string[];
  activityDate?: string;
};

export type UserTaste = {
  id: string;
  handle: string;
  displayName: string;
  avatarUrl?: string;
  networkConnections?: number;
  networkConnectionWeight?: number;
  connectionHandles?: string[];
  connectionDetails?: Array<{
    handle: string;
    displayName: string;
    avatarUrl?: string;
    followingCount?: number;
    weight: number;
  }>;
  lastActivityAt?: string;
  activity30Days?: number;
  activity90Days?: number;
  activityScore?: number;
  importedAt: string;
  source: "rss" | "upload";
  films: FilmSignal[];
};

export type MatchResult = {
  user: UserTaste;
  recommendationScore: number;
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
    discriminativeWeight: number;
    communityMean?: number;
    communityRatings: number;
    signal: "shared-love" | "shared-dislike" | "divergence" | "agreement";
  }>;
  sharedLoves: FilmSignal[];
  sharedDislikes: FilmSignal[];
  divergences: Array<{ film: FilmSignal; targetRating?: number; candidateRating?: number }>;
  divergencePenalty: number;
  nicheScore: number;
  reasons: string[];
  togetherPick?: {
    film: FilmSignal;
    kind: "mutual-watchlist" | "your-watchlist-they-loved" | "taste-fit-watchlist";
    candidateRating?: number;
    fitScore?: number;
    reason?: string;
  };
};

export type Recommendation = {
  film: FilmSignal;
  from: string;
  score: number;
  reason: string;
};
