/**
 * Conversation history & social closeness for TasteTwin.
 *
 * Self-contained on purpose: no imports from the rest of the app, so it can be wired into
 * App.tsx / server.mjs / the extension without merge conflicts. See docs/AGENT-HANDOFF.md.
 *
 * Data sources:
 *  - Letterboxd export `comments.csv` (only YOUR side: Date, Content=boxd.it link, Comment).
 *  - Review comment sections, fetched while logged in: the review page HTML carries
 *    data-src="/csi/viewing/<viewingId>/comments-section/?esiAllowUser=true"; that fragment
 *    contains <li class="comment" data-person=... data-comment-id=...> items.
 */

export type ConversationComment = {
  id?: string;
  author: string;
  authorName?: string;
  at: string; // ISO date or datetime
  text: string;
  deleteUrl?: string;
};

export type ConversationThread = {
  url: string; // letterboxd.com path or full URL of the review/list
  owner: string; // handle of the review/list owner
  title?: string;
  comments: ConversationComment[]; // chronological
};

export type OwnCommentRow = { at: string; target: string; text: string };

export type ConversationPerson = {
  handle: string;
  name: string;
  threads: number;
  myMessages: number;
  theirMessages: number;
  twoWay: boolean;
  firstAt: string;
  lastAt: string;
  lastThread: { url: string; title?: string };
  waitingForMe: boolean; // their message is the latest in a thread on MY content
  closeness: number; // 0-100
  kinds: Array<"their-post" | "my-post" | "shared-thread">;
};

export type ToneCheck = { level: "ok" | "harsh" | "risky"; reasons: string[] };

const BIG_THREAD = 30;
const HALF_LIFE_DAYS = 90;

// ---------------------------------------------------------------------------
// Parsing

/** Parses the export's comments.csv (also works for deleted/ and orphaned/ variants). */
export function parseOwnCommentsCsv(csv: string): OwnCommentRow[] {
  const rows = parseCsv(csv.replace(/^﻿/, ""));
  const header = rows.shift()?.map((cell) => cell.trim().toLowerCase()) ?? [];
  const col = (name: string) => header.indexOf(name);
  const [dateCol, contentCol, commentCol] = [col("date"), col("content"), col("comment")];
  if (dateCol < 0 || commentCol < 0) throw new Error("Not a Letterboxd comments.csv");
  return rows
    .filter((row) => row.some((cell) => cell.trim()))
    .map((row) => ({ at: row[dateCol] ?? "", target: contentCol >= 0 ? row[contentCol] ?? "" : "", text: row[commentCol] ?? "" }));
}

/** Parses a /csi/viewing/<id>/comments-section/ fragment without needing a DOM (Node, workers, tests). */
export function parseCommentsSectionHtml(html: string): ConversationComment[] {
  const comments: ConversationComment[] = [];
  const itemPattern = /<li\b([^>]*\bclass="[^"]*\bcomment\b[^"]*"[^>]*)>([\s\S]*?)<\/li>/g;
  for (const match of html.matchAll(itemPattern)) {
    const attrs = match[1];
    const body = match[2];
    const author = attr(attrs, "data-person");
    if (!author) continue;
    const at = body.match(/<time[^>]*datetime="([^"]+)"/)?.[1] ?? "";
    const name = body.match(/<strong class="name">\s*<a[^>]*>([\s\S]*?)<\/a>/)?.[1];
    const textBlock = body.match(/<div class="[^"]*\b(?:comment-body|body-text)\b[^"]*"[^>]*>([\s\S]*?)<\/div>/)?.[1] ?? "";
    comments.push({
      id: attr(attrs, "data-comment-id"),
      author,
      authorName: name ? decodeEntities(stripTags(name)).trim() : undefined,
      at,
      text: decodeEntities(stripTags(textBlock.replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>\s*<p>/gi, "\n"))).trim(),
      deleteUrl: attr(attrs, "data-delete-url"),
    });
  }
  return comments;
}

// ---------------------------------------------------------------------------
// People

