/* omni-inbox.js — OmniInbox live data implementation
 * SEL 9_ Xen PWA — unified thread list across all channels
 */
(function () {
  'use strict';

  // ── Source endpoints ──────────────────────────────────────────────────────
  const SRC_XENCORE = 'http://localhost:3461/api/beeper/threads?limit=100&includeLowPriority=true';
  const SRC_BEEPER  = 'http://localhost:2221/chats';
  const SRC_ADB     = 'http://localhost:2222/threads';
  const BRAIN_SSE   = 'http://localhost:1110/stream';
  const FETCH_TIMEOUT_MS = 5000;
  const POLL_MS = 10000;

  // ── Protocol → badge color ────────────────────────────────────────────────
  const PROTO_COLORS = {
    'gmessages-sms':  '#00dc82',
    'gmessages-rcs':  '#00dc82',
    'sms':            '#00dc82',
    'gvoice':         '#3b8ef0',
    'google-voice':   '#3b8ef0',
    'google voice':   '#3b8ef0',
    'imessage':       '#00c5ad',
    'beeper':         '#b069f0',
    'matrix':         '#b069f0',
    'whatsapp':       '#25d366',
    'telegram':       '#2ca5e0',
    'facebookgo':     '#1877f2',
    'facebook':       '#1877f2',
    'slackgo':        '#e8b059',
    'slack':          '#e8b059',
    'linkedin':       '#0077b5',
    'signal':         '#2592e9',
  };

  function protoColor(protocol) {
    return PROTO_COLORS[(protocol || '').toLowerCase()] || 'rgba(255,255,255,0.28)';
  }

  function relTime(ts) {
    if (!ts) return '';
    const diff = Date.now() - ts;
    const m = Math.floor(diff / 60000);
    if (m < 1)  return 'now';
    if (m < 60) return m + 'm';
    const h = Math.floor(m / 60);
    if (h < 24) return h + 'h';
    const d = Math.floor(h / 24);
    if (d < 7)  return d + 'd';
    return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  function esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function initials(name) {
    return String(name || '?').replace(/[^a-zA-Z0-9]/g, ' ').trim()
      .split(/\s+/).slice(0, 2).map(w => w[0] || '').join('').toUpperCase() || '?';
  }

  // ── Normalise raw thread from each source into unified shape ──────────────
  function normalise(raw, source) {
    if (!raw) return null;
    if (source === 'xencore') {
      return {
        id:        String(raw.id || ''),
        name:      raw.title || raw.id || '',
        snippet:   raw.preview || '',
        timestamp: raw.timestamp || 0,
        protocol:  raw.protocol || 'gvoice',
        network:   raw.network || raw.protocol || 'GV',
        unread:    !!raw.unread,
        pinned:    !!raw.pinned,
        avatar:    raw.avatarUrl || '',
        _raw:      raw,
      };
    }
    if (source === 'beeper') {
      return {
        id:        String(raw.id || raw.chatID || ''),
        name:      raw.name || raw.title || 'Unknown',
        snippet:   raw.lastMessage || raw.preview || '',
        timestamp: raw.timestamp || raw.lastActivity || 0,
        protocol:  raw.protocol || 'beeper',
        network:   raw.network || 'Beeper',
        unread:    !!(raw.unreadCount > 0 || raw.unread),
        pinned:    !!raw.pinned,
        avatar:    raw.avatarUrl || raw.avatar || '',
        _raw:      raw,
      };
    }
    if (source === 'adb') {
      return {
        id:        'adb:' + String(raw.thread_id || raw.id || ''),
        name:      raw.name || raw.address || 'SMS',
        snippet:   raw.snippet || raw.body || '',
        timestamp: raw.date || raw.timestamp || 0,
        protocol:  'gmessages-sms',
        network:   'SMS',
        unread:    !!(raw.read === 0 || raw.unread),
        pinned:    false,
        avatar:    '',
        _raw:      raw,
      };
    }
    return null;
  }

  // ── OmniInbox class ───────────────────────────────────────────────────────
  class OmniInbox {
    constructor() {
      this._threads   = [];
      this._activeId  = null;
      this._query     = '';
      this._protocol  = 'all';
      this._pollTimer = null;
      this._sse       = null;
      this._container = null;
    }

    // Wire up DOM, start polling and SSE
    init() {
      this._container = document.querySelector('.beeper-thread-list')
                     || document.getElementById('beeper-thread-strip');

      const searchInput    = document.getElementById('beeper-search');
      const protocolSelect = document.getElementById('beeper-protocol-filter');
      const refreshBtn     = document.getElementById('beeper-refresh-btn');

      if (searchInput) {
        searchInput.addEventListener('input', () => {
          this._query = searchInput.value.toLowerCase();
          this.render(this._threads);
        });
      }
      if (protocolSelect) {
        protocolSelect.addEventListener('change', () => {
          this._protocol = protocolSelect.value || 'all';
          this.render(this._threads);
        });
      }
      if (refreshBtn) {
        refreshBtn.addEventListener('click', () => this.fetchAll());
      }

      this.fetchAll();
      this._pollTimer = setInterval(() => this.fetchAll(), POLL_MS);
      this.startRealtime();
    }

    // Parallel fetch from all sources, merge, sort, render
    async fetchAll() {
      const [xc, bp, ab] = await Promise.all([
        this._fetch(SRC_XENCORE, 'xencore'),
        this._fetch(SRC_BEEPER,  'beeper'),
        this._fetch(SRC_ADB,     'adb'),
      ]);

      const merged = [...xc, ...bp, ...ab].filter(Boolean);

      // Deduplicate by id (first wins — xencore is first)
      const seen = new Set();
      const unique = [];
      for (const t of merged) {
        if (t.id && !seen.has(t.id)) { seen.add(t.id); unique.push(t); }
      }

      // Pinned first, then newest first
      unique.sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        return b.timestamp - a.timestamp;
      });

      this._threads = unique;

      // Sync active thread id from existing global (for active styling)
      if (window.beeperThreads) {
        const active = window.beeperThreads.find(t => t && t.active);
        if (active) this._activeId = active.id;
      }

      this.render(this._threads);
    }

    // Fetch one source and normalise; returns [] on any failure
    async _fetch(url, source) {
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
        const r = await fetch(url, { signal: ctrl.signal });
        clearTimeout(timer);
        if (!r.ok) return [];
        const data = await r.json();
        // xencore returns {ok, threads:[]}
        // beeper external returns [] or {chats:[], threads:[]}
        // adb returns [] or {threads:[]}
        const raw = Array.isArray(data)
          ? data
          : (data.threads || data.chats || []);
        return raw.map(item => normalise(item, source)).filter(Boolean);
      } catch {
        return [];
      }
    }

    // Render filtered thread list into container
    render(threads) {
      if (!this._container) return;

      const q  = this._query;
      const pf = this._protocol;

      const visible = threads.filter(t => {
        const haystack = (t.name + ' ' + t.snippet).toLowerCase();
        const matchQ = !q || haystack.includes(q);
        const matchP = pf === 'all'
          || (t.protocol || '').toLowerCase() === pf
          || (t.network  || '').toLowerCase() === pf;
        return matchQ && matchP;
      });

      this._container.innerHTML = '';

      if (!visible.length) {
        const empty = document.createElement('div');
        empty.className = 'chat-thread-empty';
        empty.textContent = (q || pf !== 'all') ? 'No matching threads.' : 'No threads loaded.';
        this._container.appendChild(empty);
        return;
      }

      const frag = document.createDocumentFragment();

      visible.forEach(thread => {
        const isActive = thread.id === this._activeId;
        const color    = protoColor(thread.protocol);
        const init     = initials(thread.name);

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'beeper-thread-item chat-thread-card'
          + (isActive      ? ' active' : '')
          + (thread.unread ? ' unread' : '')
          + (thread.pinned ? ' pinned' : '');

        // data attributes for external filter compatibility
        btn.dataset.name     = thread.name;
        btn.dataset.snippet  = thread.snippet;
        btn.dataset.protocol = (thread.protocol || 'sms').toLowerCase();

        // Avatar: show img if avatarUrl exists, otherwise initials fallback
        const avatarHtml = thread.avatar
          ? `<img class="chat-thread-avatar-img hidden" alt="" />
             <div class="chat-thread-avatar-fallback">${esc(init)}</div>`
          : `<img class="chat-thread-avatar-img hidden" alt="" />
             <div class="chat-thread-avatar-fallback">${esc(init)}</div>`;

        btn.innerHTML =
          `<div class="chat-thread-card-pin${thread.pinned ? ' pinned' : ''}" aria-hidden="true">✦</div>` +
          `<div class="chat-thread-avatar">${avatarHtml}</div>` +
          `<div class="chat-thread-card-copy">` +
            `<div class="chat-thread-card-title"></div>` +
            `<div class="chat-thread-card-meta"></div>` +
            `<div class="chat-thread-card-preview"></div>` +
          `</div>`;

        btn.querySelector('.chat-thread-card-title').textContent = thread.name;

        // Meta row: protocol dot + network label + relative time
        const meta = btn.querySelector('.chat-thread-card-meta');
        meta.style.cssText = 'display:flex;align-items:center;gap:4px;';
        meta.innerHTML =
          `<span style="flex-shrink:0;display:inline-block;width:6px;height:6px;` +
          `border-radius:50%;background:${color};"></span>` +
          `<span style="overflow-wrap:break-word;word-break:normal;hyphens:none;flex:1;` +
          `min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">` +
          `${esc(thread.network || thread.protocol || 'MSG')}</span>` +
          (thread.timestamp
            ? `<span style="flex-shrink:0;opacity:0.52;">${esc(relTime(thread.timestamp))}</span>`
            : '');

        btn.querySelector('.chat-thread-card-preview').textContent =
          thread.snippet || 'Open thread';

        // Avatar image load/error
        if (thread.avatar) {
          const img = btn.querySelector('.chat-thread-avatar-img');
          const fb  = btn.querySelector('.chat-thread-avatar-fallback');
          img.onload  = () => { img.classList.remove('hidden'); fb.classList.add('hidden'); };
          img.onerror = () => { img.classList.add('hidden');    fb.classList.remove('hidden'); };
          img.src = thread.avatar;
        }

        btn.addEventListener('click', () => {
          this._activeId = thread.id;
          // Update active styling immediately
          this._container.querySelectorAll('.beeper-thread-item').forEach(el => {
            el.classList.toggle('active', el.dataset.name === thread.name
              && el.dataset.protocol === btn.dataset.protocol);
          });
          // Delegate to existing openBeeperThread (handles messages + drawer)
          if (typeof openBeeperThread === 'function') {
            openBeeperThread(thread._raw || thread);
          }
        });

        frag.appendChild(btn);
      });

      this._container.appendChild(frag);
    }

    // SSE push from brain daemon — triggers fetchAll on any event
    startRealtime() {
      if (this._sse) {
        try { this._sse.close(); } catch { /* ignore */ }
        this._sse = null;
      }
      try {
        const es = new EventSource(BRAIN_SSE);
        es.onmessage = () => this.fetchAll();
        es.onerror = () => {
          if (es.readyState === EventSource.CLOSED) {
            this._sse = null;
            setTimeout(() => this.startRealtime(), 30000);
          }
        };
        this._sse = es;
      } catch { /* SSE unavailable — polling-only mode */ }
    }
  }

  // ── Bootstrap ──────────────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', () => {
    window.omniInbox = new OmniInbox();
    window.omniInbox.init();
  });

})();
