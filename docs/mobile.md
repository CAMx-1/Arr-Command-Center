# Arr Command Center — iOS app (Capacitor)

The iOS app wraps the **existing web UI** (`public/`) in a native shell using
[Capacitor](https://capacitorjs.com). The same code that runs in the browser runs
in the app; a small bridge (`public/capacitor-bridge.js`) makes the packaged UI
talk to your server.

> **Status:** *Server mode* — the app bundles the UI and connects to a running
> Arr Command Center backend (the Node server / Docker container) that you point
> it at on first launch. A *direct mode* (talking straight to Sonarr/Radarr/etc.
> from the device with no backend, LunaSea-style) is a planned follow-up; see
> "Roadmap" below.

## How it works

- The web UI is copied into the native project (`ios/App/App/public`) by
  `npx cap sync ios` / `npx cap copy ios`.
- In a browser the UI is same-origin with the API, so `/api/...` calls work as-is
  and the bridge is a **no-op**.
- In the native app the UI is served from `capacitor://localhost`, which is *not*
  same-origin with your stack. The bridge rewrites relative `/api/...` requests
  (and `EventSource`) to a **server base URL** you enter on first launch (stored
  in `localStorage` under `acc:server-base`). Absolute URLs (e.g. TMDB artwork)
  pass through untouched.
- `Info.plist` includes an App Transport Security exception
  (`NSAllowsArbitraryLoads`) plus `NSLocalNetworkUsageDescription`, because a
  self-hosted server is often on the LAN over HTTP or HTTPS with a private/
  self-signed certificate.

## Prerequisites (build machine)

- **macOS** with **Xcode** (full install, not just Command Line Tools).
- **CocoaPods** — `sudo gem install cocoapods` (or `brew install cocoapods`).
- **Node ≥ 23** and this repo's dependencies installed (`npm install`).
- An Apple ID / Developer account for signing (free account works for running on
  your own device via a development profile).

## Build & run

```bash
npm install                 # installs Capacitor (already in package.json)
npm run ios:sync            # copies web assets + runs `pod install`
npm run ios:open            # opens ios/App/App.xcworkspace in Xcode
```

Then in Xcode:

1. Select the **App** target → **Signing & Capabilities** → set your Team.
2. Choose a simulator or a connected device.
3. Press **Run** (▶).

On first launch the app shows a **Connect to your server** screen. Enter your
Arr Command Center URL, e.g.:

- `http://192.168.1.50:7373` (LAN), or
- `https://arrcc.example.com` (reverse-proxied).

The app then behaves exactly like the web dashboard. To change the server later,
clear the app's storage / reinstall (a Settings entry for this is on the roadmap).

## Updating the app after web changes

Any change under `public/` just needs a re-sync before rebuilding:

```bash
npm run ios:copy            # copy updated web assets into the native project
# or `npm run ios:sync` to also refresh native plugins/pods
```

## npm scripts

| Command            | Description |
|--------------------|-------------|
| `npm run ios:add`  | Scaffold the native iOS project (`ios/`). Run once. |
| `npm run ios:copy` | Copy `public/` web assets into the native project. |
| `npm run ios:sync` | Copy assets **and** update native deps (`pod install`). |
| `npm run ios:open` | Open the Xcode workspace. |

## Project layout

```
capacitor.config.json          # appId/appName/webDir=public + iOS settings
public/capacitor-bridge.js     # web↔native networking bridge + first-run connect
ios/                           # generated native Xcode project (committed)
  App/App.xcworkspace          # open THIS in Xcode (not the .xcodeproj)
  App/App/Info.plist           # ATS + local-network usage exceptions
  App/App/public/              # synced web assets (git-ignored; run cap copy)
```

## Roadmap

- **Direct mode (no backend):** talk straight to Sonarr/Radarr/Overseerr/SABnzbd/
  qBittorrent/Tautulli/Plex from the device (native HTTP plugin bypasses CORS and
  sets `X-Api-Key` / Cloudflare Access headers), storing per-service credentials
  in the iOS Keychain. The backend container then becomes optional — needed only
  for host system metrics and scheduled automation.
- **Push notifications:** a webhook → APNs/FCM relay (LunaSea-style) so the *arr
  apps push events to the device without an always-on poller on the host.
- **In-app server management:** change/add servers from Settings instead of only
  at first run.
