# Chrome Web Store Privacy Practices

## Single purpose

User-initiated scanning of the current member's visible Letterboxd following/follower graph and transfer of that result to the TasteTwin application running locally on the same computer.

## Permission justifications

- `activeTab`: Sends the explicit scan command to the active Letterboxd profile tab after the user clicks a scan button.
- `storage`: Stores only the last scan result, timestamp, and progress so interrupted popup sessions can resume displaying status.
- `https://letterboxd.com/*`: Reads follower/following pages needed for the user-requested social graph scan.
- `http://127.0.0.1:5173/*`: Transfers the completed scan to the TasteTwin application on the same computer.

## Data disclosures

- Website content: Yes. Letterboxd usernames, public display names, avatars, and following/follower relationships visible to the signed-in user.
- Web history: No.
- Authentication information: No. Passwords and authentication cookies are not read or transferred.
- Personally identifiable information: Usernames and public display names only, used for the extension's stated purpose.
- User activity: The extension acts only after a scan button is clicked and does not run analytics or advertising tracking.

## Limited use certification

The extension's use of information received from Chrome APIs complies with the Chrome Web Store User Data Policy, including the Limited Use requirements. Data is used only for the extension's single purpose, is not sold, is not used for advertising, and is not transferred to third parties.

## Remote code

No. All executable extension code is included in the uploaded package.

## Privacy policy URL

https://github.com/alpalbayrak91-boop/tastetwin/blob/main/PRIVACY.md
