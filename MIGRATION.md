# Xen PWA migration — adding a GH Pages + Cloudflare Pages failover layer

## Goal

The Xen PWA used to disappear whenever `omnimind.js` on qi's Mac died (Claude Code CLI crash, machine sleep, power blip, etc.). Cloudflared showed the origin as down and the dashboards/mirror/swipe shell went black.

`xen.xlrd.org` (cloudflared tunnel → omnimind → `/Volumes/tech_/qi_data/Exedus/xen/pwa/`) **stays canonical and is never changed** — it remains the live system whenever the Mac is up. This migration adds a parallel always-up layer beside it, never in place of it.

New architecture:

- **Static UI** → mirrored to `xlrdtech/xen-pwa` repo → published two ways:
  - GH Pages at `https://xlrdtech.github.io/xen-pwa/` (always-up failover, never replaces xen.xlrd.org)
  - Cloudflare Pages at `pwa.xlrd.org` (failover that adds a function tier — separate hostname, doesn't touch xen.xlrd.org)
- **Function tier** → `functions/` dir in this repo, runs as Cloudflare Pages Functions on the CF edge. Calls back to `xen.xlrd.org` as upstream when the Mac is alive, falls back to KV cache when it isn't.
- **Mac stays the source of truth** for live data. The cloud functions cache the last-known state in KV so dashboards keep rendering when the Mac is down, but write traffic still drains to the Mac as soon as it's back.

## Current status (2026-05-16)

- [x] Repo populated with full `pwa/` clone (1.3 MB, no build step, all inline-HTML).
- [x] GH Pages enabled on `main`, HTTPS enforced, building cleanly. Verified HTTP 200 on `/`, `/swipe/`, `/mirror/`, `/3/`.
- [x] Swipe shell defaults repointed at `xlrdtech.github.io/xen-pwa` URLs — qi's daily-driver shell now survives Mac death.
- [x] CF Pages Functions scaffolded: `/events` SSE relay (auto-reconnect upstream, stream stays open on client), `/mirror/reply`, `/api/omni/*`. All have KV fallback for Mac-offline state.
- [x] **noauth-mandatory** — PIN gate stripped from `index.html`. `/api/gate-entry` function deleted. Zero gates / login / credential prompts on any user-facing page. Per qi 2026-05-16 + C4.
- [ ] **CF Pages project not yet connected to repo** — qi to do in CF dashboard (one-time): Workers & Pages → Create → Pages → Connect to Git → xlrdtech/xen-pwa → main → Save. Optional KV bindings: `OMNI_CACHE`, `PENDING_REPLIES`, `PENDING_OMNI`, `GATE_LOG`.
- [ ] **CF DNS for `pwa.xlrd.org` not yet repointed** — needs CNAME → xlrdtech.github.io (proxy OFF for GH-Pages-only) OR set automatically by CF Pages once connected.
- [ ] Mac-side drain script for the KV queues (so queued replies actually get delivered when the Mac comes back).

## SSE "stays TF on" design

The old `/events` endpoint was a direct passthrough from the client to omnimind. When omnimind died, the SSE connection died, EventSource fired `onerror`, the dot turned grey, and the dashboard stopped rendering live events until manual page reload.

The new `functions/events.js`:

1. Opens a `ReadableStream` to the **client** immediately. This stream stays open until the **client** disconnects — not when the upstream Mac dies.
2. Independently opens a connection to `xen.xlrd.org/events` upstream. When the Mac sends data, pipe it through. When the Mac drops, the function emits a `mac-offline` SSE event and retries upstream with exponential backoff (1s, 2s, 4s, 8s, cap 30s).
3. Sends a `: heartbeat` comment every 15s so proxies don't kill the connection.

Net effect: the client's EventSource never sees `onerror` triggered by Mac death. It sees a stream of events from the Mac while the Mac is up, and `mac-offline` / `mac-online` events when transitions happen — but the connection itself stays alive forever.

## What the migration does NOT solve

- **Live screenshots of XenBrowser** (`index.html` mobile-mode) — that fundamentally needs the Mac. The cloud function returns 503 when Mac is down; the page should degrade to "Mac offline" placeholder (TODO: catch the 503 in `index.html` and show a friendlier state).
- **Outbound from cloud → physical Beeper/SMS** — the Mac is still the ADB/SMS bridge. Queued replies wait in KV until the Mac drains them.

## URLs

- Source: <https://github.com/xlrdtech/xen-pwa>
- Failover (always up): <https://xlrdtech.github.io/xen-pwa/>
- Primary (once CF Pages + DNS wired): <https://pwa.xlrd.org/>
- Canonical Mac-tunnel: <https://xen.xlrd.org/> — **stays canonical, never retired, never repointed.** GH Pages + CF Pages are pure failover/cache; they call back to `xen.xlrd.org` as the source of truth for live data. The Mac is and remains the system of record. Per qi 2026-05-16: *"xen.xlrd.org was never to be changed"*.
