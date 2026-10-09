import { useMemo, useState } from "react";
import { buildWatchTogetherPicks, filterWatchTogetherPicks, togetherPickReason } from "../lib/watch-together";
import type { Language, MatchResult, UserTaste } from "../types";

export function WatchTogetherPanel({ target, match, language }: { target: UserTaste; match: MatchResult; language: Language }) {
  const [maxMinutes, setMaxMinutes] = useState(0);
  const [mutualOnly, setMutualOnly] = useState(false);
  const [page, setPage] = useState(1);
  const ranking = useMemo(() => buildWatchTogetherPicks(target, match.user, match.commonFilms), [target, match]);
  const filtered = useMemo(() => filterWatchTogetherPicks(ranking, maxMinutes, mutualOnly), [ranking, maxMinutes, mutualOnly]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / 6));
  const currentPage = Math.min(page, totalPages);

  return (
    <section className="detail-section together-planner" aria-label={language === "tr" ? "Birlikte izleme listesi" : "Watch together shortlist"}>
      <h3>{language === "tr" ? "Birlikte ne izlesek?" : "What should we watch together?"}</h3>
      <p className="muted-line">{language === "tr" ? "Senin izlenmemis watchlistinden, ortak listenize ve sevdiginiz filmlere gore sirali oneriler." : "Your unseen watchlist, ranked by shared watchlist entries and films you love."}</p>
      <div className="together-controls">
        <label>
          {language === "tr" ? "En fazla sure" : "Maximum runtime"}
          <select aria-label={language === "tr" ? "En fazla sure" : "Maximum runtime"} value={maxMinutes} onChange={(event) => { setMaxMinutes(Number(event.target.value)); setPage(1); }}>
            <option value={0}>{language === "tr" ? "Sure siniri yok" : "Any runtime"}</option>
            {[90, 120, 150, 180].map((minutes) => <option value={minutes} key={minutes}>{minutes} {language === "tr" ? "dk" : "min"}</option>)}
          </select>
        </label>
        <label className="together-checkbox">
          <input type="checkbox" checked={mutualOnly} onChange={(event) => { setMutualOnly(event.target.checked); setPage(1); }} />
          {language === "tr" ? "Sadece ortak watchlist" : "Shared watchlist only"}
        </label>
      </div>
      {maxMinutes > 0 && <p className="muted-line">{language === "tr" ? "Suresi bilinmeyen filmler bu filtrede gosterilmez." : "Films with unknown runtime are excluded by this filter."}</p>}
      <p className="muted-line" role="status">{filtered.length} {language === "tr" ? "uygun film" : "eligible films"}</p>
      {filtered.slice((currentPage - 1) * 6, currentPage * 6).map((pick) => (
        <article className="together-pick detail-together-pick" key={pick.film.key}>
          <span>{pick.film.year ?? ""}{pick.film.runtimeMinutes ? ` · ${pick.film.runtimeMinutes} ${language === "tr" ? "dk" : "min"}` : ""}</span>
          <strong>{pick.film.title}</strong>
          <small>{togetherPickReason(pick, language)}</small>
          {pick.film.overview && <p>{pick.film.overview}</p>}
          <a href={pick.film.uri?.startsWith("https://letterboxd.com/") ? pick.film.uri : `https://letterboxd.com/search/films/${encodeURIComponent(pick.film.title)}/`} target="_blank" rel="noreferrer">
            {language === "tr" ? "Letterboxd'da incele" : "View on Letterboxd"}
          </a>
        </article>
      ))}
      {!filtered.length && <p className="muted-line">{language === "tr" ? "Bu kosullarda oneri yok. Filtreleri genisletebilir veya watchlist ve TMDB verilerini guncelleyebilirsin. RSS, arkadasinin watchlistini icermez." : "No suggestions match. Broaden the filters or refresh your watchlist and TMDB data. RSS does not include your friend's watchlist."}</p>}
      {totalPages > 1 && <div className="together-pagination">
        <button disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>{language === "tr" ? "Onceki filmler" : "Previous films"}</button>
        <span>{currentPage}/{totalPages}</span>
        <button disabled={currentPage === totalPages} onClick={() => setPage(currentPage + 1)}>{language === "tr" ? "Sonraki filmler" : "Next films"}</button>
      </div>}
    </section>
  );
}
