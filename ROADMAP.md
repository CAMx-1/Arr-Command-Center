# Arr Command Center — Pro Roadmap

This fork turns the dashboard into a **central management hub** for the whole
media stack: full‑featured control of the *arr apps via their APIs, Plex account
integration, and Organizr‑style custom links — backed by a small server‑side data
store (`data/store.json`).

## Done in this fork
- **Data store** (`server/store.js`) — JSON‑file persistence (custom links, login
  log, captured Plex token). No new dependencies.
- **Plex integration**
  - Plex token is now **captured at login** (server‑side only) instead of discarded.
  - `GET /api/plex/watchlist`, `/api/plex/users`, `/api/plex/sessions` (sessions need
    `plex.serverUrl` in config; Tautulli also shows streams).
  - **Image proxy** (`/api/plex/image`, token server‑side, SSRF host allowlist) so
    watchlist/session **posters render**.
  - New **Plex** panel with Watchlist (posters + "Find in Seerr") / Users / Now Playing.
- **Organizr‑style custom links** — `GET/POST/DELETE /api/links`, a **Quick Links**
  section on Home, and management in **Settings → Custom Links**.
- **Login log** — Plex sign‑ins recorded to the store, viewable in **Settings → Login log**.
- **Expanded *arr management** — **System** tab (health, disk, system status, commands,
  **blocklist** view+remove, **tags** view/create/delete, **quality profiles** view) and a
  **Wanted** tab (**Missing** + **Cutoff Unmet** toggle, per‑item search) for Sonarr/Radarr.
  **Bulk tag** add/remove across selected items (series/movie editor).
- Carried over from base: add/edit/delete series & movies, interactive + auto search,
  season/episode browser with monitor toggles, bulk actions, queue control, history,
  request options, SWR caching, diagnostics, structured logging, `/healthcheck`.

## Next — Organizr parity
- [ ] **User groups & access control** — per‑user roles (admin/user/guest) controlling
      which services/links/tabs are visible. Requires user records in the data store and
      role checks in the auth middleware + frontend gating.
- [ ] **Custom links in the sidebar** (not just Home), with categories/ordering, and an
      optional **iframe/embed** mode per link (base app already has service embed mode).
- [ ] **Top‑bar branding** — configurable site name/logo.
- [ ] **Manage the Plex allowlist from the UI** (add/remove allowed users) + a
      registration/approval flow.
- [ ] Per‑user "default page", pin/unpin sidebar, upload custom icons.

## Next — full *arr task coverage (via API)
- [ ] **Manual import** (interactive import of downloaded files).
- [ ] **Quality profiles / custom formats / release profiles** management (view + edit).
- [ ] **Indexer management** (Prowlarr live: add/edit/test/sync, app sync).
- [ ] **Download client settings**, remote path mappings.
- [ ] **Tags** management and per‑item tag editing.
- [ ] **Blocklist** view + remove/redownload.
- [ ] **Cutoff‑unmet** list; **manual season/movie search** result grabbing from the UI.
- [ ] **Import lists** management.
- [ ] Per‑episode/season monitor **bulk** toggles from the season browser.
- [ ] **SABnzbd**: category/scheduler/server config; **Tautulli**: notifications, libraries.

## Next — Plex
- [ ] **Manage users** (invite/remove shared users, library sharing) via plex.tv API.
- [ ] **Watchlist actions** (add/remove; request via Seerr in one click).
- [ ] **Server management** — multiple PMS servers, libraries, scan/refresh, recently added.
- [ ] Image proxy so watchlist/session **posters** render (token stays server‑side).

## Platform
- [ ] Consider **SQLite** (`node:sqlite`) if the JSON store outgrows itself (users,
      logs, per‑user prefs).
- [ ] Real‑time updates (SSE/WebSocket) for queues/sessions.
- [ ] Automated tests + CI.

## Security notes
- The Plex token is stored in `data/store.json` (git‑ignored). Treat that file as a secret.
- `config.json` writes (Add/Edit service) and the Plex token capture are behind Plex auth;
  gate the app behind auth (and ideally Cloudflare Access) before exposing it.
