# 🎬 Arr Command Center

A single, locally-hosted web dashboard to view and manage your whole media stack —
**Sonarr**, **Radarr**, **Overseerr/Seerr**, and **SABnzbd** — from one place.

Built as a self-hosted replacement for the now-discontinued **LunaSea** iOS app. Because
it's a responsive web app, it works from your phone's browser (and you can "Add to Home
Screen" for an app-like experience), your laptop, or anywhere on your network.

The key feature: a small **backend proxy** that injects your **Cloudflare Access service
token** headers (`CF-Access-Client-Id` / `CF-Access-Client-Secret`) and each service's API
key on every request. That means your services can stay locked down behind Cloudflare
Access, and secrets never touch the browser.

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

Then open <http://localhost:7373>. This spins up **bundled mock services** with fake
Sonarr/Radarr/Overseerr/SABnzbd data so you can click around immediately. The mock services
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
      "type": "sonarr",         // one of: sonarr | radarr | overseerr | sabnzbd
      "enabled": true,
      "baseUrl": "https://sonarr.example.com",
      "apiKey": "YOUR_SONARR_API_KEY",
      "cloudflareAccess": {
        "clientId": "xxxxxxxx.access",
        "clientSecret": "yyyyyyyy"
      }
    }
    // ... radarr, overseerr, sabnzbd
  }
}
```

Where to find each **API key**:

| Service    | Location |
|------------|----------|
| Sonarr     | Settings → General → API Key |
| Radarr     | Settings → General → API Key |
| Overseerr  | Settings → General → API Key |
| SABnzbd    | Config → General → API Key |

### Environment variable overrides

Any secret can be supplied via environment variables instead of `config.json` (handy for
Docker/secrets). See `.env.example`. Pattern:

```
SONARR_BASE_URL, SONARR_API_KEY, SONARR_CF_CLIENT_ID, SONARR_CF_CLIENT_SECRET
RADARR_...   OVERSEERR_...   SABNZBD_...
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
   For each Access application protecting Sonarr/Radarr/Overseerr/SABnzbd:
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

**Plain docker:**

```bash
docker build -t arr-command-center .
docker run -d --name arr-command-center \
  -p 7373:7373 \
  -v "$PWD/config.json:/app/config.json:ro" \
  arr-command-center
```

If your arr services are also in Docker, put this container on the **same Docker network**
and you can use internal hostnames as `baseUrl` (e.g. `http://sonarr:8989`). Note that
internal traffic typically bypasses Cloudflare Access — in that case just omit the
`cloudflareAccess` block for those services.

---

## Features

- **Overview** — live status of every service, versions, quick stats, and a combined
  "what's downloading now" activity feed.
- **Sonarr** — series library with progress, 4-week calendar, download queue (remove
  items), and add-series search with root-folder/quality-profile picker.
- **Radarr** — movie library, download queue, add-movie search flow.
- **Overseerr/Seerr** — pending & all requests with one-click **approve/decline**, plus a
  **discover** search to create new requests.
- **SABnzbd** — live queue with **pause/resume**, per-item remove, **speed-limit** control,
  and download **history**.
- **Connection health** — sidebar dots + polling every 15s.
- **Responsive dark UI** — works on desktop and mobile; keyboard `r` to refresh.
- **Optional basic auth** over the whole dashboard.

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
│   └── mock/mockServices.js  # bundled fake services for `npm run demo`
├── public/
│   ├── index.html, styles.css, app.js
│   ├── lib/{api.js, ui.js}   # proxy client + tiny UI toolkit (no build step)
│   └── views/{home,sonarr,radarr,overseerr,sabnzbd}.js
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

## License

MIT
