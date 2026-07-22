# TasteTwin

TasteTwin is a local-first Letterboxd social graph and movie taste matching app.

## What it does

- Imports a member's full Letterboxd export ZIP or CSV.
- Reads following and follower lists through the companion Chrome extension.
- Finds mutuals, non-followers, new followers, and lost followers.
- Compares the imported archive with recent public RSS activity from other members.
- Keeps imported and scanned data on the user's computer.

## Install on Windows

1. Download `TasteTwin-Setup.exe` from the latest GitHub Release.
2. Install and open TasteTwin.
3. Download the extension ZIP from inside the app and extract it.
4. Open `chrome://extensions`, enable Developer mode, and choose Load unpacked.
5. Select the extracted extension folder.

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

## Privacy

See [PRIVACY.md](PRIVACY.md).
