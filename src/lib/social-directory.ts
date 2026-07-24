import type { MatchResult, UserTaste } from "../types";

export type SocialMemberRecord = {
  id?: string;
  username: string;
  displayName: string;
  avatarUrl?: string;
  connections?: number;
  connectionWeight?: number;
  via?: string[];
  viaDetails?: UserTaste["connectionDetails"];
};

export type SocialDirectoryEntry = SocialMemberRecord & {
  myFollow: boolean;
  followsMe: boolean;
  inNetwork: boolean;
  isNewFollower: boolean;
  isLostFollower: boolean;
  activity?: UserTaste;
  match?: MatchResult;
};

export type SocialDirectorySort =
  | "relationship"
  | "active"
  | "inactive"
  | "taste"
  | "connections"
  | "name";

export type SocialDirectoryFilters = {
  query: string;
  myFollow: "any" | "yes" | "no";
  followsMe: "any" | "yes" | "no";
  source: "all" | "direct" | "network";
  activity: "any" | "known" | "unknown";
  activityAge: "any" | "active30" | "active90" | "inactive90" | "inactive180" | "inactive365";
  category:
    | "all"
    | "following"
    | "followers"
    | "mutuals"
    | "not-following-back"
    | "fans"
    | "new"
    | "lost"
    | "network";
  minTaste: number;
  maxTaste: number;
  minActivity: number;
  maxActivity: number;
  minConnections: number;
  maxConnections: number;
  sort: SocialDirectorySort;
};

type SocialDirectorySource = {
  following: SocialMemberRecord[];
  followers: SocialMemberRecord[];
  newFollowers: SocialMemberRecord[];
  lostFollowers: SocialMemberRecord[];
  networkCandidates?: SocialMemberRecord[];
};

export function buildSocialDirectory(
  source: SocialDirectorySource,
  users: UserTaste[],
  matches: MatchResult[] = [],
): SocialDirectoryEntry[] {
  const following = new Set(source.following.map(keyOf));
  const followers = new Set(source.followers.map(keyOf));
  const newFollowers = new Set(source.newFollowers.map(keyOf));
  const lostFollowers = new Set(source.lostFollowers.map(keyOf));
  const activityByHandle = new Map(
    users
      .filter((user) => user.source === "rss")
      .map((user) => [user.handle.toLowerCase(), user]),
  );
  const matchByHandle = new Map(matches.map((match) => [match.user.handle.toLowerCase(), match]));
  const records = new Map<string, SocialMemberRecord & { inNetwork: boolean }>();

  for (const [members, inNetwork] of [
    [source.following, false],
    [source.followers, false],
    [source.newFollowers, false],
    [source.lostFollowers, false],
    [source.networkCandidates ?? [], true],
  ] as const) {
    for (const member of members) {
      const key = keyOf(member);
      const current = records.get(key);
      records.set(key, {
        ...current,
        ...member,
        displayName: member.displayName || current?.displayName || member.username,
        avatarUrl: current?.avatarUrl || member.avatarUrl,
        connections: Math.max(current?.connections ?? 0, member.connections ?? 0) || undefined,
        connectionWeight: Math.max(current?.connectionWeight ?? 0, member.connectionWeight ?? 0) || undefined,
        via: [...new Set([...(current?.via ?? []), ...(member.via ?? [])])],
        viaDetails: member.viaDetails?.length ? member.viaDetails : current?.viaDetails,
        inNetwork: Boolean(current?.inNetwork || inNetwork),
      });
    }
  }

  return [...records.entries()].map(([key, member]) => ({
    ...member,
    myFollow: following.has(key),
    followsMe: followers.has(key),
    inNetwork: member.inNetwork,
    isNewFollower: newFollowers.has(key),
    isLostFollower: lostFollowers.has(key),
    activity: activityByHandle.get(key),
    match: matchByHandle.get(key),
  }));
}

