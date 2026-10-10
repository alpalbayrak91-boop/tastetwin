import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const root = new URL("../", import.meta.url);
const parser = await readFile(new URL("extension/film-grid.js", root), "utf8");
const browser = await chromium.launch({ headless: true, executablePath: process.env.TASTETWIN_CHROMIUM_PATH || undefined });

async function parse(fixture) {
  const page = await browser.newPage();
  await page.setContent(await readFile(new URL(`tests/fixtures/${fixture}`, root), "utf8"));
  await page.addScriptTag({ content: parser });
  const result = await page.evaluate(() => {
    const grid = globalThis.TasteTwinFilmGrid;
    const films = grid.parseFilmGrid(document);
    return JSON.parse(JSON.stringify({ films, hasNext: grid.hasNextFilmPage(document, films.length) }));
  });
  await page.close();
  return result;
}

try {
  const react = await parse("letterboxd-films-react.html");
  assert.deepEqual(react.films, [
    { slug: "parasite-2019", title: "Parasite", year: 2019, rating: 4.5, liked: true },
    { slug: "the-room", title: "The Room", year: 2003, rating: 1, liked: false },
    { slug: "paris-texas", title: "Paris, Texas", year: 1984, liked: false },
  ]);
  assert.equal(react.hasNext, true, "a next link continues pagination");

  const legacy = await parse("letterboxd-films-legacy.html");
  assert.deepEqual(legacy.films, [
    { slug: "alien", title: "Alien", rating: 5, liked: false },
    { slug: "stalker", title: "Stalker", rating: 3.5, liked: true },
  ]);
  assert.equal(legacy.hasNext, false, "a short page without a next link is the last");
  console.log(JSON.stringify({ reactFilms: react.films.length, legacyFilms: legacy.films.length }));
} finally {
  await browser.close();
}
