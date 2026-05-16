# xen-pwa

Always-up mirror of the Xen PWA — inline-HTML dashboards, swipe shell, omninbox mirror, status pages.

**Live:** https://pwa.xlrd.org/ (GH Pages, always up) — failover for `xen.xlrd.org` (Mac-tunnel, dies with the Mac).

## Surfaces

| Path | Purpose | Backend? |
|---|---|---|
| `/` | Mobile remote-browser shell | Needs Mac (`/api/browser/*`) |
| `/swipe/` | 3-pane phone shell — qi's daily driver | Static, iframes 3 URLs |
| `/mirror/` | Live omninbox feed (Spark + Beeper + Beside + SMS) | Needs SSE on `/events` |
| `/3/` | 4-pane omninbox shell | Needs Mac (`/api/omni/*`) |
| `/xen-status.html`, `/tasks/`, `/v2/` | Status dashboards | Needs Mac |
| `/landing.html`, `/selfexec.html`, `/luckie-stories.html`, `/xenbrowser.html` | Marketing / docs | Pure static |
| `/health.html`, `/docs.html`, `/callers.html`, `/unified-log.html` (+ `xen-*` paired copies) | Status views | Polled fetches |

## Architecture

- **Static UI** → this repo → GH Pages → `pwa.xlrd.org`
- **Functions** (planned) → Cloudflare Pages Functions on same repo, replaces omnimind endpoints when the Mac is down — `/events` SSE relay, `/mirror/reply`, `/api/omni/*`, `/api/gate-entry`
- **Mac-of-record** → `omnimind.js` on `xen.xlrd.org` via cloudflared. When up: functions proxy through. When down: functions serve last-cached KV state so pages stay alive.

## Editing

- Single inline HTML file per page (canon C9 — no React, no bundler, no build step).
- Bump `CACHE = "xen-mobile-vN"` in `sw.js` when JS/HTML changes, otherwise installed PWAs stay on the old version.
- Source-of-truth lives at `/Volumes/tech_/qi_data/Exedus/xen/pwa/` on qi's Mac. This repo is the publish mirror.
