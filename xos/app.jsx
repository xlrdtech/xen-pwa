/* global React, ReactDOM, IOSDevice */
const { useState, useEffect, useRef, useMemo } = React;

/* ===========================================================
   LIVE WIRING — xen.xlrd.org Cloudflare tunnel
   canon-no-demos: zero seed data, fail to "connecting..." not mocks
   =========================================================== */
const XEN_BASE = "https://xen.xlrd.org";
const SSE_URL  = XEN_BASE + "/events";
const CALLERS_URL = XEN_BASE + "/api/callers";
const REPLY_URL = XEN_BASE + "/mirror/reply";

function normalizeLiveEvent(raw, idx) {
  // omnimind /events emits {source, direction, body, sender, recipient, chatID, ts}
  const ts = raw.ts ? new Date(raw.ts * 1000) : new Date();
  const secAgo = Math.max(0, Math.floor((Date.now() - ts.getTime()) / 1000));
  return {
    src: (raw.source || raw.src || "xen"),
    dir: (raw.direction || raw.dir || "in"),
    sender: raw.sender || raw.from || raw.who || "",
    recipient: raw.recipient || raw.to || "",
    body: raw.body || raw.text || raw.message || "",
    chatID: raw.chatID || raw.thread || "",
    ts: -secAgo,
    _absTs: ts.getTime(),
    id: "live-" + (raw.chatID || "") + "-" + ts.getTime() + "-" + idx
  };
}

/* ===========================================================
   TWEAKS
   =========================================================== */
const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "accent": "#00dc82",
  "startPane": 1,
  "iosTime": "9:41",
  "voice": true,
  "showDock": true,
  "connection": "connected",
  "deviceName": "GV Phone"
}/*EDITMODE-END*/;

const ACCENTS = ["#00dc82", "#7afff5", "#ffb46a", "#ff3344", "#c8d0c0"];

/* ===========================================================
   DATA — content for each panel
   =========================================================== */

/* Omnibox suggestion library, filtered as the user types */
const OMNI_ALL = [
  { kind: "verb",   ic: "↗", title: "open ", arg: "url",        meta: "navigate · new thread" },
  { kind: "verb",   ic: "✦", title: "ask ",  arg: "anything",   meta: "ai · local model · ⌘a" },
  { kind: "verb",   ic: "✎", title: "note ", arg: "anything",   meta: "notes · capture · ⌘n" },
  { kind: "verb",   ic: "▶", title: "play ", arg: "track",      meta: "music · queue · ⌘p" },
  { kind: "verb",   ic: "⏲", title: "timer ", arg: "10m",       meta: "system · ⌘t" },
  { kind: "verb",   ic: "📞", title: "call ", arg: "name|number", meta: "phone · ⌘k" },
  { kind: "thread", ic: "WK", color: "muted", title: "Mars — Wikipedia",     meta: "thread · resumed 4h" },
  { kind: "thread", ic: "HN", color: "amber", title: "Hacker News · front",  meta: "thread · 3 unread" },
  { kind: "thread", ic: "GH", color: "muted", title: "pr #842 — omnibox regression", meta: "thread · review pending" },
  { kind: "contact",ic: "MC", color: "muted", title: "Marlowe Chen",         meta: "contact · +358 41 224 7710" },
  { kind: "contact",ic: "PL", color: "muted", title: "Pia Lindqvist",        meta: "contact · +358 50 444 9921" },
  { kind: "site",   ic: "ny", color: "muted", title: "nytimes.com",          meta: "site · open in new thread" },
  { kind: "site",   ic: "gh", color: "muted", title: "github.com/xlrd/xen",  meta: "site · open in new thread" }
];

const TRANSCRIPT = [
  { t: "11:14", k: "in",  text: "open hacker news" },
  { t: "11:14", k: "out", text: "→ thread launched · news.ycombinator.com" },
  { t: "11:21", k: "in",  text: "call marlowe" },
  { t: "11:21", k: "out", text: "→ dialing +358 41 224 7710 …" },
  { t: "11:26", k: "in",  text: "timer 20m  // standup" },
  { t: "11:26", k: "ok",  text: "✓ 20m · 19:42 remaining" },
  { t: "11:34", k: "in",  text: "note: try sodium finish on the v2 render" },
  { t: "11:34", k: "ok",  text: "✓ saved to inbox · 1 of 12" },
];

const SHORTCUTS = [
  { name: "Threads",  sub: "07",   icon: "≣", cls: "" },
  { name: "Music",    sub: "▶",    icon: "♪", cls: "" },
  { name: "Wallet",   sub: "3 cards", icon: "▭", cls: "muted" },
  { name: "Maps",     sub: "Kallio", icon: "◆", cls: "muted" },
  { name: "Camera",   sub: "raw",  icon: "○", cls: "muted" },
  { name: "Calendar", sub: "16",   icon: "■", cls: "muted" },
  { name: "Notes",    sub: "12",   icon: "❐", cls: "muted" },
  { name: "Settings", sub: "v0.27",icon: "✱", cls: "muted" }
];

/* Threads — open WebKit-browser threads */
const ACTIVE_THREAD = {
  fav: "WK", favBg: "#1f6feb", favFg: "#fff",
  scheme: "https://", host: "en.wikipedia.org", path: "/wiki/Mars",
  domain: "en.wikipedia.org",
  title: "Mars — the fourth planet from the Sun",
  snippet: "Mars has two small irregularly shaped moons, Phobos and Deimos, thought to have been captured asteroids…",
  status: "reading · ¾",
  time: "now"
};

const OPEN_THREADS = [
  { fav: "HN", favBg: "#FF6600", favFg: "#fff",
    domain: "news.ycombinator.com", title: "Show HN: a phone that does five things",
    sub: "412 points · 287 comments", stat: { color: "", text: "3 new" }, time: "12m" },
  { fav: "GH", favBg: "#0d1117", favFg: "#fff",
    domain: "github.com", title: "pr #842 · omnibox scroll regression",
    sub: "@marlowe · review pending", stat: { color: "amber", text: "review" }, time: "34m" },
  { fav: "▶",  favBg: "#1A1A1A", favFg: "#fff",
    domain: "ny.times", title: "Why the smartphone era is ending",
    sub: "narration · 8m of 14m", stat: { color: "", text: "playing" }, time: "1h" },
  { fav: "◆",  favBg: "#00dc82", favFg: "#03190d",
    domain: "maps.xen", title: "Walking to Kallio · 18 min",
    sub: "via Hämeentie", stat: { color: "amber", text: "live nav" }, time: "1h" },
  { fav: "✎",  favBg: "#7afff5", favFg: "#022a26",
    domain: "mail.xen", title: "Re: Q4 firmware checklist",
    sub: "draft · unsent", stat: { color: "amber", text: "draft" }, time: "3h" },
  { fav: "WK", favBg: "#1f6feb", favFg: "#fff",
    domain: "en.wikipedia.org", title: "Phobos (moon)",
    sub: "linked from active thread", stat: { color: "dim", text: "idle" }, time: "4h" }
];