export function buildConversationPeople(
  threads: ConversationThread[],
  me: string,
  now: Date = new Date(),
): ConversationPerson[] {
  const self = me.toLowerCase();
  type Acc = Omit<ConversationPerson, "threads" | "closeness" | "twoWay" | "kinds"> & {
    threadSet: Set<string>;
    kinds: Set<ConversationPerson["kinds"][number]>;
  };
  const people = new Map<string, Acc>();

  for (const thread of threads) {
    const comments = [...thread.comments].sort((a, b) => a.at.localeCompare(b.at));
    const mineIdx = comments.flatMap((c, i) => (c.author.toLowerCase() === self ? [i] : []));
    const owner = thread.owner.toLowerCase();
    const onMyPost = owner === self;
    if (!onMyPost && !mineIdx.length) continue;

    const participants = new Map<string, { name?: string; count: number; last: string; first: string }>();
    comments.forEach((c, i) => {
      const who = c.author.toLowerCase();
      if (who === self) return;
      const direct =
        onMyPost ||
        who === owner ||
        comments.length <= BIG_THREAD && i > mineIdx[0] ||
        mineIdx.some((m) => i > m && i - m <= 3) ||
        mentions(c.text, me);
      if (!direct) return;
      const p = participants.get(who) ?? { name: c.authorName, count: 0, first: c.at, last: c.at };
      p.count += 1;
      p.last = c.at > p.last ? c.at : p.last;
      p.first = c.at < p.first ? c.at : p.first;
      p.name ||= c.authorName;
      participants.set(who, p);
    });
    // You commented on someone's post: the owner is part of the conversation even if silent.
    if (!onMyPost && !participants.has(owner)) {
      participants.set(owner, { count: 0, first: comments[mineIdx[0]].at, last: comments[mineIdx.at(-1)!].at });
    }

    const myCount = mineIdx.length;
    const lastComment = comments.at(-1);
    for (const [who, p] of participants) {
      const acc: Acc = people.get(who) ?? {
        handle: who,
        name: p.name ?? who,
        myMessages: 0,
        theirMessages: 0,
        firstAt: p.first,
        lastAt: p.last,
        lastThread: { url: thread.url, title: thread.title },
        waitingForMe: false,
        threadSet: new Set(),
        kinds: new Set(),
      };
      if (p.name && acc.name === who) acc.name = p.name;
      acc.theirMessages += p.count;
      acc.myMessages += myCount;
      const span = [p.first, p.last, ...(myCount ? [comments[mineIdx[0]].at, comments[mineIdx.at(-1)!].at] : [])].filter(Boolean);
      const first = span.reduce((a, b) => (a < b ? a : b));
      const last = span.reduce((a, b) => (a > b ? a : b));
      if (first < acc.firstAt) acc.firstAt = first;
      if (last >= acc.lastAt) {
        acc.lastAt = last;
        acc.lastThread = { url: thread.url, title: thread.title };
      }
      if (onMyPost && lastComment && lastComment.author.toLowerCase() === who) acc.waitingForMe = true;
      acc.kinds.add(onMyPost ? "my-post" : who === owner ? "their-post" : "shared-thread");
      acc.threadSet.add(thread.url);
      people.set(who, acc);
    }
  }

  return [...people.values()]
    .map(({ threadSet, kinds, ...rest }) => {
      const person = { ...rest, threads: threadSet.size, twoWay: rest.myMessages > 0 && rest.theirMessages > 0, kinds: [...kinds] };
      return { ...person, closeness: closenessScore(person, now) };
    })
    .sort((a, b) => b.closeness - a.closeness || b.lastAt.localeCompare(a.lastAt) || a.handle.localeCompare(b.handle));
}

/**
 * 0-100. Volume (log), reciprocity and spread across threads, decayed by recency
 * (half-life 90 days, floor 35%). One-way shouting at strangers stays low.
 */
export function closenessScore(
  p: Pick<ConversationPerson, "myMessages" | "theirMessages" | "threads" | "lastAt">,
  now: Date = new Date(),
) {
  const total = p.myMessages + p.theirMessages;
  if (!total) return 0;
  const volume = Math.min(1, Math.log2(1 + total) / 6);
  const reciprocity = p.myMessages && p.theirMessages ? Math.min(p.myMessages, p.theirMessages) / Math.max(p.myMessages, p.theirMessages) : 0;
  const spread = Math.min(1, Math.log2(1 + p.threads) / 4);
  const days = Math.max(0, (now.getTime() - (Date.parse(p.lastAt) || now.getTime())) / 86_400_000);
  const recency = 0.35 + 0.65 * 0.5 ** (days / HALF_LIFE_DAYS);
  return Math.round(100 * (0.45 * volume + 0.35 * reciprocity + 0.2 * spread) * recency);
}

