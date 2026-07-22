import JSZip from "jszip";
import type { FilmSignal, UserTaste } from "../types";

type CsvRow = Record<string, string>;

const fileKinds = ["ratings", "diary", "reviews", "watched", "watchlist", "likes", "profile"] as const;
type FileKind = (typeof fileKinds)[number];

export async function readLetterboxdExport(file: File, preferredHandle = ""): Promise<UserTaste> {
  const importedAt = new Date().toISOString();
  const rowsByKind: Partial<Record<FileKind, CsvRow[]>> = {};

  if (file.name.toLowerCase().endsWith(".zip")) {
    const zip = await JSZip.loadAsync(file);
    const entries = Object.values(zip.files).filter((entry) => !entry.dir && entry.name.toLowerCase().endsWith(".csv"));
    for (const entry of entries) {
      const kind = inferKind(entry.name);
      if (!kind) continue;
      const text = await entry.async("string");
      rowsByKind[kind] = [...(rowsByKind[kind] ?? []), ...parseCsv(text)];
    }
  } else {
    const text = await file.text();
    const kind = inferKind(file.name) ?? "ratings";
    rowsByKind[kind] = parseCsv(text);
  }

  const films = mergeRows(rowsByKind);
  const cleanName = file.name.replace(/\.(zip|csv)$/i, "").replace(/letterboxd[-_\s]?/i, "");
  const profileHandle = findProfileHandle(rowsByKind.profile ?? []);
  const handle = normalizeHandle(preferredHandle) || profileHandle || normalizeHandle(cleanName) || "you";

  return {
    id: `upload-${handle}`,
    handle,
    displayName: handle === "you" ? "You" : handle,
    importedAt,
    source: "upload",
    films,
  };
}

function inferKind(path: string): FileKind | undefined {
  const normalized = path.toLowerCase().replace(/\\/g, "/");
  if (/\/likes\/films\.csv$/.test(`/${normalized}`)) return "likes";
  const name = normalized.split("/").pop() ?? "";
  return fileKinds.find((kind) => name.includes(kind));
}

function parseCsv(text: string): CsvRow[] {
  const lines = splitLines(text.trim());
  if (lines.length === 0) return [];
  const headers = parseLine(lines[0]).map(normalizeHeader);

  const rows: CsvRow[] = [];
  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;
    const cells = parseLine(line);
    const row: CsvRow = {};
    headers.forEach((header, index) => {
      row[header] = (cells[index] ?? "").trim();
    });
    rows.push(row);
  }
  return rows;
}

function splitLines(text: string) {
  const lines: string[] = [];
  let current = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (char === '"' && next === '"') {
      current += char + next;
      index += 1;
      continue;
    }
    if (char === '"') quoted = !quoted;
    if (!quoted && (char === "\n" || char === "\r")) {
      if (char === "\r" && next === "\n") index += 1;
      lines.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  if (current.length) lines.push(current);
  return lines;
}

function parseLine(line: string) {
  const cells: string[] = [];
  let current = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (char === '"' && next === '"') {
      current += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      quoted = !quoted;
      continue;
    }

    if (char === "," && !quoted) {
      cells.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  cells.push(current);
  return cells;
}

function normalizeHeader(header: string) {
  return header.trim().toLowerCase().replace(/\s+/g, "_");
}

function mergeRows(rowsByKind: Partial<Record<FileKind, CsvRow[]>>) {
  const byKey = new Map<string, FilmSignal>();

  const ensure = (row: CsvRow) => {
    const title = first(row, "name", "title", "film") || "Untitled";
    const year = parseInteger(first(row, "year", "release_year"));
    const uri = first(row, "letterboxd_uri", "uri", "url");
    const key = filmKey(title, year, uri);
    const current = byKey.get(key);
    if (current) return current;

    const film: FilmSignal = {
      key,
      title,
      year,
      uri,
      watchedDates: [],
      rewatches: 0,
      genres: [],
      directors: [],
      countries: [],
    };
    byKey.set(key, film);
    return film;
  };

  for (const row of rowsByKind.ratings ?? []) {
    const film = ensure(row);
    const rating = parseRating(first(row, "rating"));
    if (rating !== undefined) {
      film.rating = rating;
      film.liked = rating >= 4;
    }
  }

  for (const row of rowsByKind.diary ?? []) {
    const film = ensure(row);
    const rating = parseRating(first(row, "rating"));
    if (rating !== undefined) film.rating = rating;
    pushUnique(film.watchedDates, first(row, "watched_date", "date"));
    if (isTrue(first(row, "rewatch"))) film.rewatches += 1;
  }

  for (const row of rowsByKind.reviews ?? []) {
    const film = ensure(row);
    const rating = parseRating(first(row, "rating"));
    if (rating !== undefined) film.rating = rating;
    const review = first(row, "review", "body", "text");
    if (review) film.review = review;
    pushUnique(film.watchedDates, first(row, "watched_date", "date"));
    if (isTrue(first(row, "rewatch"))) film.rewatches += 1;
  }

  for (const row of rowsByKind.watched ?? []) {
    const film = ensure(row);
    pushUnique(film.watchedDates, first(row, "watched_date", "date"));
  }

  for (const row of rowsByKind.watchlist ?? []) {
    const film = ensure(row);
    film.watchlist = true;
  }

  for (const row of rowsByKind.likes ?? []) {
    const film = ensure(row);
    film.liked = true;
  }

  return [...byKey.values()].sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
}

function first(row: CsvRow, ...keys: string[]) {
  for (const key of keys) {
    if (row[key]) return row[key];
  }
  return "";
}

function parseRating(value: string) {
  if (!value) return undefined;
  const normalized = value.replace(",", ".").replace("½", ".5");
  const rating = Number.parseFloat(normalized);
  return Number.isFinite(rating) ? Math.max(0, Math.min(5, rating)) : undefined;
}

function parseInteger(value: string) {
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) ? number : undefined;
}

function isTrue(value: string) {
  return ["yes", "true", "1", "y"].includes(value.toLowerCase());
}

function pushUnique(values: string[], value: string) {
  if (value && !values.includes(value)) values.push(value);
}

function filmKey(title: string, year?: number, _uri?: string) {
  return `film-${slugify(title)}-${year ?? "unknown"}`;
}

function findProfileHandle(rows: CsvRow[]) {
  for (const row of rows) {
    for (const value of Object.values(row)) {
      const match = value.match(/letterboxd\.com\/([a-z0-9_-]+)\/?(?:$|[?#])/i);
      if (match && !["film", "films", "list", "lists"].includes(match[1].toLowerCase())) return match[1].toLowerCase();
    }
  }
  return "";
}

function normalizeHandle(value: string) {
  const clean = value.trim().replace(/^@/, "").toLowerCase();
  return /^[a-z0-9_-]{2,32}$/.test(clean) ? clean : "";
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
