/**
 * GV Phone Bridge API Client
 * Connects to the Electron GV Phone Bridge running on the Mac.
 * Defaults to same-origin bridge proxy paths when served by gv-phone-cap.
 */

class BridgeClient {
  constructor() {
    this.baseUrl = this._detectBaseUrl();
    this.connected = false;
    this.callActive = false;
    this.callState = {
      active: false,
      direction: '',
      number: '',
      provider: '',
      muted: false,
      held: false,
      keypadOpen: false,
      speakerOn: false,
    };
    this.provider = '';
    this.listeners = {};
    this._pollInterval = null;
    this._pendingOutgoingNumber = '';
    this._requestSeq = 0;
    this._dialpadActionChain = Promise.resolve();
    this._lastActionStateAt = 0;
  }

  _normalizeBaseUrl(url) {
    return String(url || '').trim().replace(/\/+$/, '');
  }

  _readOverride(name) {
    try {
      const params = new URLSearchParams(window.location.search || '');
      const queryValue = params.get(name);
      if (queryValue) return queryValue;
    } catch (err) {}

    try {
      if (window.localStorage) {
        const storedValue = window.localStorage.getItem('gvPhone.' + name);
        if (storedValue) return storedValue;
      }
    } catch (err) {}

    const cfg = window.GV_PHONE_CONFIG || {};
    if (cfg && typeof cfg[name] === 'string') return cfg[name];
    return '';
  }

  _detectBaseUrl() {
    const override = this._normalizeBaseUrl(this._readOverride('bridgeBase'));
    if (override) return override;

    const protocol = window.location.protocol || '';
    const isHttpLocation = protocol === 'http:' || protocol === 'https:';

    if (isHttpLocation && window.location.origin && window.location.origin !== 'null') {
      return this._normalizeBaseUrl(window.location.origin);
    }

    return 'https://ggv.xlrd.org';
  }

  setBaseUrl(url) {
    this.baseUrl = this._normalizeBaseUrl(url);
  }

  _digitsOnly(value) {
    const match = String(value || '').match(/\d/g);
    return match ? match.join('') : '';
  }

  _numbersLikelyMatch(a, b) {
    const da = this._digitsOnly(a);
    const db = this._digitsOnly(b);
    if (!da || !db) return false;
    return da === db || da.endsWith(db) || db.endsWith(da);
  }

  on(event, callback) {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(callback);
  }

  _emit(event, data) {
    (this.listeners[event] || []).forEach(function (cb) {
      cb(data);
    });
  }

  _trace(label, payload) {
    var entry = {
      at: Date.now(),
      label: label,
      payload: payload || {}
    };
    try {
      if (!Array.isArray(window.__gvPhoneBridgeTrace)) window.__gvPhoneBridgeTrace = [];
      window.__gvPhoneBridgeTrace.push(entry);
      if (window.__gvPhoneBridgeTrace.length > 200) {
        window.__gvPhoneBridgeTrace = window.__gvPhoneBridgeTrace.slice(-120);
      }
      window.__gvPhoneBridgeLastTrace = entry;
    } catch (err) {}
    try {
      console.log('[bridge-client]', label, JSON.stringify(payload || {}));
    } catch (err2) {
      console.log('[bridge-client]', label, payload || {});
    }
  }

  _queueDialpadAction(runner) {
    var chained = this._dialpadActionChain
      .catch(function () {})
      .then(function () {
        return runner();
      });
    this._dialpadActionChain = chained.catch(function () {});
    return chained;
  }

