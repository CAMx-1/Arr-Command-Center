# 🎬 Arr Command Center

A single, locally-hosted web dashboard to view and manage your whole media stack —
**Sonarr**, **Radarr**, **Lidarr**, **Bindery** (with legacy **Readarr** fallback), **Overseerr/Seerr**, **SABnzbd**,
**qBittorrent**, **Transmission**, **Deluge**, **NZBGet**, **Flood**, **Tautulli**, **Bazarr**, **Prowlarr**, **Plex**, **Jellyfin**, **Emby**,
**Audiobookshelf**, **Autobrr**, **Maintainerr**, **Tdarr**, **Portainer** (read-only), **Glances**, **Pi-hole**,
**AdGuard Home**, **Syncthing**, **Navidrome**, **Pulsarr**, **Whisparr**, **TrueNAS**, **Unraid**, **Unpackerr**,
**Speedtest Tracker**, and any Newznab **indexer** — from one place.

Built as a self-hosted replacement for the now-discontinued **LunaSea** iOS app. Because
it's a responsive web app, it works from your phone's browser (and you can "Add to Home
Screen" for an app-like experience), your laptop, or anywhere on your network.

The key feature: a small **backend proxy** that injects your **Cloudflare Access service
token** headers (`CF-Access-Client-Id` / `CF-Access-Client-Secret`) and each service's API
key on every request. That means your services can stay locked down behind Cloudflare
Access, and secrets never touch the browser.

## Watch the promo



https://github.com/user-attachments/assets/7a740e3c-3042-4dfe-b002-9ec1d6c8a551



*34-second tour: unified dashboard, Seerr requests, SABnzbd downloads, Tautulli streams,
and the iOS app with local-only mode. Click the image to play.*

## Setup & walkthrough video

[![Setup and walkthrough video](docs/tutorial-poster.jpg)](docs/tutorial.md)

*5½ minutes, from `git clone` to a working dashboard: add a service, tour every menu and
setting, then the iPhone app in server and local-only mode. Chapters and notes are in
[docs/tutorial.md](docs/tutorial.md), or [download the video](docs/tutorial.mp4).*

---

## Screenshots

### Overview dashboard

![Arr Command Center home dashboard](docs/home-page.png)

*Live status hexes for every service (37 in the demo, including Unpackerr and Speedtest
Tracker) with at-a-glance stats, a filterable activity
feed, and a Seerr requests panel. The whole Overview is customizable — reorder, resize,
show/hide widgets, and keep multiple dashboards (see Settings).*

### iPhone app

![Arr Command Center on iPhone: overview, request progress, ratings and live streams](docs/mobile.png)

*The same dashboard as a native iOS app (or an installable web app) with a hex bottom
bar for your favorite services — approve requests, track downloads, check ratings and
stop streams from your phone.*

### Sonarr library (Hexagon view)

![Sonarr library in hexagon view](docs/sonarr-library.png)

*Poster hexes show monitored status and episode progress, with per-title Info, Seasons,
Search, and Auto actions. Tabs across the top add Calendar, Wanted, Queue, History, and a
full System panel — and you can save filtered "views" for one-click recall.*

### Radarr library (List view)

![Radarr library in list view](docs/radarr-library.png)

*A compact list view with download/monitor status, file size, and quick actions. Toggle
between Hexagon, List, and Table per page — your choice is remembered and reflected in the
URL so you can bookmark or share it.*

### Sortable table view

![Sonarr library in sortable table view](docs/sonarr-table.png)

*The Table view turns any library into a dense, sortable grid — click a column to sort,
tick rows for bulk actions, and combine it with the title filter, status dropdown, and
saved views.*

### Filter your library

![Filtering the library by title and status](docs/library-filter.png)

*Filter Sonarr/Radarr/Lidarr/Readarr libraries instantly by title, plus a status dropdown
(Monitored, Missing, Downloaded, Continuing, …). The filter, sort, and view mode all live
in the URL for deep-linking.*

### Overseerr / Seerr requests

![Overseerr pending requests with approve and decline](docs/overseerr.png)

*Approve or decline pending requests with one click, browse All Requests, Issues, and
Recently Added, or jump to Discover to create a new request — posters pulled straight
from TMDB.*

### Live request progress

![All Requests with live download progress bars](docs/requests.png)

*Every request shows where it really is — awaiting approval, downloading with percent and
time left, upgrading, available, or an import that needs attention — matched against the
Sonarr/Radarr queues.*

### Ratings and where to watch

![Detail popup with Rotten Tomatoes, IMDb and streaming providers](docs/detail-ratings.png)

*Open any title for a rich detail view: TMDB, Rotten Tomatoes and IMDb ratings, runtime,
genres, and where it's streaming, renting or for sale in your region.*

### Calendar

![Calendar of upcoming episodes and movie releases](docs/calendar.png)

*One calendar across every Sonarr and Radarr instance, with per-instance filter chips and
a next-7-days list.*

### Cleanup

![Cleanup page listing unwatched titles by size](docs/cleanup.png)

*Find space to reclaim: titles nobody has watched (from Tautulli history) in a chosen
window, largest first, skipping recent additions — remove them straight from the list.*

### Tautulli — active streams

![Tautulli active streams](docs/tautulli.png)

*See who's watching what: active stream count, direct-play/transcode, bandwidth, and
now-playing details with a Stop control, plus History, Statistics, and Graphs tabs.*

### Settings

![Settings with tabs and an open Weekly digest row](docs/settings.png)

*Settings are grouped into tabs (You, Notifications, Services, Automation, Admin, System).
Each row shows its current value and opens in place; search finds any setting, and badges
flag what needs attention. Only the tabs your role can use are shown.*

### Service uptime

![Service cards with 24-hour uptime bars](docs/uptime.png)

*Each service card shows a 24-hour uptime bar and percentage. If a service stays down for
two minutes you get a "down" alert, and a "recovered" alert when it comes back.*

### Notification channels

![Push notification categories and ntfy/Discord channels](docs/notifications.png)

*Choose what to be alerted about (including problems and the weekly digest), then fan
alerts out to ntfy, Gotify, Discord, Telegram, email, Pushover, Slack, Matrix, Apprise or any
webhook, each with its own categories. ntfy alerts for new requests include Approve/Decline buttons, so you can
act from the lock screen.*

### Push notifications (iOS / Safari)

<img src="docs/push-notifications.jpg" alt="Web push notification on iPhone" width="320" />

*Native Web Push on iPhone (add to Home Screen), plus desktop browsers — a background poller sends alerts for completed downloads, failures, and requests needing approval, with per-category toggles.*

---

## Why a backend proxy?

Your services sit behind Cloudflare Access. To reach their APIs, each request needs:

1. `CF-Access-Client-Id` and `CF-Access-Client-Secret` headers (the Cloudflare Access
   **service token**), and
2. the service's own API key (`X-Api-Key` for the *arr apps / Overseerr, `?apikey=` for
   SABnzbd).

A browser **can't** safely hold those secrets or set the Cloudflare headers on cross-origin
requests. So this app runs a tiny Node server next to your stack that:

