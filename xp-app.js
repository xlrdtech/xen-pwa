// XP three-panel app — pure DOM construction (no innerHTML).
// Consumes /api/omni/threads, /api/omni/messages, /api/omni/send, /events SSE.

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

const fmt = (ts) => {
  if (!ts) return '';
  const d = new Date(ts), now = Date.now();
  const ago = (now - ts) / 1000;
  if (ago < 60) return 'now';
  if (ago < 3600) return Math.floor(ago / 60) + 'm';
  if (ago < 86400) return Math.floor(ago / 3600) + 'h';
  if (ago < 604800) return Math.floor(ago / 86400) + 'd';
  return d.toISOString().slice(5, 10);
};

const initials = (name) => {
  const w = String(name || '').replace(/^\+?/, '').split(/\s+/).filter(Boolean);
  if (!w.length) return '?';
  if (w[0].match(/^\d/)) return w[0].slice(-2);
  return w.slice(0, 2).map((s) => s[0]).join('').toUpperCase();
};

// DOM-builder helper — safer than innerHTML, no escape-html dance.
function el(tag, attrs, children) {
  const node = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') node.className = v;
      else if (k === 'style') node.style.cssText = v;
      else if (k.startsWith('data-')) node.setAttribute(k, v);
      else if (k === 'hidden' && v) node.hidden = true;
      else if (k === 'on') for (const [evt, fn] of Object.entries(v)) node.addEventListener(evt, fn);
      else node.setAttribute(k, v);
    }
  }
  if (children) {
    for (const c of [].concat(children)) {
      if (c == null) continue;
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
  }
  return node;
}

// === STATE ===
const state = {
  threads: [],
  filter: 'all',
  query: '',
  activeChatID: null,
};

// === FETCH OMNINBOX ===
async function loadThreads() {
  try {
    const r = await fetch('/api/omni/threads');
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || 'omni/threads failed');
    state.threads = j.threads || [];
    renderInbox();
    renderContactsFromThreads();
  } catch (e) {
    const list = $('#inbox-list');
    list.replaceChildren(el('div', { class: 'err' }, e.message));
  }
}

function renderInbox() {
  const list = $('#inbox-list');
  const filtered = state.threads.filter((t) => {
    if (state.filter !== 'all' && t.source !== state.filter) return false;
    if (state.query) {
      const q = state.query.toLowerCase();
      if (!String(t.name || '').toLowerCase().includes(q) &&
          !String(t.snippet || '').toLowerCase().includes(q)) return false;
    }
    return true;
  });
  if (!filtered.length) {
    list.replaceChildren(el('div', { class: 'skeleton' }, 'No matching threads.'));
    return;
  }
  const rows = filtered.map((t) => {
    const cls = ['thread-row'];
    if (t.unread) cls.push('unread');
    if (t.id === state.activeChatID) cls.push('active');
    const av = t.avatar
      ? el('div', { class: 'avatar', style: `background-image:url('${String(t.avatar).replace(/'/g, '')}')` })
      : el('div', { class: 'avatar' }, initials(t.name));
    return el('div', {
      class: cls.join(' '),
      'data-id': t.id,
      'data-source': t.source,
    }, [
      av,
      el('div', { class: 'body' }, [
        el('div', { class: 'row1' }, [
          el('div', { class: 'name' }, t.name || ''),
          el('div', { class: 'ts' }, fmt(t.timestamp)),
        ]),
        el('div', { class: 'snippet' }, [
          el('span', { class: `src-tag ${t.source}` }, t.source),
          ' ' + (t.snippet || ''),
        ]),
      ]),
    ]);
  });
  list.replaceChildren(...rows);
  const counts = state.threads.reduce((a, t) => { a[t.source] = (a[t.source] || 0) + 1; return a; }, {});
  $('#topbar-counts').textContent = Object.entries(counts).map(([k, v]) => `${k}:${v}`).join(' · ');
}

// === THREAD VIEW ===
$('#inbox-list').addEventListener('click', async (e) => {
  const row = e.target.closest('.thread-row');
  if (!row) return;
  const id = row.dataset.id;
  const source = row.dataset.source;
  state.activeChatID = id;
  renderInbox();
  await loadThread(id, source);
  if (window.innerWidth <= 980) {
    $('#layout').className = 'layout';
    $$('.mobile-nav button').forEach((b) => b.classList.toggle('active', b.dataset.view === 'thread'));
  }
});

