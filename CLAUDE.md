# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this directory is

`pwa/` is the **static front-end** for Xen — a collection of single-file inline-HTML dashboards and mini-apps served by the `omnimind` Node server living in the sibling directory (`../omnimind.js`, port 4441). Public front door is `xen.xlrd.org` via cloudflared → `127.0.0.1:4441`.

**There is no build step, no bundler, no package.json, no test suite, no lint.** Every page is a self-contained HTML file with inline CSS and JS (canon C9: "Inline-HTML real-time view is canonical — every dashboard/mirror/status surface ships as one self-contained inline HTML file, SSE-driven updates, no React build, no SPA framework, no bundler"). Edit the HTML → reload. That is the development loop.

## How files get served

Routing logic lives in [`../omnimind.js`](../omnimind.js) around line 3181 (`PWA_DIR = path.join(__dirname, 'pwa')`):

- `/` → `index.html`
- `/3/` → `3/index.html`
- `/mirror/` → `mirror/index.html`
- **Host aliasing:** `3.xlrd.org` → `/3/index.html`, `mmm.xlrd.org` → `/mirror/index.html`
- Asset fallback resolves to `dist/` if the top-level file is missing
- Unmatched paths fall back to `index.html` (SPA-style)

**Cache headers (set by omnimind, not the SW):**
- `sw.js` and `*.webmanifest` → `no-store` (must update instantly through Cloudflare)
- `*.html` → `no-cache`
- icons/fonts → `public, max-age=86400`

If a page won't refresh on phone/desktop after an edit, the service worker is the usual culprit — visit `/kill-sw.js` or bump `CACHE = "xen-mobile-vN"` in `sw.js`.

## Backend API the pages talk to

All endpoints are served by `omnimind` (:4441). Key ones used from these pages:

| Endpoint | Used by | Purpose |
|---|---|---|
| `GET /events` (SSE) | `mirror/index.html` | Live omni-inbox event stream |
| `POST /mirror/reply` | `mirror/index.html` | Route a reply back through Beeper/Spark/Beside/SMS |
| `GET /api/browser/events` (SSE) | `index.html` | Tab/session sync from the Mac's XenBrowser |
| `POST /api/browser/cmd` | `index.html` | Remote-control the Mac browser (`navigate`, `tab_new`, `tab_focus`, `eval`, `type`) |
| `GET /api/browser/screenshot` | `index.html` | Polled screenshot of the Mac browser tab (mobile mode) |
| `GET /api/omni/threads`, `/messages`, `POST /api/omni/send` | `xp-app.js` (three-panel app) | Omninbox CRUD |
| `POST /api/gate-entry` | `index.html` PIN gate | Logs (name, phone) on entry |

When developing locally (hostname `localhost`/`127.0.0.1`), `index.html` points `API` at `http://127.0.0.1:4441` directly; otherwise it uses `https://api.xlrd.org`. See [index.html:104-108](index.html#L104-L108).

## The pages

- **`index.html`** — mobile remote-browser shell. Connects via SSE to drive a Mac-side browser. Two modes: mobile (polled screenshot + keyboard-bar injection via `cmd({action:'type'})`) and desktop (live iframe). Has a name+phone gate (`/api/gate-entry`).
- **`mirror/index.html`** — live omni-inbox feed (Spark + Beeper + Beside + SMS). SSE-driven cards with per-event reply affordance posting to `/mirror/reply`. Source pills are color-coded per channel.
- **`xen-status.html`** — locked status dashboard (Beeper threads, daemons, recent actions).
- **`3/index.html`** — newer four-pane omninbox shell using design tokens from `design-tokens/xen-tokens.css`. Hosted on `3.xlrd.org`.
- **`v2/index.html`, `swipe/index.html`, `tasks/index.html`** — alternate dashboards.
- **`selfexec.html`, `landing.html`, `luckie-stories.html`, `xenbrowser.html`, `xen-docs.html`, `xen-health.html`, `xen-callers.html`, `xen-unified-log.html`, `xp.html.archive`** — landing/marketing/auxiliary surfaces. Files prefixed `xen-*` are paired copies of the unprefixed versions (`callers.html`, `docs.html`, etc.) — keep them in sync if you touch one.

## Shared JS modules

- **`bridge-client.js`** — GV Phone Bridge client. Same-origin first; falls back to `https://ggv.xlrd.org`. Overridable via `?bridgeBase=...` query, `localStorage.gvPhone.bridgeBase`, or `window.GV_PHONE_CONFIG.bridgeBase`. `dist/bridge-client.js` is a duplicate served from the asset fallback.
- **`phone-state.js`, `omni-inbox.js`** — telephony state + inbox helpers used by older pages.
- **`xp-app.js` + `xp-app.css`** — three-panel omninbox app. Uses a DOM-builder helper (`el(tag, attrs, children)`) instead of `innerHTML` for safety.
- **`twilio.min.js`** — vendored Twilio Voice SDK for in-browser calling.
- **`sw.js`** — service worker (cache `xen-mobile-v4`, same-origin only, network-then-cache with `/index.html` fallback). `kill-sw.js` is the deregistration script.

## Conventions to preserve

- **Single inline HTML file per page.** Do not introduce React, Vue, a bundler, or split CSS/JS out into separate files unless you also update [`../omnimind.js`](../omnimind.js) static routing and the canon. SSE > polling, no full-page refreshes.
- **`overflow-wrap: break-word; word-break: normal; hyphens: none;`** — per the parent `CLAUDE.md` design principles. Never let letters wrap mid-word.
- **No em dashes anywhere in user-facing copy** — hyphens, periods, or commas only (canon).
- **DOM-builder over `innerHTML`** in new JS — follow the `el(tag, attrs, children)` pattern in `xp-app.js`. The XSS surface here is real because omninbox content includes arbitrary message bodies.
- **Bump the SW cache name** (`sw.js` `CACHE = "xen-mobile-vN"`) when you change cached assets, otherwise installed PWAs stay on the old version.

## Visual verification (canon C17)

User-facing surfaces in this directory (mirror, index, status, tasks, 3) require **visual evidence** before claiming verified-end-to-end — `screencapture -x` or an XB DOM extract of the rendered page. HTTP 200 from the omnimind static route only proves the file was served, not that the page renders or that SSE is flowing.

## Restarting the server

Edits to files in `pwa/` are picked up on the next request (omnimind serves them off disk with `no-cache`). If you edit `../omnimind.js` itself, restart its launchd job — see [`../RUNBOOK.md`](../RUNBOOK.md).