```
Browser ──▶ /api/proxy/<service>/<path> ──▶ Node proxy ──▶ https://service.example.com
                                             (adds CF-Access-* headers + API key)
```

Only the dashboard is exposed to you; the secrets live on the server in `config.json`
(or environment variables).

---

## Quick start (demo mode — no real services needed)

```bash
npm install
npm run demo
```

Then open <http://localhost:7373>. This spins up a full set of **bundled mock services**
(Sonarr, Radarr, Lidarr, Bindery, legacy Readarr, Overseerr, SABnzbd, qBittorrent,
Transmission, Deluge, NZBGet, Flood, Jellyfin, Emby, Audiobookshelf, Tautulli, Bazarr,
Autobrr, Maintainerr, Tdarr, a Plex Media Server, and a Newznab indexer) with fake data so you can click around immediately. The mock services
even *require* the injected API key and record the Cloudflare Access headers, proving the
proxy works end-to-end.

## Real setup

```bash
npm install
cp config.example.json config.json
# edit config.json with your URLs, API keys, and Cloudflare Access token
npm start
```

Open <http://localhost:7373>.

**Or let it find your apps:** start with `"services": {}` in `config.json`. The first visit
opens the setup wizard. It looks for Sonarr, Radarr, Seerr, Plex and the rest on this server,
the Docker host, the usual Docker container names (`sonarr`, `radarr`, …) and any hosts you
type in. Tick the switch to also try every address on the server's own /24 network. For each
app it finds, it asks only for the API key (or login), checks it, and saves the service. It
only contacts private addresses and only opens each app's public login page; it never sends
or guesses keys while looking. Run it again any time from **Settings → Services → Find
services** (admins). If `config.json` is read-only, as in the Docker setup, it saves the
services in `data/services.json` instead (see [Docker](#docker)). If the data folder can't be
written either, it checks each key and gives you the lines to paste into `config.json`.

---

## Configuration

Copy `config.example.json` → `config.json` and fill it in:

```jsonc
{
  "port": 7373,
  "host": "0.0.0.0",
  "auth": {
    "enabled": false,          // set true to require basic-auth on the whole dashboard
    "username": "admin",
    "password": "change-me"
  },
  "services": {
    "sonarr": {
      "label": "Sonarr",
      "type": "sonarr",         // sonarr | radarr | lidarr | bindery | readarr |
                                //   overseerr | sabnzbd | qbittorrent | transmission |
                                //   deluge | nzbget | flood | jellyfin | emby |
                                //   audiobookshelf | tautulli | bazarr | prowlarr |
                                //   autobrr | maintainerr | tdarr | indexer | plex
      "enabled": true,
      "baseUrl": "https://sonarr.example.com",
      "apiKey": "YOUR_SONARR_API_KEY",
      "cloudflareAccess": {
        "clientId": "xxxxxxxx.access",
        "clientSecret": "yyyyyyyy"
      }
    }
    // ... radarr, lidarr, bindery, readarr, overseerr, sabnzbd, qbittorrent,
    //     transmission, deluge, nzbget, tautulli, bazarr, prowlarr, indexer, plex
  }
}
```

Where to find each **API key**:

| Service     | Location |
|-------------|----------|
| Sonarr      | Settings → General → API Key |
| Radarr      | Settings → General → API Key |
| Lidarr      | Settings → General → API Key |
| Bindery     | Settings → General → Security → API Key |
| Readarr (legacy) | Settings → General → API Key |
| Prowlarr    | Settings → General → API Key |
| Overseerr   | Settings → General → API Key |
| SABnzbd     | Config → General → API Key |
| Tautulli    | Settings → Web Interface → API Key |
| Bazarr      | Settings → General → API Key |
| Indexer     | Newznab: your account's API key |
| qBittorrent | API key (5.2+) or WebUI username/password |
| Transmission | Optional RPC Basic-auth username/password |
| Deluge      | Deluge Web password |
| NZBGet      | `ControlUsername` / `ControlPassword` |
| Plex        | Signed in with your Plex account — no manual key needed |
| Jellyfin    | Dashboard → API Keys |
| Emby        | Dashboard → Advanced → Security → API Keys |
| Flood       | Your Flood login username/password (ACC keeps the session server-side) |
| Audiobookshelf | Settings → API Keys (v2.26+), or your user's API token. Live sessions need an admin key |
| Autobrr     | Settings → API keys |
| Maintainerr | No API key — Maintainerr has no API auth, so keep it on your LAN/VPN |
| Tdarr       | Only if server auth is enabled: Tools → API Keys |

### Users and roles (Sign in with Plex)

With `auth.plex.enabled`, each person who signs in has a role:

| Role | Can |
|------|-----|
| admin | Everything: settings, services, users, logs and deleting |
| user | Browse, request, search, grab and manage downloads. No settings, no deleting |
| guest | Read-only |

Everyone in `auth.plex.allowedUsers` is an admin, so existing setups keep full
access. Add people and change roles in **Settings → Users & roles** (admins
only); those entries are stored in `data/store.json`. You can also set roles in
`config.json` with `auth.plex.roles` (for example `{ "kid@example.com": "guest" }`).
With `allowAnyPlexUser`, people who aren't listed get `auth.plex.defaultRole`
(default `guest`). Roles are enforced by the server on every request, and
removing someone or changing their role takes effect on their next request.

**Services each role can see** — in the same section, turn off **All services** for users or
guests and tick the services they may use. Admins always see everything. A hidden service is
left out of the sidebar, Home, search, status, uptime and the activity feed for that role, and
the server refuses every request to it (the proxy, live updates and the service's own pages).
Push notifications about a hidden service only go to people who can see it. While All services
is on, services you add later are included.

**Two-factor sign-in** (admins) — **Settings → You → Sign-in & security**. After Plex, the
sign-in page asks for a second step: a 6-digit code from an authenticator app (1Password, iOS
Passwords, Google Authenticator, Authy, …) or a **passkey** (Touch ID, Face ID, Windows Hello, a
security key, or a password manager that keeps passkeys). Setting up the app shows a QR code to
scan, a link that opens the app, and the key to type in. The first method you add gives you 10
one-time recovery codes, shown once, and signs out your other browsers. A code is accepted 30
seconds either side of now and only once; five wrong codes pause code entry for a few minutes.
Passkeys need the server on https (or `localhost`) and only work on the address they were made
on. Removing a passkey, turning two-factor off or making new recovery codes asks you to confirm
it's you first. If you lose your phone and your recovery codes, stop the server, remove your
entry (your Plex username in lower case) under `"twoFactor"` in `data/store.json`, and start it
again.

**Where you're signed in** — the same section lists each browser signed in to your account
(device, last active, IP), with **Sign out** for each and **Sign out everywhere else**. Admins
also see everyone else's sessions and can end them. Signing out ends the session on the server,
so a copied cookie stops working too. Two-factor and the session list need Sign in with Plex;
with Basic auth, change the password to sign everyone out.

**Confirm it's you** — with two-factor on, deleting files (removing a title with its files,
deleting a file, removing a download with its data), changing roles or the services a role sees,
and making or restoring a backup of Arr Command Center ask for a code, a recovery code or a
passkey, unless you confirmed in the last 10 minutes. Signing in with two-factor counts. The
server checks it on each of those requests, and the page retries the request after you confirm.

**Sign-in alerts** — when your account signs in on a browser it hasn't used before, you get a
push notification on your devices (category "Sign-ins from a new device"); an admin's alert also
goes to the notification channels. An account's first browser doesn't alert, and browsers that
were already signed in are remembered without one. **Known browsers** in the same section lists
them, and **Forget the other browsers** makes the next sign-in anywhere else alert. Turning
alerts off asks you to confirm it's you. The Login log marks sign-ins from a new browser.

### Migrating Readarr to Bindery

Readarr was archived in June 2025. Arr Command Center keeps Readarr available as an
explicit legacy fallback, but new book-manager setups should use Bindery.

1. In Bindery, open **Settings → Import** and upload the old `readarr.db` (or run
   `bindery migrate readarr /path/to/readarr.db`). Bindery imports authors, indexers,
   download clients, and blocklist; existing files are attached later with its Library Scan.
2. Add Bindery to Arr Command Center as a separate `bindery` service using the API key
   from **Bindery → Settings → General → Security**.
3. Keep the Readarr service enabled until you have verified the migrated catalogue and
   downloads. The two pages remain separate: ArrCC never redirects searches or destructive
   queue actions from one database to the other automatically.

See Bindery's [official migration guide](https://github.com/vavallee/bindery/blob/main/docs/Migrating-From-Readarr-Wiki.md)
for two-instance ebook/audiobook migrations and library-scan details.

### Environment variable overrides

Any secret can be supplied via environment variables instead of `config.json` (handy for
Docker/secrets). See `.env.example`. Pattern:

```
SONARR_BASE_URL, SONARR_API_KEY, SONARR_CF_CLIENT_ID, SONARR_CF_CLIENT_SECRET
RADARR_...   LIDARR_...   BINDERY_...  READARR_...   OVERSEERR_...   SABNZBD_...
TAUTULLI_... BAZARR_...   PROWLARR_...  QBITTORRENT_... TRANSMISSION_...
DELUGE_...    NZBGET_...   FLOOD_...    JELLYFIN_... EMBY_...
AUDIOBOOKSHELF_... AUTOBRR_... MAINTAINERR_... TDARR_... INDEXER_...
```

`TELEGRAM_API_BASE` points the chat-request bot at a self-hosted Telegram Bot API server
(default `https://api.telegram.org`).

Env values **override** the matching value in `config.json`.

---

## Cloudflare Access setup

To let this app authenticate through Cloudflare Access, create a **service token** and
allow it on the relevant Access applications.

1. **Create a service token**
   Cloudflare Zero Trust dashboard → **Access → Service Auth → Service Tokens → Create**.
   Copy the **Client ID** (ends in `.access`) and **Client Secret** (shown once).

2. **Allow the token on each app**
   For each Access application protecting a service (Sonarr, Radarr, Overseerr, … ):
   **Access → Applications → (your app) → Policies →** add/edit a policy with
   **Action: Service Auth** and an **Include** rule of
   **Service Token → (your token)**.

   > Use a **Service Auth** policy (not Allow) so the token bypasses the interactive login.

3. **Put the token in your config**
   Use the same Client ID / Secret in each service's `cloudflareAccess` block (or the
   `*_CF_CLIENT_ID` / `*_CF_CLIENT_SECRET` env vars). You can reuse one token across all
   services if that token is allowed on each app.

The proxy sends these as `CF-Access-Client-Id` and `CF-Access-Client-Secret` headers on
every upstream request — exactly what Cloudflare Access expects for service tokens.

---

## Docker

Run it right next to your arr stack.

**docker compose (recommended):**

```bash
cp config.example.json config.json   # edit with your values
docker compose up -d --build
```

`docker-compose.yml` bind-mounts your `config.json` read-only. Services you add, change or
remove in Settings (or with the setup wizard) are then saved in `data/services.json`, which is
applied over `config.json` when the server starts. Settings marks those services **Saved in data
folder**, and the server log lists the `config.json` services it changes. To go back to the
`config.json` version of a service, delete its entry from `data/services.json` (or the whole
file) and restart. Prefer env vars? Drop the volume and use `env_file: .env` instead (see the
commented lines); environment variables still win over both files.

### System Monitor disks in Docker

Containers cannot see host disks unless each disk is explicitly bind-mounted. On Docker
Desktop for macOS, mount each volume separately—do **not** mount `/Volumes` as one parent,
because Docker then reports the startup disk's capacity for every child volume.

For Compose, uncomment/add one bind per disk plus `SYSTEM_DISKS`:

```yaml
services:
  arr-command-center:
    volumes:
      - ./config.json:/app/config.json:ro
      - ./data:/app/data
      - /Volumes/New-14:/Volumes/New-14:ro
      - /Volumes/12-1:/Volumes/12-1:ro
    environment:
      - PORT=7373
      - HOST=0.0.0.0
      - SYSTEM_DISKS=/Volumes/New-14,/Volumes/12-1
```

Then recreate the container with `docker compose up -d --build --force-recreate`.
The mounts are read-only; the dashboard only calls filesystem-stat APIs and does not read
media contents. `SYSTEM_DISKS` may be omitted to auto-discover eligible directory mounts,
but setting it is recommended so only the intended disks appear.

For plain Docker, use the equivalent individual mounts:

```bash
docker run -d --name arr-command-center \
  -p 7373:7373 \
  -v "$PWD/config.json:/app/config.json:ro" \
  -v "$PWD/data:/app/data" \
  -v "/Volumes/New-14:/Volumes/New-14:ro" \
  -e SYSTEM_DISKS=/Volumes/New-14 \
  arr-command-center
```

**Prebuilt image (no build needed):** every release is published to GitHub Container
Registry for `linux/amd64` and `linux/arm64`:

```bash
mkdir -p data
docker run -d --name arr-command-center \
  -p 7373:7373 \
  -v "$PWD/config.json:/app/config.json:ro" \
  -v "$PWD/data:/app/data" \
  --log-opt max-size=10m --log-opt max-file=3 \
  ghcr.io/camx-1/arr-command-center:latest
```

Tags: `latest` (newest release), `1.2.1` / `1.2` / `1` (pin a release line), `edge`
(current `main`), and `sha-<commit>`. Update with `docker pull` + recreate the container.

**Plain docker:**

```bash
docker build -t arr-command-center .
mkdir -p data
docker run -d --name arr-command-center \
  -p 7373:7373 \
  -v "$PWD/config.json:/app/config.json:ro" \
  -v "$PWD/data:/app/data" \
  --log-opt max-size=10m --log-opt max-file=3 \
  arr-command-center
```

Always mount `data/`: it holds everything the app saves (services saved from Settings, users
and two-factor, custom links, push subscriptions, notification channels, automation state, disk
history, login log, Plex token, and the copies made before restoring a backup) and the Plex
sign-in secret. Without it, that data is lost and everyone is signed out on each rebuild.
Behind HTTPS (e.g. Cloudflare Tunnel), also pass `-e SECURE_COOKIES=true`.

If your arr services are also in Docker, put this container on the **same Docker network**
and you can use internal hostnames as `baseUrl` (e.g. `http://sonarr:8989`). Note that
internal traffic typically bypasses Cloudflare Access — in that case just omit the
`cloudflareAccess` block for those services.

---

## Features

**Newer integrations** (server mode only; not available in the iOS local-only mode yet)
- **Portainer** — environments and containers grouped by stack, with health. Admins can
  start, stop and restart a container (with a confirmation); the proxy refuses every other
  write (create, delete, exec, stacks, settings). Container inspect/logs are admin-only
  because they can contain secrets. Auth: a Portainer access token.
- **TrueNAS** (25.04+) — pools with health, space and scrubs; disks with temperatures;
  apps with update status; alerts. Read-only, over TrueNAS's JSON-RPC WebSocket API (its
  REST API is removed in TrueNAS 26). Needs an `https://` URL because TrueNAS revokes API
  keys sent over plain http; for a self-signed certificate start the server with
  `NODE_EXTRA_CA_CERTS=/path/to/ca.pem`.
