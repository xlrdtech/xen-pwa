// phone-state.js — single source of truth for PWA phone mode + voice-control dispatcher.
// Sibling to bridge-client.js (NEVER modify bridge-client.js — canon).
//
// State shape: window.__phoneState = {
//   mode: 'idle' | 'incoming' | 'oncall' | 'multicall',
//   primary:   { e164, name, line, connectedAt } | null,
//   secondary: { e164, name, line, connectedAt, held } | null,
//   conf: false,
// }
//
// The body's `data-mode` attribute mirrors mode for CSS-driven surface swap.
// All mutations funnel through applyPhoneAction(action, payload) — voice and
// touch are equivalent inputs. WS frames from /api/pwa-control arrive as:
//   { event: 'phone-control', verb, args, ... }
'use strict';

(function () {
  const initial = { mode: 'idle', primary: null, secondary: null, conf: false };
  window.__phoneState = window.__phoneState || initial;

  function setMode(mode) {
    window.__phoneState.mode = mode;
    document.body.setAttribute('data-mode', mode);
    document.dispatchEvent(new CustomEvent('phonestate', { detail: { ...window.__phoneState } }));
  }

  function patch(partial) {
    Object.assign(window.__phoneState, partial);
    document.body.setAttribute('data-mode', window.__phoneState.mode);
    document.dispatchEvent(new CustomEvent('phonestate', { detail: { ...window.__phoneState } }));
  }

  // Single funnel — every state mutation goes through here.
  // Voice verbs and DOM clicks both call applyPhoneAction.
  function applyPhoneAction(action, payload = {}) {
    const s = window.__phoneState;
    switch (action) {
      // navigation
      case 'show-tab':
        document.body.setAttribute('data-tab', payload.tab || 'inbox');
        break;

      // outbound
      case 'place-call':
        if (s.mode === 'oncall') {
          patch({ secondary: { ...payload, connectedAt: Date.now(), held: false }, primary: { ...s.primary, held: true }, mode: 'multicall' });
        } else {
          patch({ primary: { ...payload, connectedAt: Date.now(), held: false }, mode: 'oncall' });
        }
        break;

      // inbound
      case 'incoming':
        if (s.mode === 'oncall') {
          patch({ secondary: { ...payload, ringing: true }, mode: 'multicall' });
        } else {
          patch({ primary: { ...payload, ringing: true }, mode: 'incoming' });
        }
        break;
      case 'answer':
        if (s.primary && s.primary.ringing) {
          patch({ primary: { ...s.primary, ringing: false, connectedAt: Date.now() }, mode: 'oncall' });
        } else if (s.secondary && s.secondary.ringing) {
          patch({ secondary: { ...s.secondary, ringing: false, connectedAt: Date.now() }, primary: { ...s.primary, held: true }, mode: 'multicall' });
        }
        break;
      case 'decline':
        if (s.secondary && s.secondary.ringing) patch({ secondary: null, mode: 'oncall' });
        else patch({ primary: null, secondary: null, mode: 'idle' });
        break;

      // call control
      case 'hangup':
        if (s.mode === 'multicall' && s.secondary) {
          patch({ secondary: null, primary: { ...s.primary, held: false }, mode: 'oncall' });
        } else {
          patch({ primary: null, secondary: null, conf: false, mode: 'idle' });
        }
        break;
      case 'mute':
        patch({ muted: !!payload.on });
        break;
      case 'speaker':
        patch({ speaker: !!payload.on });
        break;
      case 'hold':
        if (s.primary) patch({ primary: { ...s.primary, held: !s.primary.held } });
        break;
      case 'swap':
        if (s.primary && s.secondary) patch({ primary: s.secondary, secondary: s.primary });
        break;
      case 'merge':
        if (s.primary && s.secondary) patch({ conf: true, primary: { ...s.primary, held: false }, secondary: { ...s.secondary, held: false } });
        break;

      // inbox
      case 'open-thread':
        document.dispatchEvent(new CustomEvent('phone:open-thread', { detail: payload }));
        break;
      case 'send-message':
        document.dispatchEvent(new CustomEvent('phone:send-message', { detail: payload }));
        break;

      default:
        console.warn('[phone-state] unknown action:', action, payload);
    }
  }

  // Voice-verb → action mapping. Mirrors blueprint section 4.
  const VERB_MAP = {
    'call':         (a) => ({ action: 'place-call', payload: { e164: a.target, name: a.name, line: a.line } }),
    'answer':       () => ({ action: 'answer' }),
    'pickup':       () => ({ action: 'answer' }),
    'decline':      () => ({ action: 'decline' }),
    'ignore':       () => ({ action: 'decline' }),
    'hangup':       () => ({ action: 'hangup' }),
    'end':          () => ({ action: 'hangup' }),
    'mute':         () => ({ action: 'mute', payload: { on: true } }),
    'unmute':       () => ({ action: 'mute', payload: { on: false } }),
    'speaker-on':   () => ({ action: 'speaker', payload: { on: true } }),
    'speaker-off':  () => ({ action: 'speaker', payload: { on: false } }),
    'hold':         () => ({ action: 'hold' }),
    'resume':       () => ({ action: 'hold' }),
    'swap':         () => ({ action: 'swap' }),
    'merge':        () => ({ action: 'merge' }),
    'show-inbox':   () => ({ action: 'show-tab', payload: { tab: 'inbox' } }),
    'show-keypad':  () => ({ action: 'show-tab', payload: { tab: 'keypad' } }),
    'show-contacts':() => ({ action: 'show-tab', payload: { tab: 'contacts' } }),
    'show-recents': () => ({ action: 'show-tab', payload: { tab: 'recents' } }),
    'show-voicemail':()=> ({ action: 'show-tab', payload: { tab: 'voicemail' } }),
    'open-thread':  (a) => ({ action: 'open-thread', payload: a }),
    'send':         (a) => ({ action: 'send-message', payload: a }),
  };

  function dispatchVerb(verb, args = {}) {
    const fn = VERB_MAP[verb];
    if (!fn) { console.warn('[phone-state] unknown verb:', verb); return; }
    const { action, payload } = fn(args);
    applyPhoneAction(action, payload || {});
  }

  // WS frames from /api/pwa-control land here.
  function handleControlFrame(frame) {
    if (!frame || frame.event !== 'phone-control') return;
    dispatchVerb(String(frame.verb || '').toLowerCase(), frame.args || {});
  }

  // Auto-attach to any WebSocket created by the page (covers bridge-client.js
  // and inbox poller without modifying them — we wrap the constructor).
  const NativeWS = window.WebSocket;
  if (NativeWS && !NativeWS.__xenPatched) {
    function PatchedWS(url, protocols) {
      const ws = protocols ? new NativeWS(url, protocols) : new NativeWS(url);
      ws.addEventListener('message', (ev) => {
        try {
          const data = typeof ev.data === 'string' ? JSON.parse(ev.data) : null;
          if (data && data.event === 'phone-control') handleControlFrame(data);
        } catch (_) {}
      });
      return ws;
    }
    PatchedWS.prototype = NativeWS.prototype;
    PatchedWS.CONNECTING = NativeWS.CONNECTING;
    PatchedWS.OPEN = NativeWS.OPEN;
    PatchedWS.CLOSING = NativeWS.CLOSING;
    PatchedWS.CLOSED = NativeWS.CLOSED;
    PatchedWS.__xenPatched = true;
    window.WebSocket = PatchedWS;
  }

  // Initial body attribute
  document.body.setAttribute('data-mode', window.__phoneState.mode);

  // Public API
  window.__phone = {
    state: () => ({ ...window.__phoneState }),
    apply: applyPhoneAction,
    verb: dispatchVerb,
    setMode,
  };
})();
