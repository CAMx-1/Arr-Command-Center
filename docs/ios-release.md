# iOS release checklist

## Version and build

- Marketing version: `1.0.0`
- Build number: `1` (increment for every TestFlight/App Store upload)
- Bundle identifier: `app.arrcommandcenter.mobile`
- Minimum deployment target: iOS 13.0

Update `MARKETING_VERSION` and `CURRENT_PROJECT_VERSION` in the App target before each release. Keep `package.json` aligned with the marketing version.

## Validation

```bash
npm test
npm run ios:sync
npm run ios:build:sim
npm run ios:validate:release
```

On a physical iPhone verify:

- Fresh install and first-run server validation
- Existing install upgrade and version-aware refresh
- Cloudflare Access and Plex login persistence
- Light/dark status-bar contrast
- Keyboard behavior, safe areas, rotation, and Dynamic Type
- Haptics, bottom navigation, long-press actions, modal swipe dismissal
- Offline/server-down recovery and explicit Retry
- Settings favorite ordering and diagnostic export redaction
- Notification education, categories, deep links, and badge clearing

## Archive and export

A paid Apple Developer account, an App Store Connect record, and valid signing assets for the configured team are required.

```bash
npm run ios:archive
xcodebuild -exportArchive \
  -archivePath ios/App/build/ArrCommandCenter.xcarchive \
  -exportPath ios/App/build/export \
  -exportOptionsPlist ios/ExportOptions.plist
```

Validate the archive in Xcode Organizer before upload. The repository does not store certificates, provisioning profiles, App Store credentials, or API keys.

## Privacy and security

- `PrivacyInfo.xcprivacy` declares no tracking or collected data and the app's preferences access.
- Diagnostic export is user-initiated and redacts query credentials, bearer/basic authorization, and Cloudflare Access secrets.
- ATS exceptions are scoped to local networking and WebView content because the app connects to user-supplied self-hosted HTTP/HTTPS servers.
- App Review note: Arr Command Center is a client for user-owned self-hosted services; users may intentionally connect to private LAN hosts or private certificates.
- Local-only mode stores service credentials on the device. Server mode is recommended because upstream secrets stay on the companion server.

## App Store assets

Capture current screenshots on at least:

- 6.9-inch iPhone: Overview, service library, Settings favorites
- 6.5-inch iPhone: Overview and notifications
- 5.5-inch iPhone if requested by App Store Connect
- iPad 13-inch if iPad distribution remains enabled

Suggested subtitle: `Your self-hosted media command center`

Release notes should mention Settings-based favorites, native update reliability, connection recovery, accessibility, and diagnostics. Do not include server addresses, usernames, media titles, or notification content in screenshots.