- **Unraid** (7.2+ API) — array state, capacity, parity check, every disk with status,
  errors and temperature (standby when spun down), Docker containers and VMs. Read-only:
  only GraphQL queries are forwarded. Auth: an API key (the Viewer role is enough).
- **Glances** (API v4) — CPU, memory, load, disks, temperatures from the `sensors` plugin,
  and containers. Optional Basic auth if Glances runs with `--password`.
- **Pi-hole v6** — queries, blocked %, top domains and clients; admins can pause blocking.
  ACC signs in with the web or app password and reuses one session (Pi-hole limits them).
- **AdGuard Home** — the same stats and a protection pause, using your login.
- **Syncthing** — folder sync state, what's left to sync, devices, and a rescan button.
- **Navidrome** — songs, album artists (credited-only people aren't counted), now playing,
  recently added, and a library scan. Uses salted Subsonic tokens, never the raw password.
- **Pulsarr** — approval queue (admins approve or reject) and recent watchlist requests.
- **Whisparr v2** — uses the Sonarr screens, since it speaks the Sonarr v3 API.
- **Unpackerr** (v1+, the version with the web UI on port 5656) — the extract queue and
  history, with a plain reason for each stuck item (wrong password, missing archive part,
  damaged archive, disk full, permissions, extracted but not imported) and what to do.
  Users can retry a failed extract; forgetting an item needs delete rights. Auth: an API key
  from Settings → Web server (queue and history read, plus queue write to retry).
- **Speedtest Tracker** (v1 API) — latest down/up/ping, averages and a chart of past tests,
  with a line for what your download clients are pulling right now. Users can start a test.
  Auth: an API token from Admin → API tokens ("Read results", plus "Run speedtest").

**Back up Arr Command Center** (Settings → System, admins) — one file with your services and
their API keys, users and roles and the services each role sees, two-factor and passkeys,
notification channels, push devices and categories, the weekly digest, the chat bot, incoming
webhook addresses, automation, links, everyone's saved settings, and the history behind the
disk forecast, the activity log and the login log. The file is encrypted with a passphrase you
choose (at least 10 characters). Nobody can open it without the passphrase, and a lost passphrase
can't be recovered. Not in the file: `config.json`'s sign-in settings, port and disks, and who's
signed in. **Restore** opens a backup and shows, part by part, what's in it and what's here now;
tick the parts to put back. Services in the backup are added or replaced, and services that
aren't in it stay. History is joined with what's here. Each other part replaces what's here.
Before anything changes, what will be replaced is saved as another backup with the same
passphrase in `data/backups/` (the last five are kept and can be downloaded from the same
section). It won't restore a user list in which you're no longer an admin, and it warns when it
would turn your two-factor on or off. Restored services go to `config.json`, or to
`data/services.json` when `config.json` is read-only. This is separate from **Backups** (the
apps' own backups) and from the iPhone app's local-mode backup.

**Settings that follow you** (Settings → You → Settings on every device) — your theme, colour
and density, pinned, ordered and hidden services, Home workspaces, and list or hexagon views
are saved to your account on the server, so every browser you sign in on looks the same. A
browser that hasn't synced before takes the account's settings, and a message says which ones.
After that, a change on one browser reaches the others when they next open or you come back to
the tab, and different settings changed on two browsers at the same time are both kept. Turn it off on a device to let
that device keep its own settings. Saved per Plex user, or as one shared profile with Basic
auth; with no sign-in it's off. Only those settings are saved, never service addresses or keys.

**Year in review** (Home in December and January; Settings → You; Tautulli → Year in review) —
a year of watching from Tautulli: hours watched, plays, top five shows and films, the busiest
night, the longest binge and streak, what you rewatched and what you watched on, and how it
compares with last year (up to the same day while the year is still going). It comes with a
picture to save or share, with the top show's and top film's posters: a hexagon (a 1232 × 1410
PNG with see-through corners), a box (1080 × 1350, easier to read on a phone) or, with the
**Picture / Story** switch, a story (1080 × 1920, the size of a phone story). Hex is the default
on desktop and Box on phones; the **Hex / Box** switch changes it on that device only. Tap the
picture to see it full screen: pinch, double-tap, scroll or press + and − to zoom, drag to move
around, and swipe down or press Escape to close. On phones the hours, top shows and films are
also written out under the picture. **Month by month** shows a tower of hexagons for each month,
with the busiest month lit up; tap a month for its hours and its three most watched titles.

**Play the year** shows the year as a slideshow, one card at a time: tap the right side to go on
and the left to go back, hold to pause and swipe down to close (or use the arrow keys and space).
With reduced motion turned on, it waits for you instead of moving on by itself. The last card
has the picture, with Save and Share.

Everyone sees their own year, matched to Tautulli by Plex username, email or friendly name;
admins can pick anyone, or everyone together. Plays shorter than a minute don't count, times are
in your browser's time zone, and plays after midnight count for the evening before, until 5 am.
Earlier years are there too, and before December the year so far. On Home, **Play** starts the
slideshow, **Open** shows the year and **Hide** removes the card for that year.

In December there's a push notification, "Your 2026 in review is ready", once a year after
10 am (server time), for anyone who watched at least an hour; tapping it plays the year. With
Sign in with Plex, each person's own devices get it; with a shared sign-in, every device gets it
if anyone watched an hour. Turn it off with the push category "Year in review is ready
(December)". It isn't sent to notification channels, because it's addressed to one person.

**Disk-full forecast** (Home; System tab) — the server notes each disk's free space once a day
(through Sonarr, Radarr, Whisparr, Lidarr and Readarr) and works out when it will fill from the
last 30 days; for the first week it uses the library growth from Insights instead. Home shows a
card when a disk is expected to fill within 30 days, and the System tab shows the forecast under
each disk, with a chart. You get a notification (category "Problems") when a disk is expected to
fill within 30 days, and again within 7 days or when it's nearly full. **Hide for a week** hides
the card.

**Free up space** (the disk card on Home, or the System tab) — ranks the movies and shows on a
disk by the space they'd free and how much they're watched (Tautulli's history): never watched in
the 90 days or more since they were added, last watched over a year ago, or just large (20 GB or
more). Titles added in the last 30 days or watched in the last 90 aren't suggested. Titles
Maintainerr excludes or that are tagged `keep` in Sonarr/Radarr are listed as kept, and titles
Maintainerr is about to delete are marked. Set how much space you want and it ticks enough titles
to get there. Admins can delete the ticked titles through Sonarr/Radarr, with an import exclusion
and the Seerr request cleared. The files go to the app's Recycle Bin if it has one; you're asked
twice, and must tick a box first when an app has no Recycle Bin. CSV export.

**Missing from Plex** (Plex → Missing from Plex) — movies and episodes Sonarr and Radarr have
imported that Plex doesn't show, and folders no Plex library includes. Titles are matched by
folder (or folder name, when Plex sees the disks under other paths), then by TMDB/TVDB id. **Scan
this folder** asks Plex to scan just that folder, and **Scan them all** does every one. Users and
admins.

**Plex server and sharing** (Plex → Server, Plex → Friends & sharing) — the server's version and
each library with its item count and last scan, with **Scan** and **Refresh details** (users and
admins) and **Empty trash** (admins; asks twice). Friends & sharing (admins) lists who you share
with and which libraries: change their libraries, invite someone by Plex username or email (with
or without downloads), or stop sharing (asks twice). Sharing goes through plex.tv and needs the
Plex token of the server's owner.

**Setup doctor** (Settings → Services, and each app's System tab; admins) — reads your apps'
settings and points out the mistakes that usually stop imports or hard links, each with a plain
fix and a link: root folders the app can't reach, no download client, Completed Download
Handling off, hard links off with a torrent client, a download category that's empty, shared by
two apps or watched by none, download folders the app can't see (and the remote path mapping
that would fix it), torrents downloading to another disk than the library, Prowlarr not syncing
to an app, and the apps' own health warnings explained. It only reads. **Ignore** hides a finding
in this browser.

**Compatibility check** (Settings → Services, admins) — asks each app its version and what it
supports (it only reads), then lists which Arr Command Center tools will work with your setup and
what the rest need: for example Radarr 4.2 or newer for Collections, SABnzbd 4.3 or newer for
Instant updates, the Playback Reporting plugin for Jellyfin transcodes, or Plex's newer agents
for Wrong matches.

**More notification channels** — besides ntfy, Gotify, Discord, Telegram and webhooks: **email**
(any SMTP server, with TLS or STARTTLS; for Gmail or iCloud use an app password), **Pushover**,
**Slack** (an incoming webhook), **Matrix** (a room and an access token) and **Apprise** (an
Apprise API server, with a config key or Apprise URLs). **Test** shows the service's own error,
with your secrets removed.

**Send search results to an app** (Newznab indexer search, Prowlarr → Search) — besides **+ Send
to SAB** (indexer search) or **Grab** (Prowlarr, with its own download client), each result has
a button for each app that takes its category: TV → Sonarr/Whisparr, movies → Radarr, music →
Lidarr, books and audiobooks → Readarr/Bindery. Usenet and torrent results both work, including
magnet links. The app checks the release against its quality profile and, if it wants it, grabs
it with its own download client, so it's tracked and imported like the app's own grabs; Prowlarr
results show the indexer as "<name> (Prowlarr)" there. If it doesn't want it, you see the app's
reason. Users and admins. The buttons send through the server (see Security notes).

**Tidy up** (Sonarr, Radarr → System; the Tidy up button on Lidarr and Readarr) — finds ended
shows, artists and authors that are complete but still monitored, films still missing two years
after release, unmonitored entries with no files, and entries whose
quality profile or root folder is gone. Each group has a bulk fix for the ones you tick: unmonitor,
set a quality profile, remove the entries (their files are kept), or open Fix paths.

**Complete your collections** (Radarr → System → Collections) — collections (trilogies,
franchises) you've started but not finished, closest to complete first, from Radarr's own
collection list (Radarr v4.2+, no TMDB key needed). Add one film or all the missing ones, with a
quality profile, root folder and search-on-add choice that's remembered. Films you've excluded
in Radarr aren't suggested, and unreleased ones only when you ask.

**Missing subtitles** (Bazarr → Wanted) — how many episodes and films are missing each language,
episodes grouped by show, and a search for the shows and films you tick, in every language or
just one. That search sends one request per episode and language, one at a time (Bazarr searches
its providers before it answers); click the button again to stop. **Search all wanted** starts
Bazarr's own search instead.

**Titles that always transcode** (Tautulli → Transcodes) — titles played at least twice in the
last 7, 30 or 90 days where 60% or more of the plays transcoded, with the reason from Tautulli's
stream data (subtitles burned into the picture, a video codec the player can't play, a bitrate
over the player's limit, audio conversion, or only the container changing) and what to do about
it. **Tag for replacement** adds a `transcodes` tag to the title in Sonarr or Radarr. Jellyfin
and Emby have the same tab, from the Playback Reporting plugin's play log (which records the
video and audio conversion, so its reasons are less detailed).

**Seeding clean-up** (qBittorrent → Seeding clean-up) — finished torrents that have reached a
ratio and/or a seeding time (either or both; 0 ignores a limit), optionally only in some
categories or on some trackers. Torrents tagged `keep` are never touched. You see the list
first, then Remove (asks twice; admins). Deleting the files as well is off by default: Sonarr and
Radarr normally hard-link or copy downloads, but check yours don't move them before you turn it
on. The rules are saved per qBittorrent instance in this browser.

**Wrong Plex matches** (Plex → Wrong matches) — Plex movies and shows whose TMDB/TVDB id differs
from the Sonarr/Radarr entry in the same folder. Folders are matched by full path, or by folder
name when Plex and the apps see the disks under different mount points. **Fix match** (admins)
lists Plex's own match candidates, marks the one that agrees with Sonarr/Radarr, applies it and
refreshes the title's details. Needs a Plex service (`"type": "plex"`) with the server's address.
Jellyfin and Emby have the same check (→ Wrong matches), where **Identify** (admins) uses their
own search.

**Instant updates** (Settings → Services → Instant updates, admins) — Sonarr, Radarr, Lidarr,
Readarr, Whisparr, Prowlarr, Seerr and Tautulli can call a secret webhook address when something
happens, so open pages update and notifications go out at once instead of on the next check (up
to a minute). **Add to …** creates the webhook in an *arr app (its Settings → Connect) with every
event it supports switched on. Seerr and Tautulli get short instructions, including the JSON body
Tautulli needs. **New address** replaces the secret. Each app's row shows the last event received.
SABnzbd (4.3 or newer) and qBittorrent can call it too, so downloads update the moment they're
added or finish: SABnzbd through its built-in Apprise notifications (the steps give you the
address to paste), qBittorrent through Run external program. **Add to qBittorrent** fills that in
for "torrent finished" and, on qBittorrent 4.6 or newer, "torrent added", but never replaces a
program you already run there. The command needs `curl` (or `wget`) where qBittorrent runs, and
passes no torrent details. The apps must be able to reach this server: if Cloudflare Access or
another login is in front of it, let `/api/hooks/` through, or give the apps the server's local
address.

**Big libraries** — Sonarr and Radarr libraries keep only the rows, table rows or hexagons near
the screen in the page, so there's no "Load more" and long libraries scroll smoothly. With a
10,000-movie demo library, the table view opens in 0.3 s instead of 5 s and scrolling stays at
about 60 frames a second in every view.

**Sync from TRaSH Guides** (Sonarr, Radarr → System → Custom formats, admins) — pick one of
TRaSH's quality profiles; the preview lists each custom format as new, rules differ or up to
date, with the score change on the quality profile you choose (or formats only). Untick
anything you don't want, then Apply. Formats are matched by name. The guide data comes from
the public TRaSH-Guides GitHub repository and is cached for a day.

**Compare with…** (System tab, when you have two instances of the same app) — differences in
custom formats, quality profiles (settings, qualities, cutoff and scores), file naming, media
management, delay and release profiles between, say, Radarr and Radarr 4K.

**Check files** (System tab) — uses the media info Sonarr/Radarr already store to flag files
with no media info, no audio or video, a runtime far shorter than expected, a size far below
the quality's minimum, a 2160p label on an HD picture, or an old codec like XviD. Search again,
or Replace (deletes the file through the app, to its Recycle Bin if set, and searches; asks
first). CSV export.

It also checks **audio and subtitle languages** against the language you watch in (English unless
you pick another, or turn it off), from the language tags inside each file: no audio in your
language in a title whose original language is yours is a problem (an Italian-only copy of an
English film); your language not being the first audio track is a check (iTA-ENG releases start in
Italian in many players); a foreign-language title with neither audio nor subtitles in your language
is a note. A Japanese anime with English subtitles, or an English dub after the Japanese track, is
fine. Files without language tags aren't flagged (they're counted). "Not a problem" stops flagging a
file's languages, and when another copy of the title is on disk (a folder the app doesn't manage, or
another file for the episode in the show's folder) it's shown with a link to Find duplicates.

**Insights** (System tab) — storage by quality, resolution and video codec, the largest titles,
a rough HEVC saving estimate (assumes re-encoded H.264 ends up half the size) and growth over
time from a size snapshot the server saves once a day per instance.

**Never watched** (Seerr tab) — requests that have been available for 30–365 days but the
person who asked hasn't played, using Tautulli history matched by Plex rating key. Shows who
asked and who else watched. Unmonitor (users) or Delete with files (admins, asks first; also
clears the request in Seerr).

**Release and delay profiles** (System tab) — view everyone; admins add, edit and delete.
The default delay profile can't be deleted.

**Sonarr 5** (beta; tested with 5.0.0.2941 and an upgraded copy of a 4.0.20 library) — everything
works as with Sonarr 4, with these differences:
- Release profiles are read and saved through Sonarr's v5 API, so a profile can use several
  indexers. Sonarr 5's own options (excluded tags, rejecting unaired releases, season packs
  before every episode airs) are listed and kept when you save. Sonarr 5's older v3 API, which
  the rest of the app uses, stores "All indexers" as indexer 0, which matches no indexer, so a
  profile saved that way stops applying. Arr Command Center 1.12.0 and older saved it that way.
  Such profiles are marked "applies to no indexer"; saving one here repairs it.
- Sonarr 5 keeps size limits on each quality profile instead of the quality definitions, so
  **Check files** uses the item's quality profile.
- Interactive search always asks for a season (Specials for a series that only has those),
  because Sonarr 5 refuses a search for a whole series.
- Sonarr 5 only accepts tag names made of letters, numbers and dashes (no spaces), and says so
  when you try another.
- **Compare with…** only compares settings both instances have, so a Sonarr 4 and a Sonarr 5
  instance don't differ on options only Sonarr 5 has.

**Indexer health** (Prowlarr → Health) — searches, failure rate, grabs, grab failures and
response time per indexer for a chosen period, flags paused, failing, slow and never-grabbing
indexers with suggestions. Admins can Test or Disable an indexer.

**Backups** (Settings → Automation, admins) — Back up all runs each Sonarr/Radarr/Lidarr/Readarr/
Whisparr/Prowlarr's own Backup and lists the zips it keeps. **Open in …** takes you to that app's
System → Backup page to download one: the apps only hand backup files to their own web login, not
to the API key, so the zips never pass through Arr Command Center. If the server reaches an app at
an internal address (for example `http://sonarr:8989` in Docker), set the service's optional
**Browser URL** so the link opens the address you use in a browser.

**Activity log** (Settings, admins) — every change, delete, request, restart and refused
attempt: who, which role, which service, what, and the result. Filters and CSV. Only a short
description is stored, never request bodies or keys. Keeps the last 1,000.

**Weekly digest** (Settings, admins; off by default) — a list of what Sonarr and Radarr
imported in the last 7/14/30 days, sent on a chosen day and hour to your notification channels
and push (category "Weekly digest"). Discord and ntfy get a poster. Empty weeks are skipped;
Send now sends one straight away.

**Chat requests** (Settings, admins) — `/search`, `/request` and `/status` from Telegram or
Discord, going through Seerr. Nobody can use it until you allow their chat: an unknown chat is
told its id and appears under "Waiting to be allowed". Allowed chats get a role (guest can
search only; user and admin can request) and optionally a Seerr user to request as.
- Telegram: create a bot with @BotFather and paste its token. The server asks Telegram for new
  messages, so it doesn't need to be reachable from the internet. Only one program can read a
  bot's messages, so use a bot dedicated to this.
- Discord: Discord sends slash commands to this server, so it must be reachable over https
  (reverse proxy or Cloudflare Tunnel). Set the app's Interactions Endpoint URL to
  `https://<your host>/api/bot/discord/interactions`, enter the application ID and public key,
  and press Register slash commands (needs the bot token). Every call is checked against
  Discord's signature. If you use Cloudflare Access, exclude that one path from it.

**Fix paths** (Sonarr, Radarr, Lidarr → System tab, or from a "missing root folder" health
warning) — after moving drives or hosts, checks every item's folder through the app's own
filesystem view (so Docker and network paths are what *it* sees), searches the disks and root
folders it reports for the missing ones, and proposes a new path for each. It matches exact
names, the same words with different punctuation, and release-named folders that start with the
title and year, and settles ties by the drive neighbouring items moved to and by which folder has
video files. Weak matches and ties are left unticked. You can pick another folder, browse (works
with the keyboard), or map a whole moved folder ("old → new", with suggestions). Applying
re-points only the ticked items, **without moving files**, adds the new root folders, can remove
dead ones, and rescans just those items. The last five fixes can each be undone, and the plan can
be exported as CSV. Admins only.

**Add existing folders** (Sonarr, Radarr → System tab) — the folders in your root folders that
the app doesn't manage yet (its own unmapped-folder list), matched to a show or movie by name and
year with the app's own lookup, then added **at their own path**, as Sonarr's and Radarr's Library
Import do. Nothing is moved, renamed or searched for, and monitoring defaults to off (Sonarr: nothing,
episodes on disk, or all; Radarr: no or yes). Quality profile, series type, season folders and minimum
availability default to what the titles already in that root folder use. Each folder shows how sure the
match is (same name and year, same name, or "check"); among several titles with the name, one already
in the app or a far better-known one is taken, otherwise you choose from the list or search another
name. Only sure matches are ticked, one folder per title. Folders whose title is already in the app
are listed apart (they're other copies; see Find duplicates), and downloads of single episodes or
seasons, failed downloads, movie packs, empty folders and folders you hide aren't offered (with the
reason). After adding, it waits for the app to read the folders: Radarr can't name a file with no
year in the folder or file name ("Juno/Juno.mkv"), so those are linked with Radarr's Manual Import
where they are (quality from the name, or from the file type as Radarr does), and files the app still
can't read (episodes without numbers, a sequel in the same folder) are listed for Manual Import. Adding
asks twice; linking files needs delete rights, as other Manual Imports do. CSV export.

**Duplicate finder** (Sonarr, Radarr → System tab) — groups entries by shared TMDB/TVDB/IMDb id
("same title") or, when ids are missing, by title and year ("possible"; never preselected). Two
films with the same name and year but different ids aren't flagged. Each group suggests a copy to
keep and says why (folder on disk, files/episodes, quality, size, monitored); extras in sure
groups are preselected. Deleting never removes the files of a folder a kept copy also uses.
"Not a duplicate" hides a group until a new copy joins it. It also lists folders in a root folder
that the app doesn't manage but that are named like a title you have (with their video-file count,
and whether Plex shows them as duplicates), and the same title in another instance (marked "probably
on purpose" for 4K/anime/kids instances). Export to CSV.

In Sonarr the finder is grouped by show. Each show opens to where its copies are (entries in
Sonarr, folders Sonarr doesn't manage) and its seasons with duplicate episodes; each season opens
to every episode that's on disk more than once, with each file's quality, size and path, which
file Sonarr uses, the best copy, and whether Plex sees it. Files are found by listing each show's
folder once, plus Plex's duplicate episodes when Plex is connected; extras, samples and Plex's
optimized versions don't count, as in Sonarr's own scan. A file Sonarr doesn't track has its
quality read from its name (marked *). When a season has better copies Sonarr could use, **Use
the better copies…** imports them for that season through Sonarr's Manual Import (see below). Sonarr
can only delete files it tracks, so other copies are deleted on disk or in Plex. The CSV includes
every copy of every duplicate episode. Plex → Duplicates now lists TV episodes too, by show,
season and episode.

**Keep this copy instead** — when an unmanaged copy is better, Radarr (whole movie) or Sonarr
(chosen episodes) imports it through its own Manual Import, after checking each file the way its
own Manual Import does (its reasons, like "Not an upgrade", are shown, and only clean upgrades are
preselected). A file from another folder is moved into the item's folder and renamed, and Radarr
or Sonarr removes the old file, to its **Recycle Bin** if one is set (you're warned, and must
confirm, if not). A better copy already in the show's own folder is imported where it is; the
episode's old file is then deleted through Sonarr (same Recycle Bin rules) unless another episode
still uses it, and the new file is renamed if Rename Episodes is on. Arr Command Center never
needs write access to your drives.

**Problem notifications** — besides downloads and requests, the poller reports unhealthy Portainer
containers, unreachable Docker environments, degraded TrueNAS pools, Unraid disk problems or a
stopped array, Syncthing folder errors, ad blocking left off in Pi-hole/AdGuard, failed Unpackerr
extractions, a failed or below-benchmark speedtest, and Pulsarr requests awaiting approval (category "Problems", on by default). Each problem notifies once.

**Live updates** — Sonarr/Radarr/Lidarr/Readarr/Whisparr queues, SABnzbd, qBittorrent,
Transmission, Deluge, Flood, NZBGet, Tautulli and Jellyfin/Emby now-playing, and Seerr's request
list, update over Server-Sent Events (`/api/live/<service>`), and Home uses one combined stream
(`/api/live?services=…`) for its tiles and activity feed. The server polls once for every
viewer and only signals visible changes; with Instant updates set up, a webhook from the app
signals the change straight away. The iOS local-only mode keeps polling.

**Quality profiles and custom formats** — admins can edit a profile's name, upgrades,
allowed qualities, cutoff and format scores, and a custom format's name, rename flag and
each condition's value, negate and required (System tab). Reordering qualities and adding
or removing conditions still happen in Sonarr/Radarr.

**Roles in the UI** — users and guests don't see buttons they can't use (deletes for users;
any change for guests). The server still enforces every rule.

**Unified dashboard**
- **Overview** — live status of every service, versions, quick stats, and a filterable
  "what's happening now" activity feed.
- **Overview workspaces** — build multiple layouts, attach only the service instances each
  workspace needs, bind service-aware widgets to a specific instance, and drag to reorder,
  resize, or hide widgets (Services, Activity, Seerr, Upcoming, Streams, Status, and Inbox).
- **Organizr-style Quick Links** — add your own custom links to the Overview and manage
  them in Settings.

**Library management (Sonarr / Radarr / Lidarr / Bindery / legacy Readarr)**
- **Three view modes** — Hexagon, List, and a sortable **Table**, toggled per page and
  remembered.
- **Filter & saved views** — instant title search + status dropdown; save filter/sort/view
  combinations for one-click recall.
- **Deep-linkable URLs** — the active view mode, filter, status, and sort all live in the
  URL hash so any state is bookmarkable and shareable.
- **Add / edit / delete** titles, interactive + automatic search, and a season/episode
  browser with monitor toggles.
- **Wanted** tab — Missing + Cutoff Unmet, with per-item search.
- **System** tab — health checks, disk space, quality profiles, tags (view/create/delete),
  blocklist (view/remove), and commands.
- **Bulk operations** — multi-select across the library for bulk monitor, search, delete,
  and **bulk tag** add/remove.

**Requests, streaming & downloads**
- **Overseerr / Seerr** — pending & all requests with one-click **approve/decline**,
  issues, recently added, and a **discover** search to create new requests.
- **Plex** — watchlist, shared users, now-playing sessions, wrong matches, missing from Plex,
  library scans and sharing, with a server-side image proxy so posters render (Plex token never
  touches the browser).
- **Jellyfin & Emby** — shared library browser, recently added media, users, live sessions
  with direct-play/transcode state, wrong matches and transcodes; artwork streams through the
  authenticated proxy.
- **Tautulli** — active streams (direct-play/transcode, bandwidth), history, statistics,
  graphs, the titles that keep transcoding, and each person's year in review.
- **SABnzbd** — live queue with **pause/resume**, per-item remove, **speed-limit** control,
  and download history.
- **qBittorrent** — live torrent list with state, ratio, speeds, and controls, plus a seeding clean-up.
- **Transmission & Deluge** — shared live torrent UI with downloading/completed views,
  global and per-item pause/resume, safe removal, ratio/speed/ETA details, and speed limits.
- **Flood** — the shared torrent UI (downloading/completed, pause/resume all or per item,
  removal with optional data delete, global speed limits). ACC signs in with your Flood
  login and keeps the session cookie server-side.
- **NZBGet** — shared Usenet queue/history UI with pause/resume, group/history removal,
  disk/remaining statistics, and absolute speed limits.
- **Bazarr** — missing subtitles by language and show with batch search, and history.
- **Prowlarr** — indexer overview, indexer health, and search with results sent to an app.
- **Autobrr** — recent releases with push outcome (pushed/rejected/error) and reason,
  announce/push stats, enable/disable filters, and IRC network + channel health.
- **Maintainerr** — "Leaving soon" list of everything scheduled for deletion with days left
  and space freed, a **Keep** action (adds an exclusion), collection activate/deactivate,
  and "Run rules now".
- **Tdarr** — files, transcodes, space saved and error counts, per-node status, live worker
  progress (fps, ETA, size estimate), and the transcode queue/error tables (read-only).
- **Audiobookshelf** — who's listening now (admin key), continue-listening progress,
  recently added per library with covers, and library stats.
- **Newznab indexer** — search a public/private Usenet indexer directly, and send results to
  SABnzbd, Sonarr, Radarr, Lidarr or Readarr.

**Appearance & UX**
- **Light & dark themes** with selectable accent colors and a default library view.
- **Density toggle** — comfortable or compact rows, tables, and feeds.
- **Command palette** — press `/` to jump to any service, page, or action.
- **Scroll-position restore** across Back/Forward navigation.
- **Responsive UI** — desktop, tablet, and mobile; keyboard `r` to refresh.

**Platform**
- **PWA** — installable, with **Web Push** notifications (including iOS 16.4+ via Add to
  Home Screen) for completed downloads, failures, and requests needing approval.
- **Cloudflare Access** service-token injection on every upstream request (secrets stay
  server-side).
- **Optional auth** — built-in basic auth, or sign-in with your **Plex** account.

---

## Security notes

- `config.json` and `.env` are git-ignored — they hold your secrets. Keep them off version
  control.
- `data/` holds secrets too: two-factor keys, notification channel tokens and push keys
  (`store.json`), the API keys of services saved from Settings (`services.json`, readable only by
  its owner), and the encrypted copies made before a restore (`backups/`). It's git-ignored and
  left out of Docker images. Back it up, but keep it private.
- The dashboard proxies **anything** under `/api/proxy/<service>/…` to your services using
  the stored credentials. Anyone who can reach the dashboard can control your stack, so:
  - bind it to your LAN/VPN, and/or
  - enable the built-in **basic auth** (`auth.enabled`), and/or
  - put the dashboard itself behind Cloudflare Access / Tailscale.
- Secrets are never sent to the browser — the frontend only ever sees `/api/config`, which
  reports *whether* a service is configured, not the values. Responses that echo a key (an
  indexer's download links, for example) have it replaced with `[redacted]`; sending an indexer
  result to an app goes through the server, which puts the key back only for links on the
  indexer's own host.
- Webhook addresses (Instant updates) work without signing in, because the apps can't sign in;
  the secret in each address is what protects it. Treat them like passwords and use **New
  address** if one leaks. Wrong addresses get "not found", and repeated wrong guesses from one
  address are locked out for a while. The qBittorrent command and the SABnzbd Apprise address
  contain the same kind of secret. The qBittorrent command passes no torrent details, so a
  torrent's name can't add to the command.
- With Sign in with Plex, every sign-in is a session stored on the server. Signing out, Sign out
  everywhere else, removing a user or turning on two-factor ends sessions at once.
- With two-factor on, deleting files, changing roles and making or restoring a backup need a
  confirmation from the last 10 minutes, checked by the server (see **Confirm it's you**).
  Passkeys are checked by the server itself; no outside service is involved.
- Sign-in alerts give each browser a random cookie, and the server keeps only a hash of it.
- A backup of Arr Command Center holds every API key, encrypted with your passphrase
  (PBKDF2-SHA256 with 600,000 rounds, then AES-256-GCM). Use a passphrase you don't use anywhere
  else. Making and restoring backups are admin-only.
- Settings that follow you saves only look-and-layout settings from a fixed list, never service
  addresses or keys.
- Posters in the year in review come from Tautulli through the server, behind sign-in. The server
  signs each poster link it hands out, only for titles in a year it's showing you; any other
  link gets "not found". Only images are passed on, with a Content-Security-Policy that blocks
  scripts.
- Email channels check the mail server's certificate, and only send a password over an encrypted
  connection (or to a mail server on the same machine).
- The setup doctor and the compatibility check only read from your apps; they never change a
  setting.
- The setup wizard is admin-only, only contacts private network addresses and only opens the
  apps' public pages. The network-wide scan runs only when you tick it.

---

## Project layout

```
arr-command-center/
├── server/
│   ├── index.js              # Express app: static UI + proxy + status API
│   ├── config.js             # config.json + env loader (mock config in demo mode)
│   ├── proxy.js              # injects CF-Access headers + API keys per service type
│   ├── plex.js, plexAuth.js  # Plex sessions/watchlist/users + login + image proxy
│   ├── store.js              # JSON data store (custom links, login log, Plex token)
│   ├── poller.js, push.js    # background poller + Web Push notifications
│   ├── operations.js, automation.js
│   └── mock/mockServices.js  # bundled fake services for `npm run demo`
├── public/
│   ├── index.html, styles.css, app.js, sw.js, manifest.webmanifest
│   ├── lib/                  # api client, UI toolkit, theme, density, command palette,
│   │                         #   saved views, url/scroll state (no build step)
│   └── views/                # home, sonarr, radarr, musicbooks (lidarr/readarr),
│                             #   overseerr, sabnzbd, qbittorrent, tautulli, bazarr,
│                             #   prowlarr, indexer, plex, settings, …
├── docs/                     # README screenshots (see test/generate-screenshots.mjs)
├── config.example.json
├── .env.example
├── Dockerfile
└── docker-compose.yml
```

No build step, no frontend framework — just modern browser ES modules served statically.

## Scripts

| Command         | Description |
|-----------------|-------------|
| `npm start`     | Run with your real `config.json`. |
| `npm run demo`  | Run with bundled mock services (fake data). |
| `npm run dev`   | Run with `--watch` for auto-reload during development. |
| `npm test`      | Run the Node unit tests (`server/test` + `test`). |

## License

MIT

## Privacy Policy
The Arr Command Center iOS app does not collect any user data of any kind