async function loadThread(chatID, source) {
  const t = state.threads.find((x) => x.id === chatID);
  $('#thread-empty').hidden = true;
  $('#thread-head').hidden = false;
  $('#thread-messages').hidden = false;
  $('#reply-row').hidden = false;
  $('#thread-name').textContent = t ? t.name : chatID;
  $('#thread-meta').textContent = t ? `${t.network || t.source} · ${t.protocol || ''}` : '';
  const msgs = $('#thread-messages');
  msgs.replaceChildren(el('div', { class: 'skeleton' }, 'Loading messages…'));

  // Persona routing — Lyn for Luckie, Eli for Anthony, qi otherwise.
  const pn = String(t?.name || '').toLowerCase();
  let persona = 'qi';
  if (pn.includes('luckie') || pn.includes('goggins')) persona = 'lyn';
  else if (pn.includes('anthony') || pn.includes('vasquez')) persona = 'eli';
  $('#reply-persona').textContent = persona;

  try {
    const url = `/api/omni/messages?chatId=${encodeURIComponent(chatID)}&source=${encodeURIComponent(source)}&limit=40`;
    const r = await fetch(url);
    const j = await r.json();
    const arr = j.messages || [];
    if (!arr.length) {
      msgs.replaceChildren(el('div', { class: 'skeleton' }, 'No messages yet.'));
      return;
    }
    const nodes = arr.slice().reverse().map((m) => {
      const cls = `msg ${m.isOwn ? 'out' : 'in'}`;
      const children = [];
      if (m.author && !m.isOwn) children.push(el('div', { class: 'author' }, m.author));
      children.push(el('div', null, m.text || ''));
      children.push(el('div', { class: 'ts' }, fmt(m.ts)));
      return el('div', { class: cls }, children);
    });
    msgs.replaceChildren(...nodes);
    msgs.scrollTop = msgs.scrollHeight;
  } catch (e) {
    msgs.replaceChildren(el('div', { class: 'err' }, e.message));
  }
}

// === REPLY SEND ===
$('#reply-text').addEventListener('input', (e) => {
  $('#reply-send').disabled = !e.target.value.trim();
  e.target.style.height = 'auto';
  e.target.style.height = Math.min(120, e.target.scrollHeight) + 'px';
});

$('#reply-send').addEventListener('click', async () => {
  const text = $('#reply-text').value.trim();
  if (!text || !state.activeChatID) return;
  // URL paste = mount as app.
  if (/^https?:\/\//.test(text) && !text.includes(' ')) {
    const btn = el('button', { class: 'app', 'data-url': text },
      new URL(text).hostname.replace(/^www\./, ''));
    $('#app-drawer').appendChild(btn);
    $('#reply-text').value = '';
    $('#reply-send').disabled = true;
    return;
  }
  const t = state.threads.find((x) => x.id === state.activeChatID);
  try {
    const r = await fetch('/api/omni/send', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chatID: state.activeChatID, source: t?.source || 'beeper', text }),
    });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || 'send failed');
    $('#reply-text').value = '';
    $('#reply-send').disabled = true;
    setTimeout(() => loadThread(state.activeChatID, t?.source || 'beeper'), 500);
  } catch (e) {
    alert('send failed: ' + e.message);
  }
});

// === SOURCE PILLS ===
$('#pills').addEventListener('click', (e) => {
  const p = e.target.closest('.pill');
  if (!p) return;
  state.filter = p.dataset.src;
  $$('.pill').forEach((b) => b.classList.toggle('active', b === p));
  renderInbox();
});

// === SEARCH ===
$('#search').addEventListener('input', (e) => {
  state.query = e.target.value.trim();
  renderInbox();
});

// === CONTACTS (Beside CRM panel — pulls from /api/contacts unified DB) ===
let contactsCache = [];
async function loadContacts() {
  try {
    const r = await fetch('/api/contacts');
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || '/api/contacts failed');
    contactsCache = j.contacts || [];
    renderContacts();
  } catch (e) {
    $('#contacts-list').replaceChildren(el('div', { class: 'err' }, e.message));
  }
}

