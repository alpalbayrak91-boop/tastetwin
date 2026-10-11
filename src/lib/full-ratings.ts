import type { FilmSignal, UserTaste } from "../types";

/** A member's public film pages as the extension read them (server format). */
export type ScrapedMember = {
  handle: string;
  scannedAt: string;
  complete?: boolean;
  pages?: number;
  films: FilmSignal[];
};

/**
 * Turn scraped members into RSS-style users that `mergeRssUsers` can merge.
 * Your own uploaded export is never replaced by a scrape, and a member already
 * merged at the same scan time is skipped so polling does not repeat work.
 */
export function scrapedMembersToUsers(members: ScrapedMember[], current: UserTaste[], ownHandle = ""): UserTaste[] {
  const byHandle = new Map(current.map((user) => [user.handle.toLowerCase(), user]));
  const own = ownHandle.toLowerCase();
  const result: UserTaste[] = [];
  for (const member of members) {
    const handle = member.handle.toLowerCase();
    const existing = byHandle.get(handle);
    if (handle === own || existing?.source === "upload") continue;
    if (existing?.ratingsScannedAt && Date.parse(existing.ratingsScannedAt) >= Date.parse(member.scannedAt)) continue;
    result.push({
      id: existing?.id ?? `rss-${handle}`,
      handle,
      displayName: existing?.displayName ?? handle,
      source: "rss",
      importedAt: member.scannedAt,
      ratingsScannedAt: member.scannedAt,
      ratingsComplete: member.complete === true,
      films: member.films,
    });
  }
  return result;
}

export type RatingsScope = "matches" | "following" | "mutuals" | "followers" | "directory";

/**
 * Who to read next: people without a recent full read come first, then the
 * oldest reads. Best matches are ordered by recommendation score.
 */
export function pickRatingsTargets(
  candidates: Array<{ handle: string; rank: number }>,
  users: UserTaste[],
  limit: number,
  staleDays = 30,
): string[] {
  const byHandle = new Map(users.map((user) => [user.handle.toLowerCase(), user]));
  const now = Date.now();
  const seen = new Set<string>();
  return candidates
    .map(({ handle, rank }) => ({ handle: handle.toLowerCase(), rank }))
    .filter(({ handle }) => !seen.has(handle) && seen.add(handle))
    .filter(({ handle }) => byHandle.get(handle)?.source !== "upload")
    .map(({ handle, rank }) => {
      const scannedAt = Date.parse(byHandle.get(handle)?.ratingsScannedAt ?? "");
      const fresh = Number.isFinite(scannedAt) && now - scannedAt < staleDays * 24 * 60 * 60 * 1000;
      return { handle, rank, fresh, scannedAt: Number.isFinite(scannedAt) ? scannedAt : 0 };
    })
    .filter(({ fresh }) => !fresh)
    .sort((a, b) => a.scannedAt - b.scannedAt || b.rank - a.rank)
    .slice(0, Math.max(0, limit))
    .map(({ handle }) => handle);
}
