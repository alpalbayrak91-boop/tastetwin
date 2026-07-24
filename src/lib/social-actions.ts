import type { SocialDirectoryEntry } from "./social-directory";

export type SocialAction = "follow" | "unfollow";

export type SocialActionRule = {
  action: SocialAction;
  inactiveDays: number;
  minTaste: number;
  maxTaste: number;
  minActivity: number;
  maxActivity: number;
  followsMe: "any" | "yes" | "no";
};

export type SocialActionCandidate = {
  entry: SocialDirectoryEntry;
  reasons: string[];
};

export function buildSocialActionCandidates(
  entries: SocialDirectoryEntry[],
  rule: SocialActionRule,
  now = Date.now(),
): SocialActionCandidate[] {
  return entries
    .filter((entry) => (rule.action === "unfollow" ? entry.myFollow : !entry.myFollow))
    .filter((entry) => relationshipMatches(rule.followsMe, entry.followsMe))
    .filter((entry) => {
      const score = entry.match?.score;
      return (
        (rule.minTaste <= 0 || (score !== undefined && score >= rule.minTaste)) &&
        (rule.maxTaste >= 100 || (score !== undefined && score <= rule.maxTaste))
      );
    })
    .filter((entry) => {
      const score = entry.activity?.activityScore;
      return (
        (rule.minActivity <= 0 || (score !== undefined && score >= rule.minActivity)) &&
        (rule.maxActivity >= 100 || (score !== undefined && score <= rule.maxActivity))
      );
    })
    .filter((entry) => {
      if (rule.inactiveDays <= 0) return true;
      const last = Date.parse(entry.activity?.lastActivityAt ?? "");
      return Boolean(last && Math.floor((now - last) / 86_400_000) >= rule.inactiveDays);
    })
    .map((entry) => ({
      entry,
      reasons: reasonsFor(entry, rule, now),
    }))
    .sort((a, b) => {
      const aActivity = Date.parse(a.entry.activity?.lastActivityAt ?? "") || 0;
      const bActivity = Date.parse(b.entry.activity?.lastActivityAt ?? "") || 0;
      return (
        (rule.action === "unfollow" ? aActivity - bActivity : bActivity - aActivity) ||
        (b.entry.match?.score ?? -1) - (a.entry.match?.score ?? -1)
      );
    });
}

function reasonsFor(entry: SocialDirectoryEntry, rule: SocialActionRule, now: number) {
  const reasons: string[] = [];
  if (rule.inactiveDays > 0 && entry.activity?.lastActivityAt) {
    const days = Math.floor((now - Date.parse(entry.activity.lastActivityAt)) / 86_400_000);
    reasons.push(`${days} days inactive`);
  }
  if (entry.match) reasons.push(`taste ${entry.match.score}`);
  if (entry.followsMe) reasons.push("follows you");
  else reasons.push("does not follow you");
  return reasons;
}

function relationshipMatches(filter: SocialActionRule["followsMe"], value: boolean) {
  return filter === "any" || (filter === "yes" ? value : !value);
}