const PINNED_THREADS = [
  { fav: "BN", favBg: "#111", favFg: "#fff",
    domain: "bank.fi", title: "Account · checking",
    sub: "auto-locks in 4m", stat: { color: "red", text: "auth" }, time: "pin" },
  { fav: "CL", favBg: "#ff3344", favFg: "#fff",
    domain: "calendar.xen", title: "Today · 3 events",
    sub: "next 14:00 · Pia", stat: { color: "dim", text: "pinned" }, time: "pin" }
];

/* Phone — canon-no-demos: RECENTS/CONTACTS hydrate from /api/callers */
const _DEAD_RECENTS = [
  { name: "Marlowe Chen",     init: "MC", bg: "#00dc82", fg: "#03190d", sub: "mobile",       dir: "out",  time: "11:24" },
  { name: "Pia Lindqvist",    init: "PL", bg: "#ffb46a", fg: "#1a0d04", sub: "FaceTime",     dir: "in",   time: "09:18" },
  { name: "+358 50 882 1140", init: "?",  bg: "#1a1a1a", fg: "#c8d0c0", sub: "Helsinki",     dir: "miss", time: "Fri" },
  { name: "Dad",              init: "DD", bg: "#7afff5", fg: "#02261f", sub: "mobile · 24m", dir: "in",   time: "Fri" },
  { name: "Marlowe Chen",     init: "MC", bg: "#00dc82", fg: "#03190d", sub: "mobile (2)",   dir: "out",  time: "Thu" },
  { name: "Voicemail",        init: "✉",  bg: "#1a1a1a", fg: "#c8d0c0", sub: "1 new",        dir: "in",   time: "Thu" },
  { name: "Ravintola Sea",    init: "RS", bg: "#ff3344", fg: "#fff",    sub: "+358 9 612…",  dir: "out",  time: "Wed" }
];

const _DEAD_CONTACTS = [
  { letter: "C", entries: [
    { name: "Marlowe Chen", sub: "+358 41 224 7710", init: "MC", bg: "#00dc82", fg: "#03190d" },
    { name: "Cory Wang",    sub: "cory@xlrd.org",     init: "CW", bg: "#7afff5", fg: "#02261f" }
  ]},
  { letter: "D", entries: [
    { name: "Dad",           sub: "+358 40 555 0188", init: "DD", bg: "#7afff5", fg: "#02261f" },
    { name: "Drew Halloran", sub: "drew@radial.fm",    init: "DH", bg: "#ffb46a", fg: "#1a0d04" }
  ]},
  { letter: "L", entries: [
    { name: "Pia Lindqvist", sub: "+358 50 444 9921", init: "PL", bg: "#ffb46a", fg: "#1a0d04" },
    { name: "Lou Mariani",   sub: "lou@xlrd.org",      init: "LM", bg: "#ff3344", fg: "#fff" }
  ]},
  { letter: "M", entries: [
    { name: "Mom",            sub: "+358 40 555 0144",  init: "MM", bg: "#00dc82", fg: "#03190d" },
    { name: "Mira Sandberg",  sub: "mira@xen.xlrd.org", init: "MS", bg: "#ffb46a", fg: "#1a0d04" }
  ]}
];

const KEYS = [
  ["1", ""], ["2", "ABC"], ["3", "DEF"],
  ["4", "GHI"], ["5", "JKL"], ["6", "MNO"],
  ["7", "PQRS"], ["8", "TUV"], ["9", "WXYZ"],
  ["✱", ""], ["0", "+"], ["#", ""]
];

/* ===========================================================
   PANE 1 — OMNIBOX  (MIRROR — live editorial feed)
   =========================================================== */
/* canon-no-demos: seeds emptied; OmniboxPane hydrates from SSE_URL on mount */
const SEED_EVENTS = [];
const _DEAD_SEEDS_OMITTED = [
  { src: "telegram",  dir: "in",  sender: "Marlowe Chen",     body: "did you see the moon tonight? it looked staged.", ts: -8 },
  { src: "email",     dir: "in",  sender: "calendar.fi",      body: "standup in 4 minutes · with Lou and Pia",                     ts: -32 },
  { src: "beside",    dir: "in",  sender: "Pia",              body: "took the long way home. milk?",                                ts: -94 },
  { src: "whatsapp",  dir: "out", recipient: "Mom",           body: "boarding in 20 — landing 19:14, gate 22B",                     ts: -210 },
  { src: "slack",     dir: "in",  sender: "Drew Halloran",    body: "ok the firmware test passed. shipping it.",                    ts: -340 },
  { src: "x",         dir: "in",  sender: "@karpathy",        body: "the keyboard is the new bottleneck. voice-first computing is back on the menu.", ts: -520 },
  { src: "signal",    dir: "in",  sender: "+358 50 882 1140", body: "Hei, this is the dentist office reminding you of your appointment thursday at 10:30.", ts: -780 },
  { src: "discord",   dir: "in",  sender: "moonlit#7041",     body: "anyone else seeing the canary build crash on the omnibox swipe?", ts: -900 },
  { src: "instagram", dir: "in",  sender: "@cory",            body: "tagged you in a story — sodium finish v2 render",              ts: -1080 },
  { src: "linkedin",  dir: "in",  sender: "Mira Sandberg",    body: "congrats on the launch — would love to chat about the OS",     ts: -1320 },
  { src: "facebook",  dir: "in",  sender: "Mom",              body: "happy birthday darling 🌹",                                     ts: -1600 },
  { src: "telegram",  dir: "out", recipient: "Cory Wang",     body: "love it. let's keep the sodium finish for v2",                  ts: -1840 },
  { src: "beside",    dir: "in",  sender: "Pia",              body: "🌒",                                                            ts: -2100 }
];

const NEW_EVENT_POOL = []; /* canon-no-demos: pool emptied; live SSE drives it */
const _DEAD_POOL_OMITTED = [
  { src: "telegram",  dir: "in",  sender: "Marlowe Chen",  body: "actually scratch that, found a cleaner pattern" },
  { src: "email",     dir: "in",  sender: "weather.fi",    body: "rain expected in 14 minutes · helsinki" },
  { src: "signal",    dir: "in",  sender: "Lou Mariani",   body: "running 5 late, sorry" },
  { src: "beside",    dir: "in",  sender: "Pia",           body: "home in 10" },
  { src: "slack",     dir: "in",  sender: "Drew",          body: "@here — pushing v0.27.1 build to canary in 3" },
  { src: "linkedin",  dir: "in",  sender: "Anders Voss",   body: "would love to hear about the voice-first stack you're building" },
  { src: "whatsapp",  dir: "in",  sender: "Mom",           body: "are you eating enough" },
  { src: "x",         dir: "in",  sender: "@balajis",      body: "this is the right direction. less app, more verb." },
  { src: "discord",   dir: "in",  sender: "yorick#1024",   body: "found a regression in the dialpad cursor — issue filed" },
  { src: "instagram", dir: "in",  sender: "@cory",         body: "sent you a dm" },
  { src: "facebook",  dir: "in",  sender: "Aunt Liisa",    body: "added you to 'Family Recipes 🍞'" },
  { src: "telegram",  dir: "out", recipient: "Drew",       body: "thx — pushing v0.27.1 tonight" },
  { src: "signal",    dir: "in",  sender: "Mira Sandberg", body: "the deck is ready — review when you can" }
];