/** Comments on YOUR reviews/lists where someone else spoke last. */
export function unansweredOnMyContent(threads: ConversationThread[], me: string) {
  const self = me.toLowerCase();
  return threads
    .filter((t) => t.owner.toLowerCase() === self && t.comments.length)
    .map((t) => ({ thread: t, last: [...t.comments].sort((a, b) => a.at.localeCompare(b.at)).at(-1)! }))
    .filter(({ last }) => last.author.toLowerCase() !== self)
    .map(({ thread, last }) => ({ url: thread.url, title: thread.title, from: last.author, at: last.at, text: last.text }))
    .sort((a, b) => b.at.localeCompare(a.at));
}

/** Joins export rows (your side only) with scanned threads, returning export comments that are no longer visible. */
export function findHiddenOwnComments(rows: OwnCommentRow[], visible: ConversationComment[], me: string) {
  const self = me.toLowerCase();
  const seen = new Set(visible.filter((c) => c.author.toLowerCase() === self).map((c) => normalizeText(c.text)));
  return rows.filter((row) => !seen.has(normalizeText(row.text)));
}

// ---------------------------------------------------------------------------
// Tone check ("post etmeden once bir bak")

// Patterns run on ASCII-folded text ("İncel ölsün" -> "incel olsun"), so plain \b works.
const RISKY: Array<[RegExp, string]> = [
  [/\bnigg(?:a|er)s?\b/, "irkci ifade"],
  [/\bzenci\w*/, "irkci cagrisim"],
  [/\bk\*?urt\s+(?:falan\s+)?yazilmaz/, "etnik asagilama"],
  [/\b(?:kill|kys)\s*your\s*self\b|\bkendini\s+oldur/, "intihara tesvik"],
  [/\btecavuz\w*|\brape[ds]?\b/, "tecavuz sakasi"],
  [/\bpedo(?:phile|fili\w*)?\b/, "pedofili"],
  [/\bjerk(?:ed)?\s+off\b|\bsuck\s+(?:my\s+)?cock\b|\bfuck\s+my\s+brains\b/, "cinsel icerik"],
  [/\b\d{1,2}\s*cm\b[\s\S]*\bsikim|\bsikim\b[\s\S]*\b\d{1,2}\s*cm\b/, "cinsel icerik"],
  [/\bsikis(?:elim|mek|iyor\w*)?\b|\bporno\w*|\bmilf\w*/, "cinsel icerik"],
];
// "sik" alone is ambiguous once folded ("sık" = often, "sıkıcı" = boring): only explicit forms count.
const HARSH: RegExp[] = [
  /\bamk\b|\bamq\b|\bamina\b|\bamcik\w*/,
  /\bsik(?:tir\w*|im\w*|eyim|erim|erek|er|ik|mek|me|sin|ecem|icem|cem|ti)\b/,
  /\byarra[kg]\w*/,
  /\borospu\w*|\boc\b/,
  /\bgerizekali\w*|\bmal\s+misin|\bgerzek\w*|\bandaval\b/,
  /\bfuck\w*|\bmotherfucker\b|\bstupid\s+mf\b|\bbitch\w*/,
  /\bebeni\b|\banani\b/,
];
const DEATH_WISH = /(?<![\p{L}\p{N}])ölsün(?![\p{L}\p{N}])/iu;

export function checkCommentTone(text: string): ToneCheck {
  const folded = foldTurkish(text);
  const reasons = RISKY.filter(([re]) => re.test(folded)).map(([, why]) => why);
  if (reasons.length) return { level: "risky", reasons: [...new Set(reasons)] };
  const harsh = HARSH.some((re) => re.test(folded)) || DEATH_WISH.test(text);
  const aimedAtPerson = /@\w+|\b(?:sen|seni|senin|sana|you|your)\b/.test(folded);
  if (harsh && aimedAtPerson) return { level: "risky", reasons: ["kisiye yonelik hakaret"] };
  if (harsh) return { level: "harsh", reasons: ["kufur/argo"] };
  return { level: "ok", reasons: [] };
}

function foldTurkish(text: string) {
  return text
    .replace(/[İIı]/g, "i")
    .toLowerCase()
    .replace(/ş/g, "s").replace(/ç/g, "c").replace(/ğ/g, "g").replace(/ö/g, "o").replace(/ü/g, "u")
    .normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
}

// ---------------------------------------------------------------------------
// helpers

function mentions(text: string, me: string) {
  return new RegExp(`@${escapeRegExp(me.slice(0, 4))}`, "i").test(text);
}
function attr(attrs: string, name: string) {
  return attrs.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1];
}
function stripTags(html: string) {
  return html.replace(/<[^>]+>/g, "");
}
function decodeEntities(text: string) {
  return text
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"').replace(/&#039;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}
function normalizeText(text: string) {
  return text.normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();
}
function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
