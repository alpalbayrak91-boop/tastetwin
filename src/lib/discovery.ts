import type { MatchResult } from "../types";

export type RelationshipFilter = "any" | "yes" | "no";
export type MatchSort =
  | "recommended"
  | "taste"
  | "niche"
  | "connections"
  | "activity"
  | "evidence"
  | "validity";

export type DiscoveryFilters = {
  minScore: number;
  minCommon: number;
  minSharedLoves: number;
  maxDivergences: number;
  minConfidence: number;
  minConnections: number;
  maxConnections: number;
  minNiche: number;
  maxNiche: number;
  minActivity: number;
  maxActivity: number;
  myFollow: RelationshipFilter;
  followsMe: RelationshipFilter;
};

export function filterAndSortMatches(
  matches: MatchResult[],
  filters: DiscoveryFilters,
  sort: MatchSort,
  followingHandles: Set<string>,
  followerHandles: Set<string>,
) {
  return matches
    .filter((match) => {
      const handle = match.user.handle.toLowerCase();
      const connections = match.user.networkConnections ?? 0;
      return (
        match.score >= filters.minScore &&
        match.commonCount >= filters.minCommon &&
        match.sharedLoves.length >= filters.minSharedLoves &&
        match.divergences.length <= filters.maxDivergences &&
        match.confidence >= filters.minConfidence &&
        connections >= filters.minConnections &&
        connections <= filters.maxConnections &&
        match.nicheScore >= filters.minNiche &&
        match.nicheScore <= filters.maxNiche &&
        (match.user.activityScore ?? 0) >= filters.minActivity &&
        (match.user.activityScore ?? 0) <= filters.maxActivity &&
        relationshipMatches(filters.myFollow, followingHandles.has(handle)) &&
        relationshipMatches(filters.followsMe, followerHandles.has(handle))
      );
    })
    .sort((a, b) => compareMatches(a, b, sort));
}

export function paginateMatches(matches: MatchResult[], page: number, pageSize: number) {
  const totalPages = Math.max(1, Math.ceil(matches.length / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const start = (safePage - 1) * pageSize;
  return {
    page: safePage,
    totalPages,
    start,
    end: Math.min(start + pageSize, matches.length),
    items: matches.slice(start, start + pageSize),
  };
}

function compareMatches(a: MatchResult, b: MatchResult, sort: MatchSort) {
  const primary =
    sort === "taste"
      ? b.score - a.score
      : sort === "niche"
        ? b.nicheScore - a.nicheScore
          : sort === "connections"
          ? (b.user.networkConnectionWeight ?? b.user.networkConnections ?? 0) -
            (a.user.networkConnectionWeight ?? a.user.networkConnections ?? 0)
          : sort === "activity"
            ? (b.user.activityScore ?? 0) - (a.user.activityScore ?? 0)
          : sort === "evidence"
            ? b.commonCount - a.commonCount
            : sort === "validity"
              ? b.confidence - a.confidence
              : b.recommendationScore - a.recommendationScore;
  return primary || b.score - a.score || b.commonCount - a.commonCount || a.user.handle.localeCompare(b.user.handle);
}

function relationshipMatches(filter: RelationshipFilter, value: boolean) {
  return filter === "any" || (filter === "yes" ? value : !value);
}
