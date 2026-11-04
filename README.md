# 🎬 Arr Command Center

A single, locally-hosted web dashboard to view and manage your whole media stack —
**Sonarr**, **Radarr**, **Lidarr**, **Bindery** (with legacy **Readarr** fallback), **Overseerr/Seerr**, **SABnzbd**,
**qBittorrent**, **Transmission**, **Deluge**, **NZBGet**, **Flood**, **Tautulli**, **Bazarr**, **Prowlarr**, **Plex**, **Jellyfin**, **Emby**,
**Audiobookshelf**, **Autobrr**, **Maintainerr**, **Tdarr**, **Portainer** (read-only), **Glances**, **Pi-hole**,
**AdGuard Home**, **Syncthing**, **Navidrome**, **Pulsarr**, **Whisparr**, **TrueNAS**, **Unraid**, and any Newznab **indexer** — from one place.

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

*Live status hexes for every service with at-a-glance stats, a filterable activity
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

![Settings page](docs/settings.png)

*Themes (light/dark) with accent colors, a comfortable/compact density toggle, a default
library view, drag-to-reorder services, and a full Overview dashboard builder — all
secrets stay server-side.*

### Service uptime

![Service cards with 24-hour uptime bars](docs/uptime.png)

*Each service card shows a 24-hour uptime bar and percentage. If a service stays down for
two minutes you get a "down" alert, and a "recovered" alert when it comes back.*

### Notification channels

![Push notification categories and ntfy/Discord channels](docs/notifications.png)

*Choose what to be alerted about, then fan alerts out to ntfy, Gotify, Discord, Telegram
or any webhook. ntfy alerts for new requests include Approve/Decline buttons, so you can
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
Autobrr, Maintainerr, Tdarr, and a Newznab indexer) with fake data so you can click around immediately. The mock services
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

`docker-compose.yml` bind-mounts your `config.json` read-only. Prefer env vars? Drop the
volume and use `env_file: .env` instead (see the commented lines).

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

Always mount `data/`: it holds everything the app saves (custom links, push
subscriptions, automation state, login log, Plex token) and the Plex sign-in
secret. Without it, that data is lost and everyone is signed out on each rebuild.
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

**Duplicate finder** (Sonarr, Radarr → System tab) — groups entries by shared TMDB/TVDB/IMDb id
("same title") or, when ids are missing, by title and year ("possible"; never preselected). Two
films with the same name and year but different ids aren't flagged. Each group suggests a copy to
keep and says why (folder on disk, files/episodes, quality, size, monitored); extras in sure
groups are preselected. Deleting never removes the files of a folder a kept copy also uses.
"Not a duplicate" hides a group until a new copy joins it. It also lists folders in a root folder
that the app doesn't manage but that are named like a title you have (with their video-file count,
and whether Plex shows them as duplicates), and the same title in another instance (marked "probably
on purpose" for 4K/anime/kids instances). Export to CSV.

**Keep this copy instead** — when an unmanaged copy is better, Radarr (whole movie) or Sonarr
(chosen episodes) imports it through its own Manual Import: the file is moved into the item's
folder and renamed, and the app removes the old file itself, to its **Recycle Bin** if one is set
(you're warned, and must confirm, if not). Arr Command Center never needs write access to your
drives.

**Problem notifications** — besides downloads and requests, the poller reports unhealthy Portainer
containers, unreachable Docker environments, degraded TrueNAS pools, Unraid disk problems or a
stopped array, Syncthing folder errors, ad blocking left off in Pi-hole/AdGuard, and Pulsarr
requests awaiting approval (category "Problems", on by default). Each problem notifies once.

**Live updates** — Sonarr/Radarr/Lidarr/Readarr/Whisparr queues, SABnzbd, qBittorrent,
Transmission, Deluge, Flood, NZBGet, Tautulli and Jellyfin/Emby now-playing update over
Server-Sent Events (`/api/live/<service>`), and Home uses one combined stream
(`/api/live?services=…`) for its tiles and activity feed. The server polls once for every
viewer and only signals visible changes. The iOS local-only mode keeps polling.

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
- **Plex** — watchlist, shared users, and now-playing sessions, with a server-side image
  proxy so posters render (Plex token never touches the browser).
- **Jellyfin & Emby** — shared library browser, recently added media, users, and live
  sessions with direct-play/transcode state; artwork streams through the authenticated proxy.
- **Tautulli** — active streams (direct-play/transcode, bandwidth), history, statistics,
  and graphs.
- **SABnzbd** — live queue with **pause/resume**, per-item remove, **speed-limit** control,
  and download history.
- **qBittorrent** — live torrent list with state, ratio, speeds, and controls.
- **Transmission & Deluge** — shared live torrent UI with downloading/completed views,
  global and per-item pause/resume, safe removal, ratio/speed/ETA details, and speed limits.
- **Flood** — the shared torrent UI (downloading/completed, pause/resume all or per item,
  removal with optional data delete, global speed limits). ACC signs in with your Flood
  login and keeps the session cookie server-side.
- **NZBGet** — shared Usenet queue/history UI with pause/resume, group/history removal,
  disk/remaining statistics, and absolute speed limits.
- **Bazarr** — subtitle wanted/history management.
- **Prowlarr** — indexer overview.
- **Autobrr** — recent releases with push outcome (pushed/rejected/error) and reason,
  announce/push stats, enable/disable filters, and IRC network + channel health.
- **Maintainerr** — "Leaving soon" list of everything scheduled for deletion with days left
  and space freed, a **Keep** action (adds an exclusion), collection activate/deactivate,
  and "Run rules now".
- **Tdarr** — files, transcodes, space saved and error counts, per-node status, live worker
  progress (fps, ETA, size estimate), and the transcode queue/error tables (read-only).
- **Audiobookshelf** — who's listening now (admin key), continue-listening progress,
  recently added per library with covers, and library stats.
- **Newznab indexer** — search a public/private Usenet indexer directly.

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
- The dashboard proxies **anything** under `/api/proxy/<service>/…` to your services using
  the stored credentials. Anyone who can reach the dashboard can control your stack, so:
  - bind it to your LAN/VPN, and/or
  - enable the built-in **basic auth** (`auth.enabled`), and/or
  - put the dashboard itself behind Cloudflare Access / Tailscale.
- Secrets are never sent to the browser — the frontend only ever sees `/api/config`, which
  reports *whether* a service is configured, not the values.

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
