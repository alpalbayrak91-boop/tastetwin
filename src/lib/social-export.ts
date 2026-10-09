import type { Language } from "../types";
import type { SocialDirectoryEntry } from "./social-directory";

/** Export the complete filtered result, with unknown measurements left blank. */
export function socialDirectoryCsv(entries: SocialDirectoryEntry[], language: Language) {
  const headings = language === "tr"
    ? ["Kullanici", "Ad", "Profil", "Takip ediyorum", "Beni takip ediyor", "Zevk puani", "Gecerlilik (%)", "Ortak puanli film", "Ortak baglanti", "Son film etkinligi"]
    : ["Handle", "Name", "Profile", "I follow", "Follows me", "Taste score", "Validity (%)", "Co-rated films", "Mutual connections", "Last film activity"];
  const yes = language === "tr" ? "Evet" : "Yes";
  const no = language === "tr" ? "Hayir" : "No";
  const rows = entries.map((entry) => [
    entry.username, entry.displayName, `https://letterboxd.com/${encodeURIComponent(entry.username)}/`,
    entry.myFollow ? yes : no, entry.followsMe ? yes : no,
    entry.match?.commonCount ? entry.match.score : "",
    entry.match?.commonCount ? entry.match.confidence : "",
    entry.match?.commonCount ?? "", entry.connections ?? "", entry.activity?.lastActivityAt ?? "",
  ]);
  return "\uFEFF" + [headings, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

function csvCell(value: string | number) {
  let text = String(value);
  // Quoting alone does not stop spreadsheet formula execution.
  if (/^[\s\uFEFF]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}
