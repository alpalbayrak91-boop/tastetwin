// Parses a Letterboxd member film grid (/<member>/films/page/N/).
// Letterboxd has shipped several poster markups; each selector below is one
// of them (React "griditem", older "poster-container", liked "posteritem").
// Shared by content.js and the parser test, so it must stay DOM-only.
(function exportFilmGrid(root) {
  const ITEM_SELECTOR = "li.griditem, li.poster-container, li.posteritem";
  const FILMS_PER_PAGE = 72;

  function parseFilmGrid(documentPage) {
    const films = [];
    const seen = new Set();
    for (const item of documentPage.querySelectorAll(ITEM_SELECTOR)) {
      const film = parseFilmItem(item);
      if (!film || seen.has(film.slug)) continue;
      seen.add(film.slug);
      films.push(film);
    }
    return films;
  }

  function parseFilmItem(item) {
    const poster =
      item.querySelector("[data-item-slug], [data-film-slug]") ??
      item.querySelector('.react-component, [data-component-class="LazyPoster"]') ??
      item.querySelector("div");
    if (!poster) return undefined;
    const slug = (poster.getAttribute("data-item-slug") || poster.getAttribute("data-film-slug") || slugFromLink(poster) || "").trim();
    if (!/^[a-z0-9-]{1,160}$/.test(slug)) return undefined;
    const rawName =
      poster.getAttribute("data-item-full-display-name") ||
      poster.getAttribute("data-item-name") ||
      poster.querySelector("img")?.getAttribute("alt") ||
      "";
    const { title, year } = splitTitle(rawName, slug);
    return {
      slug,
      title,
      year,
      rating: ratingFrom(item),
      liked: Boolean(item.querySelector(".poster-viewingdata .like, .poster-viewingdata [class*='like'], span.like")),
    };
  }

  function slugFromLink(element) {
    const link = element.getAttribute("data-target-link") || element.querySelector("a[href*='/film/']")?.getAttribute("href") || "";
    return link.match(/\/film\/([a-z0-9-]+)\/?/)?.[1];
  }

  function splitTitle(rawName, slug) {
    const name = rawName.trim();
    const match = name.match(/^(.*?)\s*\((\d{4})\)\s*$/);
    if (match) return { title: match[1].trim(), year: Number(match[2]) };
    const slugYear = slug.match(/-(\d{4})$/);
    return { title: name || slug.replace(/-/g, " "), year: slugYear ? Number(slugYear[1]) : undefined };
  }

  // Ratings are half stars encoded as rated-1 ... rated-10.
  function ratingFrom(item) {
    const scope = item.querySelector(".poster-viewingdata") ?? item;
    for (const element of scope.querySelectorAll("[class*='rated-']")) {
      for (const name of element.classList) {
        const value = name.match(/^rated-(\d{1,2})$/)?.[1];
        if (value && Number(value) >= 1 && Number(value) <= 10) return Number(value) / 2;
      }
    }
    return undefined;
  }

  // A next link is authoritative; a full page without one may still continue.
  function hasNextFilmPage(documentPage, itemCount) {
    if (documentPage.querySelector('a.next, .paginate-nextprev a.next, a[rel="next"]')) return true;
    return itemCount >= FILMS_PER_PAGE;
  }

  root.TasteTwinFilmGrid = { parseFilmGrid, hasNextFilmPage, FILMS_PER_PAGE };
})(globalThis);