function fmtRelative(secAgo) {
  if (secAgo < 60) return secAgo + "s";
  if (secAgo < 3600) return Math.floor(secAgo / 60) + "m";
  if (secAgo < 86400) return Math.floor(secAgo / 3600) + "h";
  return Math.floor(secAgo / 86400) + "d";
}

function MirrorCard({ ev, fresh, onReply }) {
  const [open, setOpen] = useState(false);
  const [val, setVal] = useState("");
  const time = new Date(Date.now() + (ev.ts || 0) * 1000);
  const pad = (n) => String(n).padStart(2, "0");
  const when = `${pad(time.getHours())}:${pad(time.getMinutes())}`;
  const sec = pad(time.getSeconds());
  const isOut = ev.dir === "out";
  return (
    <article className={"mcard" + (fresh ? " fresh" : "")} data-src={ev.src}>
      <div className="meta-row">
        <span className="ts"><b>{when}</b>:{sec}</span>
        <span className="mpill src">{ev.src}</span>
        <span className={"mpill dir " + (isOut ? "out" : "")}>
          {isOut ? `out · ${ev.recipient}` : "in"}
        </span>
      </div>
      <div className="who">
        {isOut ? (
          <><b>East</b> → {ev.recipient}</>
        ) : (
          <><b>{ev.sender}</b> → East</>
        )}
      </div>
      <div className="body">{ev.body}</div>
      {!isOut && !open && (
        <button className="reply" onClick={() => setOpen(true)}>reply</button>
      )}
      {open && (
        <div className="reply-form">
          <textarea
            className="reply-ta"
            value={val}
            onChange={(e) => setVal(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                if (val.trim()) { onReply(ev, val.trim()); setOpen(false); setVal(""); }
              }
              if (e.key === "Escape") { setOpen(false); setVal(""); }
            }}
            placeholder={`reply as East to ${ev.sender}…`}
            rows={1}
            autoFocus
          />
          <div className="reply-bar">
            <button className="reply-cancel" onClick={() => { setOpen(false); setVal(""); }}>cancel</button>
            <span className="reply-hint">⌘ + ↵</span>
            <button
              className="reply-send"
              disabled={!val.trim()}
              onClick={() => { if (val.trim()) { onReply(ev, val.trim()); setOpen(false); setVal(""); } }}
            >
              send
            </button>
          </div>
        </div>
      )}
    </article>
  );
}

function OmniboxPane({ voice, onNewEvent }) {
  const [q, setQ] = useState("");
  const [unread, setUnread] = useState(false);
  const [platform, setPlatform] = useState("all");
  const [events, setEvents] = useState([]);
  const [count, setCount] = useState(0);
  const [sseState, setSseState] = useState("connecting");
  const onNewEventRef = useRef(onNewEvent);
  onNewEventRef.current = onNewEvent;

  /* live SSE feed from xen.xlrd.org/events — canon-no-demos */
  useEffect(() => {
    let es;
    let counter = 0;
    let cancelled = false;
    try {
      es = new EventSource(SSE_URL);
      es.onopen = () => { if (!cancelled) setSseState("live"); };
      es.onerror = () => { if (!cancelled) setSseState("reconnecting"); };
      es.onmessage = (msg) => {
        if (cancelled) return;
        let raw;
        try { raw = JSON.parse(msg.data); } catch (e) { return; }
        if (!raw || raw.event === "connected" || !raw.body) return;
        const next = { ...normalizeLiveEvent(raw, counter++), fresh: true, unread: true };
        setEvents((prev) => {
          // de-dupe by chatID+body+absTs
          if (prev.some((p) => p._absTs === next._absTs && p.body === next.body && p.sender === next.sender)) {
            return prev;
          }
          return [next, ...prev].slice(0, 60);
        });
        setCount((c) => c + 1);
        if (onNewEventRef.current) onNewEventRef.current(next);
        setTimeout(() => {
          setEvents((prev) => prev.map((x) => (x.id === next.id ? { ...x, fresh: false } : x)));
        }, 900);
      };
    } catch (e) {
      setSseState("error");
    }
    return () => { cancelled = true; if (es) es.close(); };
  }, []);

  const handleReply = (ev, text) => {
    const reply = {
      src: ev.src,
      dir: "out",
      recipient: ev.sender,
      body: text,
      ts: 0,
      id: "reply-" + Date.now() + "-" + Math.random(),
      fresh: true,
      unread: false
    };
    setEvents((prev) => {
      const next = [reply, ...prev].slice(0, 60);
      return next.map((x) => (x.id === ev.id ? { ...x, unread: false } : x));
    });
    setCount((c) => c + 1);
    /* POST outbound to /mirror/reply per canon_mmm_mirror_full_spec_2026-05-11 */
    try {
      fetch(REPLY_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source: ev.src,
          chatID: ev.chatID || "",
          recipient: ev.sender,
          body: text,
          ts: Date.now() / 1000
        })
      }).catch(() => {});
    } catch (e) {}
    setTimeout(() => {
      setEvents((prev) => prev.map((x) => x.id === reply.id ? { ...x, fresh: false } : x));
    }, 900);
  };

  const shown = useMemo(() => {
    let list = events;
    if (platform !== "all") list = list.filter((e) => e.src === platform);
    if (unread) list = list.filter((e) => e.unread);
    if (q) {
      const n = q.toLowerCase();
      list = list.filter((e) =>
        (e.body || "").toLowerCase().includes(n) ||
        (e.sender || "").toLowerCase().includes(n) ||
        (e.recipient || "").toLowerCase().includes(n) ||
        (e.src || "").toLowerCase().includes(n)
      );
    }
    return list;
  }, [events, platform, unread, q]);

  const PLATFORMS = ["email", "beside", "slack", "instagram", "facebook", "telegram", "whatsapp", "discord", "linkedin", "signal", "x"];

  return (
    <>
      <div className="kicker-bar">
        <div className="kicker">Omnibox · MIRROR</div>
        <div className="mirror-livepill">
          <span className="led" />
          <span>{sseState} · {String(count).padStart(3, "0")}</span>
        </div>
      </div>

      <div className="mirror">
        <div className="mirror-filters">
          <button
            className={"mfilter" + (!unread && platform === "all" ? " active" : "")}
            onClick={() => { setUnread(false); setPlatform("all"); }}
          >
            all
          </button>
          <button
            className={"mfilter" + (unread ? " active" : "")}
            onClick={() => setUnread((u) => !u)}
          >
            unread
          </button>
          <div className="mfilter-select-wrap" data-src={platform !== "all" ? platform : undefined}>
            <span className="mfilter-select-label">
              {platform === "all" ? "platform" : platform}
            </span>
            <span className="mfilter-select-caret">▾</span>
            <select
              className="mfilter-select"
              value={platform}
              onChange={(e) => setPlatform(e.target.value)}
            >
              <option value="all">All platforms</option>
              {PLATFORMS.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="mirror-feed">
          <div className="mirror-prompt">
            <div className="mirror-prompt-row">
              <span className="sigil">›</span>
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={voice ? "type, speak, or paste…" : "type or paste…"}
                autoComplete="off"
                spellCheck={false}
              />
              {!q && <span className="cursor-blink" />}
            </div>
            <div className="mirror-prompt-foot">
              <span>{q ? `filter · "${q}"` : "filter the feed, or run a verb"}</span>
              <span>⌘K · ↵</span>
            </div>
          </div>

          <div className="mirror-feedhead">
            <span className="h">
              {unread ? "Unread" : "All signals"}
              {platform !== "all" && ` · ${platform}`}
            </span>
            <span className="count">{shown.length}</span>
          </div>

          {shown.length === 0 ? (
            <div style={{
              fontFamily: "var(--f-serif)",
              fontStyle: "italic",
              fontSize: 16,
              color: "var(--text-muted)",
              textAlign: "center",
              padding: "40px 20px"
            }}>
              {sseState === "live" ? "awaiting signals…" : sseState + "…"}
            </div>
          ) : (
            shown.map((e) => <MirrorCard key={e.id} ev={e} fresh={e.fresh} onReply={handleReply} />)
          )}
        </div>
      </div>
    </>
  );
}

