# Xen PWA — making `xen.xlrd.org` (the xen phone) always-up

## What xen.xlrd.org is

**`xen.xlrd.org` IS the xen phone.** It's the hostname qi navigates to on their device every day — the swipe shell, the omninbox mirror, the status panes. Not a backend tunnel. Not a developer URL. The brand identity of the phone.

That hostname is non-negotiable. It does not get retired, replaced, or repointed. The job of this migration is to make **`xen.xlrd.org` itself** stay alive when the Mac dies, not to introduce a sibling hostname that competes with it.

Today `xen.xlrd.org` is served by: Cloudflare DNS → cloudflared tunnel (running on the Mac) → `omnimind.js` (running on the Mac) → `pwa/` directory (on the Mac). When the Mac dies, every link in that chain dies. That is the problem being solved.

## Always-up plan

A Cloudflare Worker bound to the `xen.xlrd.org/*` route becomes the new front door:

1. **Mac alive (normal case):** Worker proxies straight to the cloudflared tunnel. Identical to today's behavior — qi notices nothing.
2. **Mac dead:** Worker falls back to a static origin (GH Pages mirror at `xlrdtech.github.io/xen-pwa/`) for static assets, and to KV-cached responses for dynamic API endpoints.
3. **SSE feeds** (`/events`, etc.) stay open at the Worker boundary even when the upstream Mac drops, emitting `mac-offline` / `mac-online` events to the client instead of closing.

The Worker code is what already lives in `functions/` in this repo — the SSE relay, omninbox proxy with KV cache, mirror reply queue. It was scaffolded for Cloudflare Pages Functions, and the same logic redeploys as a Workers route with no rewrite.

## What is already done

- [x] **Full source clone** of `/Volumes/tech_/qi_data/Exedus/xen/pwa/` mirrored to `xlrdtech/xen-pwa` (1.3 MB, no build step, all inline-HTML PWA per canon C9).
- [x] **GH Pages enabled** on `main`, HTTPS enforced. Serves `xlrdtech.github.io/xen-pwa/` as the always-up static origin that the Worker will fall back to. Verified HTTP 200 on `/`, `/swipe/`, `/mirror/`, `/3/`, `/xen-status.html`.
- [x] **Function tier scaffolded** in `functions/`:
  - `events.js` — SSE relay that keeps the client stream open forever; upstream Mac reconnects with exponential backoff; mac-online/mac-offline events instead of EventSource onerror
  - `mirror/reply.js` — POST proxy with KV queue fallback when Mac is offline
  - `api/omni/[[catchall]].js` — proxy with KV cache on GET (last-known threads visible during Mac death), POST queue on writes; cache key sorts query params
- [x] **noauth-mandatory** — PIN gate stripped from `index.html`, gate-entry function deleted. Pages land directly in the shell. Per qi 2026-05-16 + C4.
- [x] **xen.xlrd.org untouched** — DNS, cloudflared ingress, omnimind, source `pwa/` dir all unchanged. The Mac-tunnel path still works exactly as before.

## What is still pending

- [ ] **CF Worker bound to `xen.xlrd.org/*`** — this is the actual always-up plumbing. Requires CF API/wrangler auth (currently broken — refresh token expired). Once auth is restored, deploy via `wrangler deploy` with a route binding for `xen.xlrd.org/*` that runs the existing functions/* logic with Mac→GH-Pages failover.
- [ ] **KV namespaces** — `OMNI_CACHE`, `PENDING_REPLIES`, `PENDING_OMNI`. Created via wrangler, bound to the Worker.
- [ ] **Mac-side drain** — small script on the Mac that, when omnimind comes back online, pulls queued replies/writes from KV and replays them to the local endpoints.
- [ ] **Health check** — the Worker needs a fast way to know if the Mac is alive. Either short-timeout fetch to a `/healthz` endpoint, or CF Health Check API.

## URLs

- Canonical (the xen phone): <https://xen.xlrd.org/> — stays. The Worker will make it always-up.
- Mirror source: <https://github.com/xlrdtech/xen-pwa>
- Static-only failover origin: <https://xlrdtech.github.io/xen-pwa/> — what the Worker falls back to when the Mac is dead. Not meant to be qi-facing.

## What this migration does NOT do

- It does not change `xen.xlrd.org` DNS, tunnel config, omnimind code, or the source `pwa/` directory. Those are untouched.
- It does not replace the Mac. The Mac is and remains the source of truth for live data. The cloud layer caches and queues; it never originates state.
- It does not introduce a "new hostname" for users. `xlrdtech.github.io/xen-pwa/` exists only as the static failover origin the Worker reads from.
