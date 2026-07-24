import type { UserTaste } from "../types";

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
};

export type SocialDirectorySort =
  | "relationship"
  | "active"
  | "inactive"
  | "connections"
  | "name";

export type SocialDirectoryFilters = {
  query: string;
  myFollow: "any" | "yes" | "no";
  followsMe: "any" | "yes" | "no";
  source: "all" | "direct" | "network";
  activity: "any" | "known" | "unknown";
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
          (filters.activity === "known" ? Boolean(entry.activity?.lastActivityAt) : !entry.activity?.lastActivityAt))
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

function relationshipMatches(filter: "any" | "yes" | "no", value: boolean) {
  return filter === "any" || (filter === "yes" ? value : !value);
}

function keyOf(member: SocialMemberRecord) {
  return member.username.toLowerCase();
}