/* ===========================================================
   PANE 2 — WEBVIEW (rendered web content from active thread)
   =========================================================== */
const TAB_CARDS = [
  { kind: "video",     id: "automate", title: "AUTOMATE OR DIE — Zero-Hum..." },
  { kind: "mirror",    id: "mirror",   title: "MIRROR · live omninbox" },
  { kind: "phone",     id: "gv",       title: "GV Phone" },
  { kind: "portfolio", id: "hitthe",   title: "hitthe.link — Portfolio Navigator" },
  { kind: "xen",       id: "xen",      title: "XEN — Tag It. It's There." }
];

function TabCard({ tab, onClose, onOpen }) {
  /* canon-iframes-banned: click opens via window.open(url, namedTarget) */
  const handleOpen = (e) => {
    if (!tab.url) return;
    e.preventDefault();
    window.open(tab.url, "xen-thread-" + tab.id, "noopener");
  };
  return (
    <div className={"tab-card " + tab.kind} onClick={tab.url ? handleOpen : undefined} style={tab.url ? { cursor: "pointer" } : null}>
      <div className="tab-card-head">
        <div className="close" onClick={(e) => { e.stopPropagation(); onClose && onClose(); }}>✕</div>
        <div className="title">{tab.title}</div>
        <div />
      </div>
      <div className="tab-card-body">
        {tab.kind === "video" && (
          <>
            <span className="live-pill"><span className="led" /><span>live</span></span>
            <div className="vid-meta">
              <div className="vid-play">
                <svg width="14" height="14" viewBox="0 0 12 14"><path d="M0 0 L12 7 L0 14 Z" fill="currentColor"/></svg>
              </div>
              <div className="vid-stack">
                <div className="vid-title">Zero-Human Coffee · Pour-over by Robot Arm</div>
                <div className="vid-stat">
                  <span>● 1,284 watching</span>
                  <span>·</span>
                  <span>4K · 24fps</span>
                </div>
              </div>
            </div>
          </>
        )}

        {tab.kind === "mirror" && (
          <>
            <div className="mini-mirror-head">
              <div className="mini-mirror-h1">MIRROR <em>· live omninbox</em></div>
              <span className="live-green"><span className="led" /><span>live</span></span>
            </div>
            <div className="mini-chips">
              <button className="mini-chip active">all</button>
              <button className="mini-chip">unread</button>
              <button className="mini-chip">platform ▾</button>
            </div>
            <div className="mini-feed-item">
              <div className="mfi-meta">
                <span className="mfi-ts">11:24</span>
                <span className="mfi-src" style={{ background: "rgba(34,211,164,.18)", color: "#22d3a4" }}>BESIDE</span>
                <span className="mfi-dir">in</span>
              </div>
              <div className="mfi-who"><b>Pia</b> → East</div>
              <div className="mfi-body">took the long way home. milk?</div>
            </div>
          </>
        )}

        {tab.kind === "phone" && (
          <>
            <div className="mini-status-row">
              <span className="l"><span className="led" /><span>connected</span></span>
              <span>GV Phone</span>
            </div>
            <div className="mini-thread-row">
              <span>thread</span>
              <span className="mini-pill"><span className="led" /><span>beeper</span></span>
            </div>
            <div className="mini-recents">
              <div className="mr-row">
                <span className="mr-av" style={{ background: "#00dc82", color: "#03190d" }}>MC</span>
                <div className="mr-info">
                  <div className="mr-nm">Marlowe Chen</div>
                  <div className="mr-sub">↗ outgoing · 11:24</div>
                </div>
                <span className="mr-dur">4m</span>
              </div>
              <div className="mr-row">
                <span className="mr-av" style={{ background: "#ffb46a", color: "#1a0d04" }}>PL</span>
                <div className="mr-info">
                  <div className="mr-nm">Pia Lindqvist</div>
                  <div className="mr-sub">↙ FaceTime · 09:18</div>
                </div>
                <span className="mr-dur">12m</span>
              </div>
            </div>
          </>
        )}

        {tab.kind === "portfolio" && (
          <>
            <div className="portfolio-row">
              <span className="dot-amber" />
              <span className="url">hitthe.link</span>
              <span className="action">☾</span>
              <span className="action">⊞</span>
              <span className="browse">Browse</span>
            </div>
            <div className="portfolio-holdings">
              <div className="ph-row">
                <span className="ph-tick">NVDA</span>
                <div className="ph-bar"><i style={{ width: "82%", background: "var(--slack)" }} /></div>
                <span className="ph-val">+8.2%</span>
              </div>
              <div className="ph-row">
                <span className="ph-tick">TSLA</span>
                <div className="ph-bar"><i style={{ width: "54%", background: "var(--slack)" }} /></div>
                <span className="ph-val">+2.1%</span>
              </div>
              <div className="ph-row">
                <span className="ph-tick">APLD</span>
                <div className="ph-bar"><i style={{ width: "23%", background: "var(--red)" }} /></div>
                <span className="ph-val">−1.4%</span>
              </div>
            </div>
          </>
        )}

        {tab.kind === "xen" && (
          <>
            <div className="xen-id">
              <span className="x">XEN</span>
              <span className="tag">CROSS-PLATFORM AI<br/>AGENT</span>
            </div>
            <button className="request-access">REQUEST<br/>ACCESS</button>
          </>
        )}

        {!["video","mirror","phone","portfolio","xen"].includes(tab.kind) && (
          <div style={{ padding: "16px 18px", display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--text-dim)", letterSpacing: ".08em", textTransform: "uppercase" }}>
              {tab.kind}
            </div>
            <div style={{ fontFamily: "var(--f-serif)", fontSize: 17, color: "var(--text)" }}>
              {tab.sender || tab.recipient || "thread"}
            </div>
            <div style={{ fontFamily: "var(--f-mono)", fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>
              {(tab.body || "").slice(0, 140)}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function urlParts(url) {
  try {
    const u = new URL(url);
    return {
      scheme: u.protocol + "//",
      host: u.hostname.replace(/^www\./, ""),
      path: (u.pathname === "/" ? "" : u.pathname) + (u.search || "")
    };
  } catch (e) {
    return { scheme: "https://", host: String(url || ""), path: "" };
  }
}

function OpenedAppPage({ app }) {
  const p = urlParts(app.url);
  return (
    <div className="opened-app">
      <div className="oa-hero">
        <div className="oa-glyph">{app.glyph}</div>
        <div className="oa-name">{app.name}</div>
        <div className="oa-url">{p.scheme}{p.host}{p.path}</div>
      </div>

      <div className="oa-stage">
        <div className="oa-prompt">
          <span className="oa-sig">›</span>
          <input placeholder={`ask ${app.name.toLowerCase()} anything…`} />
        </div>
        <div className="oa-pills">
          <span className="oa-pill">summarize my day</span>
          <span className="oa-pill">draft a reply</span>
          <span className="oa-pill">play something</span>
          <span className="oa-pill">remind me at 18:00</span>
        </div>
        <div className="oa-foot">
          <span>webkit · jit on</span>
          <span>service worker · ready</span>
          <span>cache · 12 MB</span>
        </div>
      </div>
    </div>
  );
}

function BrowserPane({ openedApp, onCloseApp, liveEvents }) {
  const [tabsOpen, setTabsOpen] = useState(true);
  const [closed, setClosed] = useState({});
  /* derive thread tabs from unique chatIDs in live event stream */
  const liveTabs = useMemo(() => {
    const seen = new Map();
    (liveEvents || []).forEach((ev) => {
      const key = ev.chatID || (ev.src + ":" + (ev.sender || ev.recipient || ""));
      if (!key || seen.has(key) || closed[key]) return;
      seen.set(key, {
        kind: ev.src,
        id: key,
        title: (ev.sender || ev.recipient || ev.src) + " · " + ev.src,
        body: ev.body,
        sender: ev.sender,
        recipient: ev.recipient,
        url: null /* most thread chatIDs aren't directly URL-resolvable */
      });
    });
    return Array.from(seen.values()).slice(0, 12);
  }, [liveEvents, closed]);
  const tabs = liveTabs;
  const closeTab = (id) => setClosed((prev) => ({ ...prev, [id]: true }));

  const parts = openedApp
    ? urlParts(openedApp.url)
    : { scheme: "", host: "xen.xlrd.org", path: " · " + tabs.length + " live threads" };

  return (
    <>
      <div className="kicker-bar">
        <div className="kicker chrome">{openedApp ? openedApp.name : `WebView · ${tabs.length} threads`}</div>
        <div className="badge">
          <span className="led" />
          <span>{tabsOpen ? "tab stack" : (openedApp ? "loaded" : "secure · http/3")}</span>
        </div>
      </div>

      <div className="webview-wrap">
        {/* URL bar (Safari-flavored) */}
        <div className="wv-urlbar">
          <div className="wv-action" onClick={openedApp ? onCloseApp : undefined}>{openedApp ? "✕" : "‹"}</div>
          <div className="wv-action">›</div>
          <div className="wv-url">
            <span className="lock">⌬</span>
            <span className="scheme">{parts.scheme}</span>
            <span className="host">{parts.host}</span>
            <span className="path">{parts.path}</span>
          </div>
          <div className="wv-action">↻</div>
          <button
            className={"wv-tabs-toggle" + (tabsOpen ? " active" : "")}
            onClick={() => setTabsOpen((o) => !o)}
            aria-label="Open tab stack"
          >
            <span className="tb-icon" />
          </button>
        </div>

        {/* either the rendered page OR the vertical tab stack */}
        <div className="wv-page-host">
          {tabsOpen ? (
            <div className="wv-tabs-view">
              {tabs.length === 0 && (
                <div style={{
                  fontFamily: "var(--f-serif)",
                  fontStyle: "italic",
                  fontSize: 16,
                  color: "var(--text-muted)",
                  textAlign: "center",
                  padding: "40px 20px"
                }}>
                  no live threads yet…
                </div>
              )}
              {tabs.map((tab) => (
                <TabCard key={tab.id} tab={tab} onClose={() => closeTab(tab.id)} />
              ))}
              <div className="tab-card new" onClick={() => setTabsOpen(false)}>
                <span className="plus">+</span> new tab
              </div>
            </div>
          ) : openedApp ? (
            <OpenedAppPage app={openedApp} />
          ) : (
            <div className="wv-page" style={{ padding: "40px 24px", textAlign: "center", color: "var(--text-muted)", fontFamily: "var(--f-serif)", fontStyle: "italic" }}>
              tap the tab stack to see live threads
            </div>
          )}
          {false && (
            <div className="wv-page" style={{ display: "none" }}>
              <div className="wp-bar">
                <div className="wp-logo"><span className="w">W</span>WIKIPEDIA</div>
                <div className="wp-search">
                  <svg width="14" height="14" viewBox="0 0 18 18" fill="none">
                    <circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.6"/>
                    <path d="M12.5 12.5L16 16" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
                  </svg>
                </div>
              </div>

              <article className="wp-article">
                <div className="wp-from">From Wikipedia, the free encyclopedia</div>
                <h1 className="wp-title">Mars</h1>
                <p className="wp-sub">For other uses, see <a style={{ color: "#36c" }}>Mars (disambiguation)</a>.</p>

                <div className="wp-toolbar">
                  <button>◐ Listen</button>
                  <button>✎ Edit</button>
                  <button>★ Watch</button>
                </div>

                <div className="wp-infobox">
                  <div className="ib-title">Mars ♂</div>
                  <div className="ib-image" role="img" aria-label="Mars from space" />
                  <div className="ib-caption">
                    Mars as photographed by the Hubble Space Telescope, 2003.
                  </div>
                  <table>
                    <tbody>
                      <tr><td>Designations</td><td>4th planet from Sun</td></tr>
                      <tr><td>Pronunciation</td><td>/ˈmɑːrz/</td></tr>
                      <tr><td>Adjectives</td><td>Martian</td></tr>
                      <tr><td>Aphelion</td><td>249,261,000 km</td></tr>
                      <tr><td>Perihelion</td><td>206,650,000 km</td></tr>
                      <tr><td>Orbital period</td><td>686.971 days</td></tr>
                      <tr><td>Mean radius</td><td>3,389.5 km</td></tr>
                      <tr><td>Mass</td><td>6.4171×10²³ kg</td></tr>
                      <tr><td>Surface gravity</td><td>3.72076 m/s²</td></tr>
                      <tr><td>Moons</td><td>Phobos, Deimos</td></tr>
                    </tbody>
                  </table>
                </div>

                <p className="wp-p">
                  <b>Mars</b> is the fourth <a>planet</a> from the <a>Sun</a>. The surface
                  of Mars is orange-red because it is covered in <a>iron(III) oxide</a> dust,
                  giving it the nickname "the <b>Red Planet</b>".<span className="ref">[12]</span>
                  Mars is among the brightest objects in <a>Earth's sky</a> and its high-contrast
                  albedo features have made it a common subject for telescope viewing.
                </p>

                <p className="wp-p">
                  It is a <a>terrestrial planet</a> with a thin atmosphere of mostly
                  <a> carbon dioxide</a>. Mars has a crust primarily composed of elements
                  similar to Earth's crust, as well as a core made of iron and nickel.<span className="ref">[14]</span>
                  Mars has surface features such as <a>impact craters</a>, <a>valleys</a>,
                  <a>dunes</a>, and <a>polar ice caps</a>.
                </p>

                <div className="wp-toc">
                  <b>Contents</b>
                  <ol>
                    <li>Historical observations</li>
                    <li>Physical characteristics</li>
                    <li>Surface geology</li>
                    <li>Hydrology</li>
                    <li>Atmosphere</li>
                    <li>Orbit and rotation</li>
                    <li>Habitability and search for life</li>
                    <li>Moons</li>
                    <li>Exploration</li>
                  </ol>
                </div>

                <h2 className="wp-h2">Historical observations</h2>
                <p className="wp-p">
                  The existence of Mars as a wandering object in the night sky was
                  recorded by ancient <a>Egyptian astronomers</a>, and by 1534 BCE
                  they were familiar with the <a>retrograde motion</a> of the planet.
                  By the period of the <a>Neo-Babylonian Empire</a>, the Babylonian
                  astronomers were making regular records of the positions of the
                  planets and systematic observations of their behavior.
                </p>

                <h2 className="wp-h2">Moons</h2>
                <p className="wp-p">
                  Mars has two relatively small natural moons,
                  <a> Phobos</a> (about 22 km in diameter) and <a>Deimos</a> (about
                  12 km in diameter), which orbit close to the planet. The origin
                  of both moons is unclear, although a popular theory states that
                  they were asteroids captured into Martian orbit.
                </p>

                <div className="wp-quote">
                  "Both moons were discovered in 1877 by American astronomer Asaph Hall,
                  and are named after the characters Phobos (panic/fear) and Deimos
                  (terror/dread) who, in Greek mythology, accompanied their father Ares,
                  god of war, into battle."
                </div>

                <p className="wp-p">
                  Phobos rises in the west, sets in the east, and rises again in
                  just 11 hours. Deimos, being only just outside synchronous orbit,
                  rises as expected in the east but very slowly. Despite the 30-hour
                  orbit of Deimos, it takes 2.7 days to set in the west.
                </p>

                <p className="wp-p">
                  <a>See also: Phobos (moon)</a>
                </p>
              </article>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

/* ===========================================================
   PANE 3 — PHONE
   =========================================================== */
function Dialpad({ callers }) {
  const [num, setNum] = useState("");
  const press = (d) => setNum((n) => (n + d).slice(0, 16));
  const back = () => setNum((n) => n.slice(0, -1));
  const tel = num ? "tel:" + num : null;

  const match = useMemo(() => {
    if (!num) return null;
    const digits = num.replace(/\D/g, "");
    if (!digits) return null;
    const hit = (callers || []).find((c) => (c.e164 || "").replace(/\D/g, "").includes(digits));
    if (hit) return (hit.name || hit.alias || hit.e164) + (hit.persona_hint ? " · " + hit.persona_hint : "");
    if (num.length >= 3) return `${num.length} digits · search contacts`;
    return null;
  }, [num, callers]);

  return (
    <div className="phone-body">
      <div className="dial-area">
        <div className="dial-label">phone</div>
        <div className="dial-display">
          {num ? num : <span className="placeholder">_ _ _ _ _ _</span>}
        </div>
        <div className={"dial-match" + (match ? "" : " muted")}>
          {match || "› tap a key or speak a name"}
        </div>
      </div>

      <div className="ascii-pad">
        {[0, 1, 2, 3].map((row) => (
          <div className="pad-row" key={row}>
            {KEYS.slice(row * 3, row * 3 + 3).map(([n, l]) => (
              <button key={n} className="ascii-key" onClick={() => press(n)}>
                <div className="ak-num" style={n === "✱" ? { fontSize: 32, marginTop: -2 } : null}>{n}</div>
                <div className="ak-chars">{l || "\u00a0"}</div>
              </button>
            ))}
          </div>
        ))}
      </div>

      <div className="call-actions">
        <button className="ca-btn" aria-label="contacts">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/>
            <circle cx="9" cy="7" r="4"/>
            <path d="M22 21v-2a4 4 0 0 0-3-3.87"/>
            <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
          </svg>
        </button>
        <a className="ca-btn call" href={tel || "#"} onClick={(e) => { if (!num) e.preventDefault(); }} style={{ textDecoration: "none" }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            <path d="M20 15.5c-1.2 0-2.5-.2-3.6-.6-.3-.1-.7 0-1 .3l-2.2 2.2c-2.8-1.4-5.2-3.7-6.6-6.6l2.2-2.2c.3-.3.4-.7.3-1-.4-1.1-.6-2.3-.6-3.6 0-.6-.4-1-1-1H4c-.6 0-1 .4-1 1 0 9.4 7.6 17 17 17 .6 0 1-.4 1-1v-3.5c0-.6-.4-1-1-1z"/>
          </svg>
          <span>{num ? "call" : "voicemail"}</span>
        </a>
        <button className="ca-btn" aria-label="backspace" onClick={back}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 4H8l-7 8 7 8h13a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z"/>
            <line x1="18" y1="9" x2="12" y2="15"/>
            <line x1="12" y1="9" x2="18" y2="15"/>
          </svg>
        </button>
      </div>
    </div>
  );
}

/* live callers feed — canon_xlrd_app_path_map_2026-05-11 says 97+ live callers at /api/callers */
const CALLER_PALETTE = [
  { bg: "#00dc82", fg: "#03190d" },
  { bg: "#7afff5", fg: "#02261f" },
  { bg: "#ffb46a", fg: "#1a0d04" },
  { bg: "#ff3344", fg: "#fff" },
  { bg: "#1a1a1a", fg: "#c8d0c0" }
];
function callerInitials(name, e164) {
  const n = (name || "").trim();
  if (!n) return (e164 || "?").replace(/\D/g, "").slice(-2) || "?";
  const parts = n.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return n.slice(0, 2).toUpperCase();
}
function callerColor(key) {
  let h = 0;
  for (let i = 0; i < (key || "").length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
  return CALLER_PALETTE[Math.abs(h) % CALLER_PALETTE.length];
}

function Recents({ callers, status }) {
  if (status !== "ok") {
    return <div className="recents"><div style={{ padding: "20px", color: "var(--text-muted)", fontStyle: "italic" }}>{status}…</div></div>;
  }
  // pull last 12 with at least a name or e164
  const rows = callers.slice(0, 12);
  return (
    <div className="recents">
      {rows.length === 0 && (
        <div style={{ padding: "20px", color: "var(--text-muted)", fontStyle: "italic" }}>no recent callers</div>
      )}
      {rows.map((c, i) => {
        const key = c.e164 || c.name || String(i);
        const col = callerColor(key);
        const name = c.name || c.alias || c.e164 || "unknown";
        const sub = c.persona_hint || c.e164 || "";
        return (
          <a href={c.e164 ? "tel:" + c.e164 : undefined} className="recent-row" key={key + "-" + i} style={{ textDecoration: "none", color: "inherit" }}>
            <div className="av" style={{ background: col.bg, color: col.fg }}>{callerInitials(name, c.e164)}</div>
            <div>
              <div className="nm">{name}</div>
              <div className="sub">
                <span className="dir-in">↙ live</span>
                <span>·</span>
                <span>{sub}</span>
              </div>
            </div>
            <div className="time">{(c.notes || "").includes("[") ? (c.notes.match(/\[([^\]]+)\]/) || [])[1] || "" : ""}</div>
          </a>
        );
      })}
    </div>
  );
}

function Contacts({ callers, status }) {
  if (status !== "ok") {
    return <div className="contacts"><div style={{ padding: "20px", color: "var(--text-muted)", fontStyle: "italic" }}>{status}…</div></div>;
  }
  // group by first letter of name
  const groups = {};
  callers.forEach((c) => {
    const name = c.name || c.alias || c.e164 || "?";
    const letter = (name[0] || "#").toUpperCase();
    if (!groups[letter]) groups[letter] = [];
    groups[letter].push(c);
  });
  const letters = Object.keys(groups).sort();
  return (
    <div className="contacts">
      {letters.length === 0 && (
        <div style={{ padding: "20px", color: "var(--text-muted)", fontStyle: "italic" }}>no contacts</div>
      )}
      {letters.map((letter) => (
        <div key={letter}>
          <div className="contacts-letter">{letter}</div>
          {groups[letter].map((c, i) => {
            const key = c.e164 || c.name || (letter + i);
            const col = callerColor(key);
            const name = c.name || c.alias || c.e164 || "?";
            const sub = c.e164 || c.persona_hint || "";
            return (
              <a href={c.e164 ? "tel:" + c.e164 : undefined} className="contact-row" key={key + "-" + i} style={{ textDecoration: "none", color: "inherit" }}>
                <div className="av" style={{ background: col.bg, color: col.fg }}>{callerInitials(name, c.e164)}</div>
                <div className="nm">
                  {name}
                  <small>{sub}</small>
                </div>
                <div className="quick">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M20 15.5c-1.2 0-2.5-.2-3.6-.6-.3-.1-.7 0-1 .3l-2.2 2.2c-2.8-1.4-5.2-3.7-6.6-6.6l2.2-2.2c.3-.3.4-.7.3-1-.4-1.1-.6-2.3-.6-3.6 0-.6-.4-1-1-1H4c-.6 0-1 .4-1 1 0 9.4 7.6 17 17 17 .6 0 1-.4 1-1v-3.5c0-.6-.4-1-1-1z"/>
                  </svg>
                </div>
              </a>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function PhonePane() {
  const [tab, setTab] = useState("dial");
  const [callers, setCallers] = useState([]);
  const [status, setStatus] = useState("connecting");
  const labels = { dial: "Dialpad", recents: "Recents", contacts: "Contacts" };

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      fetch(CALLERS_URL)
        .then((r) => r.ok ? r.json() : Promise.reject(r.status))
        .then((data) => {
          if (cancelled) return;
          const list = (data && data.callers) || [];
          // strip smoke-test rows
          const real = list.filter((c) => c.persona_hint !== "automated test" && c.name !== "smoke-test");
          setCallers(real);
          setStatus("ok");
        })
        .catch(() => { if (!cancelled) setStatus("reconnecting"); });
    };
    load();
    const id = setInterval(load, 30000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  return (
    <>
      <div className="kicker-bar">
        <div className="kicker">Phone</div>
        <div className="badge muted">{labels[tab]} · {status === "ok" ? callers.length : status}</div>
      </div>

      <div className="phone">
        <div className="phone-tabs">
          <button className={tab === "dial" ? "active" : ""} onClick={() => setTab("dial")}>Dialpad</button>
          <button className={tab === "recents" ? "active" : ""} onClick={() => setTab("recents")}>Recents</button>
          <button className={tab === "contacts" ? "active" : ""} onClick={() => setTab("contacts")}>Contacts</button>
        </div>

        {tab === "dial" && <Dialpad callers={callers} />}
        {tab === "recents" && <Recents callers={callers} status={status} />}
        {tab === "contacts" && <Contacts callers={callers} status={status} />}
      </div>
    </>
  );
}

/* ===========================================================
   APP DRAWER  +  NOTIFICATION TOAST
   =========================================================== */
const DEFAULT_APPS = [
  { id: "grok",  url: "https://grok.com/voice",  glyph: "G", name: "Grok Voice" },
  { id: "v0",    url: "https://v0.dev",          glyph: "V", name: "v0.dev" }
];

function parseAppFromUrl(raw) {
  let url = (raw || "").trim();
  if (!url) return null;
  if (!/^https?:\/\//i.test(url)) url = "https://" + url;
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    const main = host.split(".").slice(-2, -1)[0] || host.split(".")[0];
    return {
      id: "app-" + Date.now() + "-" + Math.random().toString(36).slice(2, 7),
      url,
      host,
      glyph: (main[0] || "?").toUpperCase(),
      name: host
    };
  } catch (e) { return null; }
}

function WebAppIcon({ app, adding, onOpen }) {
  return (
    <button className="web-app" onClick={() => onOpen && onOpen(app)} type="button">
      <div className={"icon" + (adding ? " adding" : "")}>{app.glyph}</div>
      <div className="nm">{app.name}</div>
    </button>
  );
}

function AppDrawer({ open, onClose, apps, onAdd, onOpen }) {
  const [val, setVal] = useState("");
  const [recentlyAddedId, setRecentlyAddedId] = useState(null);
  const inputRef = useRef(null);

  const submit = () => {
    const parsed = parseAppFromUrl(val);
    if (!parsed) return;
    onAdd(parsed);
    setRecentlyAddedId(parsed.id);
    setVal("");
    setTimeout(() => setRecentlyAddedId(null), 700);
  };

  return (
    <>
      <div className={"app-scrim" + (open ? " open" : "")} onClick={onClose} />
      <div className={"app-drawer" + (open ? " open" : "")}>
        <div className="drawer-grabber" onClick={onClose} />
        <div className="drawer-head">
          <div>
            <div className="drawer-eyebrow">WEB APPS</div>
            <div className="drawer-title">Apps</div>
          </div>
          <div className="drawer-web-pill">WEB</div>
        </div>
        <div className="drawer-url-row">
          <input
            ref={inputRef}
            className="drawer-url-input"
            value={val}
            onChange={(e) => setVal(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
            placeholder="https://example.com"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
          />
          <button className="drawer-add-btn" onClick={submit} disabled={!val.trim()}>
            ADD
          </button>
        </div>
        <div className="drawer-grid">
          {apps.map((a) => (
            <WebAppIcon
              key={a.id}
              app={a}
              adding={a.id === recentlyAddedId}
              onOpen={onOpen}
            />
          ))}
        </div>
      </div>
    </>
  );
}

function NotificationToast({ notif }) {
  if (!notif) return null;
  const srcColors = {
    email:     "#d97757",
    beside:    "#22d3a4",
    slack:     "#ECB22E",
    instagram: "#E1306C",
    facebook:  "#1877F2",
    telegram:  "#229ED9",
    whatsapp:  "#25D366",
    discord:   "#5865F2",
    linkedin:  "#0A66C2",
    signal:    "#3A76F0",
    x:         "#E8E8E8"
  };
  const srcBadges = {
    email:     "@",
    beside:    "·",
    slack:     "#",
    instagram: "○",
    facebook:  "f",
    telegram:  "✈",
    whatsapp:  "w",
    discord:   "d",
    linkedin:  "in",
    signal:    "s",
    x:         "X"
  };
  const bg = srcColors[notif.src] || "#ff7a2d";
  const isOut = notif.dir === "out";
  return (
    <div className="notif-host">
      <div className={"notif" + (notif.closing ? " out" : "")}>
        <div className="notif-ico" style={{ background: bg, color: "#0a0a0a" }}>
          {isOut ? "↗" : (notif.sender || "?")[0].toUpperCase()}
          <span className="badge">{srcBadges[notif.src] || "?"}</span>
        </div>
        <div className="notif-body">
          <div className="notif-title">
            {isOut ? `you → ${notif.recipient}` : (notif.sender || "unknown")}
          </div>
          <div className="notif-text">{notif.body}</div>
        </div>
        <div className="notif-time">now</div>
      </div>
    </div>
  );
}

/* ===========================================================
   ROOT
   =========================================================== */
function App() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const panesRef = useRef(null);
  const [paneIdx, setPaneIdx] = useState(t.startPane ?? 1);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [apps, setApps] = useState(DEFAULT_APPS);
  const [openedApp, setOpenedApp] = useState(null);
  const [notif, setNotif] = useState(null);
  const [liveEvents, setLiveEvents] = useState([]);
  const notifTimer = useRef(null);

  useEffect(() => {
    document.documentElement.style.setProperty("--accent", t.accent);
  }, [t.accent]);

  useEffect(() => {
    const el = panesRef.current;
    if (!el) return;
    const w = el.clientWidth;
    el.scrollTo({ left: w * (t.startPane ?? 1), behavior: "instant" });
    const onScroll = () => {
      const idx = Math.round(el.scrollLeft / el.clientWidth);
      setPaneIdx(idx);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
    // eslint-disable-next-line
  }, []);

  const goto = (idx) => {
    const el = panesRef.current;
    if (!el) return;
    el.scrollTo({ left: el.clientWidth * idx, behavior: "smooth" });
  };

  const handleNewEvent = (ev) => {
    setLiveEvents((prev) => [ev, ...prev].slice(0, 60));
    // Only fire toast for inbound events or out for visual variety
    if (ev.dir !== "in") return;
    if (notifTimer.current) clearTimeout(notifTimer.current);
    setNotif({ ...ev, closing: false });
    notifTimer.current = setTimeout(() => {
      setNotif((n) => n ? { ...n, closing: true } : null);
      setTimeout(() => setNotif(null), 300);
    }, 4200);
  };

  const addApp = (app) => setApps((prev) => [...prev, app]);
  const openApp = (app) => {
    /* canon-iframes-banned: external apps open in a named window so repeat clicks reuse it */
    if (app && app.url) {
      window.open(app.url, "xen-app-" + (app.id || app.host || "default"), "noopener");
    }
    setOpenedApp(app);
    setDrawerOpen(false);
    goto(1);
  };
  const closeApp = () => setOpenedApp(null);
  const isConnected = t.connection === "connected";

  return (
    <div className="stage">
      <IOSDevice width={402} height={874} dark={true} time={t.iosTime}>
        <div className="os">
          {/* xen status row */}
          <div className="xen-status">
            <div className="left">
              <span
                className="dot"
                style={isConnected ? null : {
                  background: "var(--red)",
                  boxShadow: "0 0 6px var(--red)"
                }}
              />
              <span style={isConnected ? null : { color: "var(--text-dim)" }}>
                {isConnected ? "connected" : "reconnecting..."}
              </span>
            </div>
            <div className="right">{t.deviceName}</div>
          </div>

          {/* notification toast */}
          <NotificationToast notif={notif} />

          <div className="panes" ref={panesRef}>
            <div className="pane"><OmniboxPane voice={t.voice} onNewEvent={handleNewEvent} /></div>
            <div className="pane"><BrowserPane openedApp={openedApp} onCloseApp={closeApp} liveEvents={liveEvents} /></div>
            <div className="pane"><PhonePane /></div>
          </div>

          {/* hidden app drawer + its grabber */}
          <div className="app-grabber" onClick={() => setDrawerOpen(true)}>
            <span className="lbl">apps</span>
          </div>

          <AppDrawer
            open={drawerOpen}
            onClose={() => setDrawerOpen(false)}
            apps={apps}
            onAdd={addApp}
            onOpen={openApp}
          />

          {t.showDock && (
            <div className="dock">
              <button className={"dock-btn" + (paneIdx === 0 ? " active" : "")} onClick={() => goto(0)}>
                <span className="glyph">›</span><span>omni</span>
              </button>
              <button className={"dock-btn" + (paneIdx === 1 ? " active" : "")} onClick={() => goto(1)}>
                <span className="glyph">≣</span><span>browse</span>
              </button>
              <button className={"dock-btn" + (paneIdx === 2 ? " active" : "")} onClick={() => goto(2)}>
                <span className="glyph">☏</span><span>phone</span>
              </button>
            </div>
          )}
        </div>
      </IOSDevice>

      <TweaksPanel title="Tweaks">
        <TweakSection label="System" />
        <TweakColor
          label="Accent"
          value={t.accent}
          options={ACCENTS}
          onChange={(v) => setTweak("accent", v)}
        />
        <TweakRadio
          label="Connection"
          value={t.connection}
          options={["connected", "reconnecting..."]}
          onChange={(v) => setTweak("connection", v)}
        />
        <TweakText
          label="Device"
          value={t.deviceName}
          onChange={(v) => setTweak("deviceName", v)}
        />
        <TweakToggle
          label="Voice ready"
          value={t.voice}
          onChange={(v) => setTweak("voice", v)}
        />
        <TweakToggle
          label="Show dock"
          value={t.showDock}
          onChange={(v) => setTweak("showDock", v)}
        />

        <TweakSection label="App drawer" />
        <TweakButton
          label={drawerOpen ? "Close drawer" : "Open drawer"}
          onClick={() => setDrawerOpen((o) => !o)}
        />

        <TweakSection label="iOS frame" />
        <TweakText
          label="Status time"
          value={t.iosTime}
          onChange={(v) => setTweak("iosTime", v)}
        />

        <TweakSection label="Navigate" />
        <TweakRadio
          label="Pane"
          value={String(paneIdx)}
          options={["0", "1", "2"]}
          onChange={(v) => goto(parseInt(v, 10))}
        />
      </TweaksPanel>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
