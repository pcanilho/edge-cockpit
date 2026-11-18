// On a phone, the console talks to the PC over a WebSocket instead of Tauri. This runs before
// the app and, when the page came from the app's phone link (port 47823), stands in for
// window.__TAURI__: invoke() becomes a call over the link, listen() an event from it.
// Pairing: the PC shows a six-digit code; the phone sends it once and gets a random token,
// kept here. After that the phone proves itself by answering the PC's fresh challenge with
// HMAC-SHA256 of the token, so the token never travels again. (Plain http has no WebCrypto,
// hence the small SHA-256 below.)
(() => {
  if (window.__TAURI__) return;
  const q = new URLSearchParams(location.search);
  const served = location.port === '47823';
  if (!served && !q.has('phone')) return;
  const linked = served && !q.has('demo');

  // ---- SHA-256 and HMAC (FIPS 180-4, RFC 2104) ----
  const K = new Uint32Array([0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d,
    0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
    0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2]);
  function sha256(bytes) {
    const len = bytes.length, padded = new Uint8Array(((len + 9 + 63) >> 6) << 6);
    padded.set(bytes); padded[len] = 0x80;
    const dv = new DataView(padded.buffer);
    dv.setUint32(padded.length - 4, len * 8); dv.setUint32(padded.length - 8, Math.floor(len / 0x20000000));
    const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
    const W = new Uint32Array(64);
    const r = (x, n) => (x >>> n) | (x << (32 - n));
    for (let o = 0; o < padded.length; o += 64) {
      for (let i = 0; i < 16; i++) W[i] = dv.getUint32(o + i * 4);
      for (let i = 16; i < 64; i++) {
        const s0 = r(W[i - 15], 7) ^ r(W[i - 15], 18) ^ (W[i - 15] >>> 3), s1 = r(W[i - 2], 17) ^ r(W[i - 2], 19) ^ (W[i - 2] >>> 10);
        W[i] = W[i - 16] + s0 + W[i - 7] + s1;
      }
      let [a, b, c, d, e, f, g, h] = H;
      for (let i = 0; i < 64; i++) {
        const t1 = (h + (r(e, 6) ^ r(e, 11) ^ r(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + W[i]) >>> 0;
        const t2 = ((r(a, 2) ^ r(a, 13) ^ r(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
        h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
      }
      H[0] += a; H[1] += b; H[2] += c; H[3] += d; H[4] += e; H[5] += f; H[6] += g; H[7] += h;
    }
    const out = new Uint8Array(32);
    H.forEach((v, i) => new DataView(out.buffer).setUint32(i * 4, v));
    return out;
  }
  function hmac(key, msg) {
    const k = new Uint8Array(64);
    k.set(key.length > 64 ? sha256(key) : key);
    const pad = b => k.map(x => x ^ b);
    const inner = new Uint8Array(64 + msg.length); inner.set(pad(0x36)); inner.set(msg, 64);
    const outer = new Uint8Array(96); outer.set(pad(0x5c)); outer.set(sha256(inner), 64);
    return sha256(outer);
  }
  const hex = b => [...b].map(x => x.toString(16).padStart(2, '0')).join('');
  const unhex = s => new Uint8Array((s.match(/../g) || []).map(x => parseInt(x, 16)));
  const utf8 = s => new TextEncoder().encode(s);

  // ---- the link ----
  const STORE = 'ec-phone';
  const saved = () => { try { return JSON.parse(localStorage.getItem(STORE)) || null; } catch { return null; } };
  const save = v => { try { v ? localStorage.setItem(STORE, JSON.stringify(v)) : localStorage.removeItem(STORE); } catch { /* private mode: pair again next time */ } };

  const listeners = new Map(); // event name -> Set of callbacks
  const pending = new Map(); // call number -> { ok, fail }
  const queue = []; // calls made before the link is up
  const watchers = new Set();
  let ws = null, n = 0, retry = 0, pingTimer = null, lastPong = 0;
  const phone = {
    ui: true, linked,
    /** 'connecting' | 'pair' | 'ok' | 'offline' */
    state: linked ? 'connecting' : 'ok',
    error: null,
    me: null, // { id, name, plate, mode }
    rtt: null,
    onState: f => { watchers.add(f); f(phone.state); },
    pair: code => { phone.error = null; sendRaw({ t: 'pair', code: String(code) }); },
    forget: () => { save(null); phone.me = null; ws?.close(); },
  };
  window.__EC_PHONE__ = phone;
  const setState = s => { phone.state = s; for (const f of watchers) f(s); };
  const emit = (name, payload) => { for (const f of listeners.get(name) || []) f({ payload }); };
  function sendRaw(m) { if (ws?.readyState === 1) ws.send(JSON.stringify(m)); }

  // A scanned QR carries the pairing code after #pair=: pair with it once, then drop it from the address.
  let scanned = /^#pair=(\d{6})$/.exec(location.hash)?.[1] || null;
  if (location.hash) history.replaceState(null, '', location.pathname + location.search);
  function connect() {
    if (!linked) return;
    setState(phone.state === 'pair' ? 'pair' : 'connecting');
    ws = new WebSocket(`ws://${location.host}/link`);
    ws.onmessage = e => {
      let m; try { m = JSON.parse(e.data); } catch { return; }
      if (m.t === 'hello') {
        const me = saved();
        if (me?.id && me.token) sendRaw({ t: 'auth', id: me.id, mac: hex(hmac(unhex(me.token), utf8(m.nonce))) });
        else if (scanned) { phone.pair(scanned); scanned = null; } else setState('pair');
      } else if (m.t === 'ok') {
        retry = 0;
        if (m.token) save({ id: m.id, token: m.token });
        phone.me = { id: m.id, name: m.name, plate: m.plate, mode: m.mode };
        setState('ok');
        for (const c of queue.splice(0)) sendRaw(c);
        emit('phone-config', phone.me);
        clearInterval(pingTimer);
        pingTimer = setInterval(() => sendRaw({ t: 'ping', at: performance.now() }), 15000);
        sendRaw({ t: 'ping', at: performance.now() });
      } else if (m.t === 'denied') {
        if (m.why === 'unknown') save(null);
        phone.error = m.why === 'code' ? 'That code did not match. Check Settings › Devices on the PC.' : null;
        setState('pair');
      } else if (m.t === 'pong') {
        lastPong = performance.now();
        phone.rtt = Math.round(lastPong - m.at);
      } else if (m.t === 'ret') {
        const p = pending.get(m.n);
        if (!p) return;
        pending.delete(m.n);
        m.ok ? p.ok(m.v) : p.fail(new Error(m.e));
      } else if (m.t === 'ev') {
        if (m.name === 'phone-config') phone.me = { ...phone.me, ...m.p };
        emit(m.name, m.p);
      }
    };
    ws.onclose = () => {
      clearInterval(pingTimer);
      for (const [, p] of pending) p.fail(new Error('link down'));
      pending.clear();
      if (phone.state !== 'pair') setState('offline');
      // A denied pairing closes the link: open a fresh one for the next try.
      setTimeout(connect, phone.state === 'pair' ? 300 : Math.min(5000, 500 * 2 ** retry++));
    };
  }

  function invoke(cmd, args = {}) {
    if (!linked) return Promise.reject(new Error('Only in the app'));
    const call = { t: 'call', n: ++n, cmd, args };
    return new Promise((ok, fail) => {
      pending.set(call.n, { ok, fail });
      if (phone.state === 'ok') sendRaw(call);
      // Keys are for now, never later.
      else if (cmd === 'key' || cmd === 'wheel') { pending.delete(call.n); fail(new Error('no-link')); }
      else queue.push(call);
    });
  }

  if (linked) {
    window.__TAURI__ = {
      core: { invoke },
      event: {
        listen: (name, f) => {
          if (!listeners.has(name)) listeners.set(name, new Set());
          listeners.get(name).add(f);
          return Promise.resolve(() => listeners.get(name).delete(f));
        },
      },
    };
    connect();
    // Coming back to the app: reconnect at once rather than waiting out the backoff.
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && (!ws || ws.readyState > 1)) { retry = 0; connect(); }
    });
  }
})();
