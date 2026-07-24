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
- Combines social and two-hop network scanning in one extension action while saving the social stage first.
- Provides numeric filters, sorting, pagination, weighted mutual connections, and recent film-activity signals.
- Excludes watchlist and unrated entries from co-rated match evidence.
- Uses a separate validity percentage based on the number of co-rated films.
- Keeps imported and scanned data on the user's computer.

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

Optional TMDB enrichment accepts the user's local API Read Access Token and adds recommendations, keywords, directors, countries, and posters to shared-love/watchlist matching. The TMDB token is stored only in local app storage.

For a public or revenue-generating release, asking every user to enter a personal TMDB key does not by itself settle licensing. Review TMDB's current terms and attribution requirements before release.

Windows may show an unknown publisher warning until the installer is code-signed.

## Development

```powershell
npm install
npm run desktop
```

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