function renderContacts() {
  const list = $('#contacts-list');
  const q = ($('#contact-search').value || '').trim().toLowerCase();
  let rows = contactsCache;
  if (q) {
    rows = rows.filter((c) =>
      String(c.name || '').toLowerCase().includes(q) ||
      String(c.e164 || '').toLowerCase().includes(q) ||
      String(c.notes || '').toLowerCase().includes(q)
    );
  }
  if (!rows.length) {
    list.replaceChildren(el('div', { class: 'skeleton' }, 'No contacts.'));
    return;
  }
  const nodes = rows.slice(0, 80).map((c) => {
    const display = c.name || c.e164 || '?';
    const phone = c.e164 || '';
    return el('div', {
      class: 'contact',
      'data-e164': c.e164 || '',
      'data-name': c.name || '',
    }, [
      el('div', { class: 'avatar' }, initials(display)),
      el('div', { class: 'body' }, [
        el('div', { class: 'name' }, display),
        el('div', { class: 'phone' }, phone),
      ]),
      el('div', { class: 'actions' }, [
        el('button', { class: 'dial', title: 'Dial', 'data-e164': c.e164 || '' }, '📞'),
        el('button', { class: 'sms', title: 'SMS', 'data-e164': c.e164 || '' }, '✉'),
      ]),
    ]);
  });
  list.replaceChildren(...nodes);
}

// Rebuild list while qi types in the search box
$('#contact-search').addEventListener('input', renderContacts);

// Click contact actions — dial via Beside, SMS via xen-sms-agent.
$('#contacts-list').addEventListener('click', async (e) => {
  const dial = e.target.closest('.dial');
  const sms  = e.target.closest('.sms');
  if (dial && dial.dataset.e164) {
    try {
      const r = await fetch('/api/call-start', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ caller_e164: dial.dataset.e164 }),
      });
      await r.json();
    } catch {}
    return;
  }
  if (sms && sms.dataset.e164) {
    const text = window.prompt(`SMS to ${sms.dataset.e164}:`);
    if (!text) return;
    try {
      await fetch('/send', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ phoneNumber: sms.dataset.e164, body: text }),
      });
    } catch {}
  }
});

// Backwards-compat shim — original renderContactsFromThreads() callers fall
// through to the unified contacts feed.
function renderContactsFromThreads() {
  if (!contactsCache.length) loadContacts();
  else renderContacts();
}

// === APP DRAWER → mount in middle pane via iframe ===
$('#app-drawer').addEventListener('click', (e) => {
  const a = e.target.closest('.app');
  if (!a || !a.dataset.url) return;
  const url = a.dataset.url;
  $('#thread-empty').hidden = true;
  $('#thread-head').hidden = false;
  $('#thread-name').textContent = new URL(url).hostname;
  $('#thread-meta').textContent = 'XP App · ' + url;
  $('#thread-messages').hidden = false;
  const iframe = el('iframe', {
    src: url,
    style: 'width:100%;height:100%;border:none;background:#fff;border-radius:6px',
  });
  $('#thread-messages').replaceChildren(iframe);
  $('#reply-row').hidden = true;
});

// === MOBILE NAV ===
$$('.mobile-nav button').forEach((btn) => {
  btn.addEventListener('click', () => {
    $$('.mobile-nav button').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    const v = btn.dataset.view;
    $('#layout').className = 'layout' + (v === 'inbox' ? ' show-inbox' : v === 'crm' ? ' show-crm' : '');
  });
});

// === LIVE SSE (omnimind /events) ===
try {
  const sse = new EventSource('/events');
  sse.onmessage = () => loadThreads();
} catch {}

// === BOOT ===
loadThreads();
loadContacts();
// Poll cadence per Commandment 9 (live by default). 5s for omninbox feels
// real-time; 60s for contacts (lower change rate). Push-instant via SSE
// `omni:new-thread` event is a next-session canonical fix — currently SSE
// only emits on bot/voice activity, not raw inbound arrivals.
setInterval(loadThreads, 5000);
setInterval(loadContacts, 60000);