export function filterAndSortSocialDirectory(
  entries: SocialDirectoryEntry[],
  filters: SocialDirectoryFilters,
) {
  const query = filters.query.trim().toLowerCase();
  return entries
    .filter((entry) => {
      const direct = entry.myFollow || entry.followsMe || entry.isLostFollower;
      return (
        (!query ||
          entry.username.toLowerCase().includes(query) ||
          entry.displayName.toLowerCase().includes(query)) &&
        relationshipMatches(filters.myFollow, entry.myFollow) &&
        relationshipMatches(filters.followsMe, entry.followsMe) &&
        (filters.source === "all" ||
          (filters.source === "direct" ? direct : entry.inNetwork && !direct)) &&
        (filters.activity === "any" ||
          (filters.activity === "known" ? Boolean(entry.activity?.lastActivityAt) : !entry.activity?.lastActivityAt)) &&
        activityAgeMatches(filters.activityAge, entry.activity?.lastActivityAt) &&
        categoryMatches(filters.category, entry) &&
        (filters.minTaste <= 0 || (entry.match?.score ?? -1) >= filters.minTaste) &&
        (filters.maxTaste >= 100 || (entry.match?.score ?? 101) <= filters.maxTaste) &&
        (filters.minActivity <= 0 || (entry.activity?.activityScore ?? -1) >= filters.minActivity) &&
        (filters.maxActivity >= 100 || (entry.activity?.activityScore ?? 101) <= filters.maxActivity) &&
        (entry.connections ?? 0) >= filters.minConnections &&
        (filters.maxConnections >= 9999 || (entry.connections ?? 0) <= filters.maxConnections)
      );
    })
    .sort((a, b) => compareEntries(a, b, filters.sort));
}

export function paginateSocialDirectory(
  entries: SocialDirectoryEntry[],
  page: number,
  pageSize: number,
) {
  const totalPages = Math.max(1, Math.ceil(entries.length / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const start = (safePage - 1) * pageSize;
  return {
    page: safePage,
    totalPages,
    start,
    end: Math.min(start + pageSize, entries.length),
    items: entries.slice(start, start + pageSize),
  };
}

function compareEntries(
  a: SocialDirectoryEntry,
  b: SocialDirectoryEntry,
  sort: SocialDirectorySort,
) {
  if (sort === "active" || sort === "inactive") {
    const aTime = Date.parse(a.activity?.lastActivityAt ?? "") || 0;
    const bTime = Date.parse(b.activity?.lastActivityAt ?? "") || 0;
    const result = sort === "active" ? bTime - aTime : aTime - bTime;
    return result || a.username.localeCompare(b.username);
  }
  if (sort === "connections") {
    return (
      (b.connectionWeight ?? b.connections ?? 0) -
        (a.connectionWeight ?? a.connections ?? 0) ||
      a.username.localeCompare(b.username)
    );
  }
  if (sort === "taste") {
    return (
      (b.match?.recommendationScore ?? -1) - (a.match?.recommendationScore ?? -1) ||
      (b.match?.score ?? -1) - (a.match?.score ?? -1) ||
      a.username.localeCompare(b.username)
    );
  }
  if (sort === "name") return a.displayName.localeCompare(b.displayName);

  const relationshipRank = (entry: SocialDirectoryEntry) =>
    entry.myFollow && entry.followsMe
      ? 5
      : entry.followsMe
        ? 4
        : entry.myFollow
          ? 3
          : entry.inNetwork
            ? 2
            : entry.isLostFollower
              ? 1
              : 0;
  return (
    relationshipRank(b) - relationshipRank(a) ||
    (b.activity?.activityScore ?? -1) - (a.activity?.activityScore ?? -1) ||
    a.username.localeCompare(b.username)
  );
}

function categoryMatches(
  category: SocialDirectoryFilters["category"],
  entry: SocialDirectoryEntry,
) {
  if (category === "all") return true;
  if (category === "following") return entry.myFollow;
  if (category === "followers") return entry.followsMe;
  if (category === "mutuals") return entry.myFollow && entry.followsMe;
  if (category === "not-following-back") return entry.myFollow && !entry.followsMe;
  if (category === "fans") return !entry.myFollow && entry.followsMe;
  if (category === "new") return entry.isNewFollower;
  if (category === "lost") return entry.isLostFollower;
  return entry.inNetwork && !entry.myFollow && !entry.followsMe;
}

function relationshipMatches(filter: "any" | "yes" | "no", value: boolean) {
  return filter === "any" || (filter === "yes" ? value : !value);
}

function activityAgeMatches(filter: SocialDirectoryFilters["activityAge"], value?: string) {
  if (filter === "any") return true;
  const timestamp = Date.parse(value ?? "");
  if (!timestamp) return false;
  const ageDays = (Date.now() - timestamp) / 86_400_000;
  if (filter === "active30") return ageDays <= 30;
  if (filter === "active90") return ageDays <= 90;
  if (filter === "inactive90") return ageDays >= 90;
  if (filter === "inactive180") return ageDays >= 180;
  return ageDays >= 365;
}

function keyOf(member: SocialMemberRecord) {
  return member.username.toLowerCase();
}
