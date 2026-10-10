import type { Language } from "../types";
import type { SocialMemberRecord } from "./social-directory";
import { csvCell } from "./social-export";

/** One follower change, detected by comparing two complete follower scans. */
export type FollowerEvent = {
  username: string;
  displayName: string;
  kind: "followed" | "unfollowed";
  /** Time of the scan that first saw the change. */
  detectedAt: string;
  /** Previous complete scan; the change happened somewhere between the two. */
  since?: string;
};

export const FOLLOWER_EVENT_LIMIT = 5000;

/** Append name-level changes, newest last, without duplicating an already recorded scan. */
export function appendFollowerEvents(
  existing: FollowerEvent[] | undefined,
  changes: { newFollowers: SocialMemberRecord[]; lostFollowers: SocialMemberRecord[] },
  detectedAt: string,
  since: string | undefined,
): FollowerEvent[] {
  const events = [...(existing ?? [])];
  const recorded = new Set(events.map(eventKey));
  const add = (member: SocialMemberRecord, kind: FollowerEvent["kind"]) => {
    const event: FollowerEvent = { username: member.username, displayName: member.displayName || member.username, kind, detectedAt, since };
    if (recorded.has(eventKey(event))) return;
    recorded.add(eventKey(event));
    events.push(event);
  };
  for (const member of changes.newFollowers) add(member, "followed");
  for (const member of changes.lostFollowers) add(member, "unfollowed");
  return events.slice(-FOLLOWER_EVENT_LIMIT);
}

function eventKey(event: FollowerEvent) {
  return `${event.username.toLowerCase()}|${event.kind}|${event.detectedAt}`;
}

/** People who followed and later unfollowed (or the reverse) more than once are worth seeing together. */
export function summarizeFollowerEvents(events: FollowerEvent[]) {
  const byPerson = new Map<string, FollowerEvent[]>();
  for (const event of events) {
    const key = event.username.toLowerCase();
    byPerson.set(key, [...(byPerson.get(key) ?? []), event]);
  }
  return {
    followed: events.filter((event) => event.kind === "followed").length,
    unfollowed: events.filter((event) => event.kind === "unfollowed").length,
    repeatPeople: [...byPerson.values()].filter((list) => list.length > 1).length,
  };
}

export function followerEventsCsv(events: FollowerEvent[], language: Language) {
  const headings = language === "tr"
    ? ["Kullanici", "Ad", "Profil", "Degisiklik", "Fark edildigi tarama", "Onceki tarama"]
    : ["Handle", "Name", "Profile", "Change", "Detected in scan", "Previous scan"];
  const label = (kind: FollowerEvent["kind"]) => kind === "followed"
    ? (language === "tr" ? "Takip etmeye basladi" : "Started following")
    : (language === "tr" ? "Takipten cikti" : "Unfollowed");
  const rows = [...events].reverse().map((event) => [
    event.username, event.displayName, `https://letterboxd.com/${encodeURIComponent(event.username)}/`,
    label(event.kind), event.detectedAt, event.since ?? "",
  ]);
  return "﻿" + [headings, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

export type FollowerHistoryEntry = {
  checkedAt: string;
  following: number;
  followers: number;
  mutuals: number;
  newFollowers: number;
  lostFollowers: number;
  networkCandidates?: number;
};

export type FollowerScan = {
  checkedAt: string;
  complete?: boolean;
  scanStage?: "social-complete" | "network-complete";
  followers: SocialMemberRecord[];
  counts: { following: number; followers: number; mutuals: number };
  network?: { candidateCount?: number };
};

/** The last complete follower list, kept so the next complete scan can be compared with it. */
export type FollowerSnapshot = {
  checkedAt: string;
  followers: SocialMemberRecord[];
  scanStage?: FollowerScan["scanStage"];
  comparisonPreviousCheckedAt?: string;
  lostFollowers?: SocialMemberRecord[];
  newFollowers?: SocialMemberRecord[];
  history?: FollowerHistoryEntry[];
};

export type FollowerChanges = {
  previousCheckedAt?: string;
  lostFollowers: SocialMemberRecord[];
  newFollowers: SocialMemberRecord[];
  history: FollowerHistoryEntry[];
  followerEvents: FollowerEvent[];
};

/**
 * Compare a scan with the previous complete snapshot. Returns the snapshot to
 * store next, or none when the stored one must stay as it is. Receiving the same
 * scan again (the app polls while the network stage runs) changes nothing.
 */
export function computeFollowerChanges(
  scan: FollowerScan,
  previous: FollowerSnapshot | undefined,
  previousEvents: FollowerEvent[],
): { changes: FollowerChanges; snapshot?: FollowerSnapshot } {
  const keep = (snapshot: FollowerSnapshot): FollowerChanges => ({
    previousCheckedAt: snapshot.comparisonPreviousCheckedAt,
    lostFollowers: snapshot.lostFollowers ?? [],
    newFollowers: snapshot.newFollowers ?? [],
    history: snapshot.history ?? [],
    followerEvents: previousEvents,
  });

  if (scan.complete === false) {
    return {
      changes: { previousCheckedAt: previous?.checkedAt, lostFollowers: [], newFollowers: [], history: previous?.history ?? [], followerEvents: previousEvents },
    };
  }
  if (previous && previous.checkedAt === scan.checkedAt) return { changes: keep(previous) };

  const nameOf = (member: SocialMemberRecord) => member.username.toLowerCase();
  const currentNames = new Set(scan.followers.map(nameOf));
  const sameFollowers =
    previous?.followers.length === scan.followers.length &&
    previous.followers.every((member) => currentNames.has(nameOf(member)));
  if (scan.scanStage === "network-complete" && previous?.scanStage === "social-complete" && sameFollowers) {
    const history = [...(previous.history ?? [])];
    const latest = history[history.length - 1];
    if (latest) history[history.length - 1] = { ...latest, networkCandidates: scan.network?.candidateCount };
    const snapshot: FollowerSnapshot = { ...previous, checkedAt: scan.checkedAt, scanStage: "network-complete", history };
    return { changes: keep(snapshot), snapshot };
  }

  const previousNames = new Set((previous?.followers ?? []).map(nameOf));
  const lostFollowers = previous?.followers.filter((member) => !currentNames.has(nameOf(member))) ?? [];
  const newFollowers = previous ? scan.followers.filter((member) => !previousNames.has(nameOf(member))) : [];
  const history = [
    ...(previous?.history ?? []),
    {
      checkedAt: scan.checkedAt,
      following: scan.counts.following,
      followers: scan.counts.followers,
      mutuals: scan.counts.mutuals,
      newFollowers: newFollowers.length,
      lostFollowers: lostFollowers.length,
      networkCandidates: scan.network?.candidateCount,
    },
  ].slice(-50);
  const snapshot: FollowerSnapshot = {
    checkedAt: scan.checkedAt,
    followers: scan.followers,
    scanStage: scan.scanStage,
    comparisonPreviousCheckedAt: previous?.checkedAt,
    lostFollowers,
    newFollowers,
    history,
  };
  return {
    changes: {
      previousCheckedAt: previous?.checkedAt,
      lostFollowers,
      newFollowers,
      history,
      followerEvents: previous
        ? appendFollowerEvents(previousEvents, { newFollowers, lostFollowers }, scan.checkedAt, previous.checkedAt)
        : previousEvents,
    },
    snapshot,
  };
}
