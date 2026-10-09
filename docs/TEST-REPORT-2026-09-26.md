# TasteTwin verification - 26 September 2026

## Completed

- `npm test`: 15 core regression cases, 7 HTTP/development-server cases, and the existing bridge restart/persistence check passed.
- `npm run test:browser`: TypeScript, Vite production build and desktop server bundle passed; Chromium exercised the bundled desktop backend in an isolated profile.
- Browser coverage: 900-film CSV import and immediate reload, full archive search/pagination, JSON backup download and restore followed by immediate reload, a 2,056-person social directory, follow/unfollow review queues and local relationship events.
- New feature coverage: CSV export contains all 2,056 results across pages and respects a one-person search; the watch-together list paginates nine suggestions, filters runtime and mutual watchlists, and explains results in Turkish and English.
- Desktop 1440x1000 and mobile 390x844 checked. Mobile suggestion cards no longer clip their content. No page errors, unexpected console errors or horizontal page overflow in the completed run.
- The extension preparation action succeeded against the bundled backend after JSON request validation was introduced.
- `npm audit --omit=dev`: zero reported vulnerabilities after compatible dependency updates.

Tests use synthetic data, random local ports and temporary directories under `.codex-artifacts`. The existing running application and its saved data were not used as test fixtures. Screenshots are saved under `.codex-artifacts/tastetwin-verified*.png`.

## Remaining limits

- Full dependency audit still reports 24 findings in Electron Forge's development/installer chain (3 low, 20 high, 1 critical), involving `extract-zip`, `tar` and `tmp`. The suggested forced fix would downgrade Forge incompatibly; it was not applied.
- Live Letterboxd crawling, authenticated TMDB enrichment, Chrome extension installation and Windows installer installation were not exercised. HTTP bridge contracts and the bundled server were tested locally.
- Old merged imports cannot reveal whether a saved date came from `watched.csv` or the diary. Reimporting the original export is required to correct previously saved dates, rewatch counts and overwritten ratings.
- Local API checks restrict browser access. They do not authenticate other local processes. Unpacked Chrome extension origins are supported by default; `TASTETWIN_EXTENSION_ORIGINS` optionally narrows the allowed extension IDs.

Network-policy references: [Chrome extension network permissions](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests) and [MDN CORS](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS).