  _applyState(state, options) {
    var nextState = Object.assign({}, this.callState || {}, state || {});
    var wasActive = this.callActive;
    if (options && options.source === 'action') {
      this._lastActionStateAt = Date.now();
    }
    this.callState = nextState;
    this.callActive = nextState.active === true;
    if (nextState.provider) {
      this.provider = nextState.provider;
    }

    if (options && options.emitLifecycle) {
      if (this.callActive && !wasActive) {
        var direction = nextState.direction || 'incoming';
        if (this._pendingOutgoingNumber && (!nextState.number || this._numbersLikelyMatch(this._pendingOutgoingNumber, nextState.number))) {
          direction = 'outgoing';
          if (!nextState.number) nextState.number = this._pendingOutgoingNumber;
        }
        this.callState = nextState;
        this._pendingOutgoingNumber = '';
        this._emit('call-started', {
          number: nextState.number || '',
          direction: direction,
        });
      } else if (!this.callActive && wasActive) {
        this._pendingOutgoingNumber = '';
        this._emit('call-ended', {});
      }
    }

    this._emit('state', nextState);
    return nextState;
  }

  _maybeApplyResponseState(result, options) {
    var data = result && result.data ? result.data : null;
    if (data && data.provider) {
      this.provider = data.provider;
    }
    if (data && data.state && typeof data.state === 'object') {
      this._applyState(data.state, Object.assign({ source: 'action' }, options || {}));
      return true;
    }
    return false;
  }

  async _fetch(path, options) {
    try {
      this._trace('http-request', {
        path: path,
        method: options && options.method ? options.method : 'GET'
      });
      var resp = await fetch(this.baseUrl + path, options);
      var raw = await resp.text();
      var data = {};
      if (raw) {
        try {
          data = JSON.parse(raw);
        } catch (err) {
          data = { raw: raw, error: raw };
        }
      }
      this._trace('http-response', {
        path: path,
        status: resp.status,
        ok: resp.ok,
        keys: data && typeof data === 'object' ? Object.keys(data).slice(0, 8) : []
      });
      return { ok: resp.ok, status: resp.status, data: data };
    } catch (err) {
      this._trace('http-error', {
        path: path,
        error: err.message
      });
      return { ok: false, status: 0, data: { error: err.message } };
    }
  }

