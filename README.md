# TasteTwin

TasteTwin is a local-first Letterboxd social graph and movie taste matching app.

## What it does

- Imports a member's full Letterboxd export ZIP or CSV.
- Reads following and follower lists through the companion Chrome extension.
- Finds mutuals, non-followers, new followers, and lost followers.
- Manages the complete direct and discovered social directory even when a person has no film data.
- Filters and paginates people by both relationship directions, network source, and visible film activity.
- Compares the imported archive with recent public RSS activity from other members.
- Lets the user independently filter whether they follow a person and whether that person follows them.
- Opens each match into a rated common-film and divergence breakdown.
- Shows a paginated watch-together shortlist with maximum-runtime and shared-watchlist filters, bilingual reasons and Letterboxd links.
- Exports every person matching the current social filters to a local CSV, across all pages, with taste evidence and relationship directions.
- Combines social and two-hop network scanning in one extension action while saving the social stage first.
- Provides numeric filters, sorting, pagination, weighted mutual connections, and recent film-activity signals.
- Selects everyone matching the current social filters and saves them into separate follow/unfollow review lists.
- Shows up to 120 compact review entries per page; the extension highlights the real Letterboxd control and the user makes the final click.
- Excludes watchlist and unrated entries from co-rated match evidence.
- Uses a separate validity percentage based on the number of co-rated films.
- Shows total viewing time, average rating, viewing rhythm, and top genres, directors, actors, and languages.
- Shows longest diary streaks, busiest month, distinct viewing days, rewatch rate, average runtime and the complete diary span.
- Browses the complete film archive with search, watched/rated/loved/watchlist filters, sorting and 50-row pagination.
- Picks a taste-based, short, or random next watch from unwatched watchlist entries with a synopsis and reason.
- Keeps imported and scanned data on the user's computer.
- Exports and restores a portable local JSON backup containing film, social, history and management-list data without exposing the TMDB token.

## Install on Windows

1. Download `TasteTwin-Setup.exe` from the latest GitHub Release.
2. Install and open TasteTwin.
3. Download the extension ZIP from inside the app and extract it.
4. Open `chrome://extensions`, enable Developer mode, and choose Load unpacked.
5. Select the extracted extension folder.

## First use

1. Export your data from Letterboxd and load the downloaded ZIP with **My export**.
2. Keep TasteTwin open, visit your own Letterboxd profile, and run the social scan from the extension.
3. Return to TasteTwin and use **People I do not follow** in Taste matches.
4. Run the optional two-hop network scan to discover candidates outside your following list. Choose how many ranked candidates should have their RSS activity checked.

Network candidates are ranked by weighted shared connectors. Selective connectors count more than accounts following a very broad set of people, while daily connector shuffling gives successive scans some discovery diversity. RSS matching is processed in small batches and the result count is user-controlled.

The displayed taste score uses only films rated by both people. Rating gaps of 0-1 are positive, 1.5 is neutral, and gaps of 2 or more become increasingly negative. Sentiment context matters: a 2/4 split is penalized more than 0.5/2.5, repeated splits add an extra penalty, and locally rare or divisive films can carry more weight. Sparse comparisons are pulled toward a neutral score of 50 and shown with a separate validity percentage.

The current scoring model, social-data limits, TMDB recommendation plan, and known gaps are recorded in [docs/PRODUCT-NOTES.md](docs/PRODUCT-NOTES.md).

Optional TMDB enrichment accepts the user's local API Read Access Token and adds runtime, cast, directors, genres, language, synopsis, recommendations, keywords, countries, and posters. It enriches the full watched/watchlist archive so personal statistics are not based on a small favorite-only sample. The TMDB token is stored only in local app storage.

TasteTwin does not automatically follow or unfollow accounts. Letterboxd restricts automated extraction and excessive following, so social filters produce a transparent review queue. The companion extension opens the selected profile, scrolls to Letterboxd's relationship control and highlights it; the user makes the final click.

When that highlighted control is clicked, the extension reports the completed action to the local desktop bridge. The open app updates its following state within about two seconds. This is not remote account monitoring: changes made outside the TasteTwin-assisted flow are discovered by the next full scan.

Follow and unfollow review lists are stored in the main IndexedDB state, included in backups, and automatically remove entries whose relationship has already changed.

For a public or revenue-generating release, asking every user to enter a personal TMDB key does not by itself settle licensing. Review TMDB's current terms and attribution requirements before release.

Windows may show an unknown publisher warning until the installer is code-signed.

## Development

```powershell
npm install
npm run desktop
```

For browser development, run `npm start` for the local API on port 5173 and
`npm run dev` in a second terminal for Vite on port 5174. Vite proxies `/api`
to the backend; `TASTETWIN_API_URL` can override the proxy target.

Run the regression checks:

```powershell
npm test
npx playwright install chromium --only-shell
npm run test:browser
```

`npm test` checks imports, scoring, recommendations, social export, API access
rules, Vite forwarding and bridge persistence. `test:browser` builds the app
and desktop server, then checks import/reload, backups, social pagination,
review queues, CSV downloads and watch-together filters in Chromium at desktop
and mobile sizes. Test servers use random ports and temporary data directories
under `.codex-artifacts`; they do not connect to the running app's data.

The local API rejects unrelated website origins, unexpected Host headers and
non-JSON writes. Installed Chrome-extension origins remain supported because
unpacked extension IDs depend on the installation; set
`TASTETWIN_EXTENSION_ORIGINS` to a comma-separated list of exact
`chrome-extension://...` origins to narrow this further. This is a browser
access boundary, not authentication against other local programs.

Import fixes apply to newly imported exports. Reimport the original export to
correct older diary dates, rewatch counts or ratings; the app cannot reconstruct
those source distinctions from a previously merged archive.

Create a Windows installer:

```powershell
npm run make
```

The installer is written to `out/make/squirrel.windows/x64/TasteTwin-Setup.exe`.

## Data limits

The account owner gets full-history analysis from their own Letterboxd export. Other members are compared using recent public RSS activity unless they also provide an export. TasteTwin does not claim that RSS is a member's complete viewing history.

The optional network scanner is experimental, can take a long time, and may be blocked by Letterboxd. Review Letterboxd's current terms before using automated network collection.

## Privacy

See [PRIVACY.md](PRIVACY.md).