  async _post(path, body) {
    return this._fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  async health() {
    var path = '/health';
    if (
      window.location &&
      (window.location.protocol === 'http:' || window.location.protocol === 'https:') &&
      this.baseUrl === this._normalizeBaseUrl(window.location.origin)
    ) {
      path = '/api/bridge-health';
    }
    var result = await this._fetch(path);
    this.connected = !!(result.ok && result.data && result.data.available !== false);
    this._emit('connection', { connected: this.connected });
    return result;
  }

  async call(phoneNumber) {
    var normalized = String(phoneNumber || '').trim();
    var requestId = 'bridge-call-' + (++this._requestSeq);
    this._trace('call-request', {
      requestId: requestId,
      phoneNumber: normalized
    });
    var result = await this._post('/telephony/action', {
      type: 'call',
      to: { e164: normalized },
    });
    if (!result.ok) {
      if (result.data && result.data.provider === 'zoom-phone') {
        return result;
      }
      var bridgeState = await this.health();
      var bridge = bridgeState && bridgeState.data && bridgeState.data.bridge ? bridgeState.data.bridge : bridgeState && bridgeState.data;
      var provider = (bridge && bridge.provider) || (bridgeState && bridgeState.data && bridgeState.data.provider) || '';
      if (provider && provider !== 'google-voice') {
        return {
          ok: false,
          status: result.status || bridgeState.status || 503,
          data: Object.assign({}, result.data || {}, {
            provider: provider,
            bridge: bridge || bridgeState.data || {},
          }),
        };
      }
      if (bridge && bridge.authBootstrap) {
        return {
          ok: false,
          status: 202,
          data: {
            error: 'Google Voice login required',
            authBootstrap: true,
            bridge: bridge,
          },
        };
      }
      if (bridge && bridge.ready === false) {
        return {
          ok: false,
          status: bridgeState.status || result.status || 503,
          data: {
            error: bridge.error || 'Google Voice bridge not ready',
            bridge: bridge,
          },
        };
      }
      result = await this._fetch('/test-call?number=' + encodeURIComponent(normalized));
    }
    if (result.ok) {
      this._pendingOutgoingNumber = normalized;
    }
    this._trace('call-response', {
      requestId: requestId,
      ok: result.ok,
      status: result.status,
      action: result.data && result.data.action,
      responseRequestId: result.data && result.data.requestId,
      error: result.data && result.data.error,
      detailAction: result.data && result.data.detail && result.data.detail.action,
      confidence: result.data && result.data.detail && result.data.detail.confidence
    });
    this._maybeApplyResponseState(result);
    return result;
  }

  async sms(phoneNumber, message) {
    return this._post('/telephony/action', {
      action: 'sms',
      phoneNumber: phoneNumber,
      message: message,
    });
  }

  async telephonyAction(action, extra) {
    var payload = Object.assign({ action: action }, extra || {});
    var requestId = 'bridge-action-' + (++this._requestSeq);
    this._trace('telephony-action-request', {
      requestId: requestId,
      action: action,
      payload: payload
    });
    var result = await this._post('/telephony/action', payload);
    this._trace('telephony-action-response', {
      requestId: requestId,
      action: action,
      ok: result.ok,
      status: result.status,
      responseRequestId: result.data && result.data.requestId,
      error: result.data && result.data.error
    });
    this._maybeApplyResponseState(result);
    return result;
  }

  async answer() {
    return this.telephonyAction('answer');
  }

  async hangup() {
    var result = await this._post('/hangup', {});
    result.ok = !!(result.ok && result.data && result.data.success);
    if (!this._maybeApplyResponseState(result) && result.ok) {
      this._pendingOutgoingNumber = '';
      this.callActive = false;
      this.callState = Object.assign({}, this.callState || {}, {
        active: false,
        direction: '',
        number: '',
        muted: false,
        held: false,
        keypadOpen: false,
        speakerOn: false,
      });
      this._emit('state', this.callState);
      this._emit('call-ended', {});
    }
    return result;
  }

  async dtmf(digits) {
    var self = this;
    return this._queueDialpadAction(function () {
      return self.telephonyAction('dtmf', { tones: String(digits || '') });
    });
  }

  async toggleMute() {
    return this.telephonyAction('mute');
  }

  async toggleHold() {
    return this.telephonyAction('hold');
  }

  async toggleKeypad() {
    var self = this;
    return this._queueDialpadAction(function () {
      return self.telephonyAction('keypad');
    });
  }

  async toggleSpeaker() {
    return this.telephonyAction('speaker');
  }

  async navigate(url) {
    return this._post('/navigate', { url: url });
  }

  async runOnGV(code) {
    return this._fetch('/exec', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: code,
    });
  }

  async diagnostic() {
    return this._fetch('/diagnostic');
  }

  async rendererState() {
    return this._fetch('/renderer-state');
  }

  startPolling(intervalMs) {
    var self = this;
    if (this._pollInterval) clearInterval(this._pollInterval);
    async function pollOnce() {
      var pollStartedAt = Date.now();
      var result = await self._fetch('/call-state');
      if (!result.ok) {
        if (self.connected) {
          self.connected = false;
          self._emit('connection', { connected: false });
        }
        return;
      }

      if (!self.connected) {
        self.connected = true;
        self._emit('connection', { connected: true });
      }

      var state = result.data || {};
      if (state.active === true && !state.number) {
        var renderer = await self.rendererState();
        if (renderer && renderer.ok && renderer.data) {
          state.number = renderer.data.currentCallNumber || renderer.data.dialNumber || '';
        }
      }
      if (pollStartedAt < self._lastActionStateAt) {
        return;
      }
      self._applyState(state, { emitLifecycle: true, source: 'poll' });
    }

    pollOnce();
    this._pollInterval = setInterval(pollOnce, intervalMs || 2000);
  }

  stopPolling() {
    if (this._pollInterval) {
      clearInterval(this._pollInterval);
      this._pollInterval = null;
    }
  }
}

window.BridgeClient = BridgeClient;
