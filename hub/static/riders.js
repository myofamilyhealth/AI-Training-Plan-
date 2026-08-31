/* Rider accounts, in the browser.
 *
 * There is no server behind this site and there is not one behind this file
 * either. An account is a name, a hashed password and a slot in this browser's
 * storage; signing in switches which slot the page reads and writes. That is
 * the whole mechanism.
 *
 * What it is for: a laptop at the trailhead, or an iPad at home, that more
 * than one rider uses. Each of them gets their own history, their own FTP and
 * their own recommendation instead of everybody's rides landing in one pile.
 *
 * What it is not: a login that follows a rider to another device. Their rides
 * are on this one and nowhere else. It is not a security boundary either —
 * anybody who can open this browser's developer tools can read all of it. The
 * password stops a teammate wandering into your numbers on a shared machine,
 * and the page says as much where it asks for one.
 *
 * Passwords are still hashed rather than stored, because people reuse them and
 * that is not ours to be careless with.
 */
(function (root) {
  'use strict';

  const KEY = 'training-hub-riders';
  const LEGACY_DATA = 'training-hub-data';
  const dataKey = id => LEGACY_DATA + ':' + id;

  const TEAM_NAME = 'Vacaville Composite';
  const TEAM_CODE = 'DIRTDOGS';
  const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{1,23}$/;
  const PBKDF2_ROUNDS = 150000;

  /* ------------------------------------------------------------- storage */

  function read() {
    try {
      const raw = localStorage.getItem(KEY);
      const box = raw ? JSON.parse(raw) : null;
      if (!box || !Array.isArray(box.riders)) return { riders: [], current: null };
      return box;
    } catch (e) { return { riders: [], current: null }; }
  }

  function write(box) {
    try { localStorage.setItem(KEY, JSON.stringify(box)); return true; }
    catch (e) { return false; }
  }

  const all = () => read().riders;
  const find = name => all().find(r => r.username === String(name || '').trim().toLowerCase()) || null;
  const byId = id => all().find(r => r.id === id) || null;

  function current() {
    const box = read();
    return box.current ? (box.riders.find(r => r.id === box.current) || null) : null;
  }

  /* -------------------------------------------------------------- hashing */

  /**
   * PBKDF2 where the browser will do it, and an iterated SHA-256 where it will
   * not — a page opened from a file:// URL has no WebCrypto. Each account
   * records which was used, so a password is always checked the way it was
   * made.
   */
  const subtle = () => (typeof crypto !== 'undefined' && crypto.subtle) ? crypto.subtle : null;
  const algoNow = () => subtle() ? 'pbkdf2' : 'sha256x1000';

  function hex(bytes) {
    return Array.prototype.map.call(new Uint8Array(bytes),
      b => b.toString(16).padStart(2, '0')).join('');
  }

  function randomSalt() {
    const b = new Uint8Array(16);
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(b);
    else for (let i = 0; i < b.length; i++) b[i] = Math.floor(Math.random() * 256);
    return hex(b);
  }

  async function derive(password, salt, algo) {
    if (algo === 'pbkdf2' && subtle()) {
      const enc = new TextEncoder();
      const key = await subtle().importKey('raw', enc.encode(password), 'PBKDF2',
                                           false, ['deriveBits']);
      const bits = await subtle().deriveBits({
        name: 'PBKDF2', salt: enc.encode(salt),
        iterations: PBKDF2_ROUNDS, hash: 'SHA-256',
      }, key, 256);
      return hex(bits);
    }
    let out = salt + ' ' + password;
    for (let i = 0; i < 1000; i++) out = sha256(out + i);
    return out;
  }

  /* --------------------------------------------------------------- sha256 */
  /* FIPS 180-4, in the space it takes, so a page opened from a file on disk
   * can still check a password. Unused wherever WebCrypto exists. */

  const K = [];
  const H0 = [];
  (function tables() {
    const frac = x => Math.floor((x - Math.floor(x)) * 4294967296);
    let n = 2, i = 0;
    while (i < 64) {
      let prime = true;
      for (let d = 2; d * d <= n; d++) if (n % d === 0) { prime = false; break; }
      if (prime) {
        K[i] = frac(Math.cbrt(n));
        if (i < 8) H0[i] = frac(Math.sqrt(n));
        i++;
      }
      n++;
    }
  })();

  function sha256(str) {
    const rr = (x, n) => (x >>> n) | (x << (32 - n));
    const utf8 = unescape(encodeURIComponent(str));
    const bytes = [];
    for (let i = 0; i < utf8.length; i++) bytes.push(utf8.charCodeAt(i));
    const bitLen = utf8.length * 8;
    bytes.push(0x80);
    while (bytes.length % 64 !== 56) bytes.push(0);
    // 64 bits of length, big-endian. Nothing hashed here is long enough to
    // need the top four bytes.
    bytes.push(0, 0, 0, 0,
               (bitLen >>> 24) & 0xff, (bitLen >>> 16) & 0xff,
               (bitLen >>> 8) & 0xff, bitLen & 0xff);

    const H = H0.slice();
    const w = new Array(64);
    for (let off = 0; off < bytes.length; off += 64) {
      for (let i = 0; i < 16; i++) {
        w[i] = ((bytes[off + i * 4] << 24) | (bytes[off + i * 4 + 1] << 16) |
                (bytes[off + i * 4 + 2] << 8) | bytes[off + i * 4 + 3]) | 0;
      }
      for (let i = 16; i < 64; i++) {
        const s0 = rr(w[i - 15], 7) ^ rr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
        const s1 = rr(w[i - 2], 17) ^ rr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
      }
      let a = H[0], b = H[1], c = H[2], d = H[3];
      let e = H[4], f = H[5], g = H[6], h = H[7];
      for (let i = 0; i < 64; i++) {
        const S1 = rr(e, 6) ^ rr(e, 11) ^ rr(e, 25);
        const ch = (e & f) ^ (~e & g);
        const t1 = (h + S1 + ch + K[i] + w[i]) | 0;
        const S0 = rr(a, 2) ^ rr(a, 13) ^ rr(a, 22);
        const maj = (a & b) ^ (a & c) ^ (b & c);
        const t2 = (S0 + maj) | 0;
        h = g; g = f; f = e; e = (d + t1) | 0;
        d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      const round = [a, b, c, d, e, f, g, h];
      for (let i = 0; i < 8; i++) H[i] = (H[i] + round[i]) | 0;
    }
    return H.map(v => (v >>> 0).toString(16).padStart(8, '0')).join('');
  }

  /* -------------------------------------------------------------- accounts */

  /** What is wrong with this username, in plain words, or null. */
  function usernameProblem(name) {
    const n = String(name || '').trim().toLowerCase();
    if (!n) return 'Pick a username.';
    if (n.length < 2) return 'A username needs at least two characters.';
    if (n.length > 24) return 'That is too long — 24 characters at most.';
    if (!USERNAME_RE.test(n)) {
      return 'Letters and numbers only, plus . _ or -, starting with a letter or number.';
    }
    return null;
  }

  function newId() {
    return 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  /**
   * Make an account and sign into it.
   *
   * A history loaded before anybody made an account belongs to whoever was
   * standing there, so a new account adopts it rather than leaving a season of
   * riding orphaned in the old slot. Only the first account to be made finds
   * anything there, since claiming it empties it.
   */
  async function signUp(name, password, displayName) {
    const problem = usernameProblem(name);
    if (problem) throw new Error(problem);
    if (!password || password.length < 6) {
      throw new Error('Use a password of at least six characters.');
    }
    const username = String(name).trim().toLowerCase();
    if (find(username)) throw new Error('That username is taken on this device.');

    const salt = randomSalt();
    const algo = algoNow();
    const rider = {
      id: newId(), username: username,
      display: (displayName || '').trim() || username,
      salt: salt, algo: algo, hash: await derive(password, salt, algo),
      team: null, role: 'rider', created: new Date().toISOString(),
    };
    const box = read();
    box.riders.push(rider);
    box.current = rider.id;
    write(box);

    // Whoever makes an account inherits the rides that were loaded before
    // there were accounts — they are nobody's until somebody claims them, and
    // leaving a season stranded in the old slot to teach a lesson about
    // signing up first would be a poor trade.
    adoptLegacyData(rider.id);
    return rider;
  }

  async function signIn(name, password) {
    const rider = find(name);
    if (!rider) throw new Error('No account with that username on this device.');
    const got = await derive(password || '', rider.salt, rider.algo);
    if (got !== rider.hash) throw new Error('That password does not match.');
    const box = read();
    box.current = rider.id;
    write(box);
    return rider;
  }

  function signOut() {
    const box = read();
    box.current = null;
    write(box);
  }

  async function changePassword(name, oldPassword, newPassword) {
    const rider = await signIn(name, oldPassword);
    if (!newPassword || newPassword.length < 6) {
      throw new Error('Use a password of at least six characters.');
    }
    const salt = randomSalt();
    const algo = algoNow();
    return update(rider.id, { salt: salt, algo: algo,
                              hash: await derive(newPassword, salt, algo) });
  }

  function update(id, fields) {
    const box = read();
    const rider = box.riders.find(r => r.id === id);
    if (!rider) return null;
    Object.assign(rider, fields);
    write(box);
    return rider;
  }

  /** Remove an account and everything it holds. There is no undo and no copy
   *  anywhere else, which is said out loud wherever this is offered. */
  function remove(id) {
    const box = read();
    box.riders = box.riders.filter(r => r.id !== id);
    if (box.current === id) box.current = null;
    write(box);
    try { localStorage.removeItem(dataKey(id)); } catch (e) { /* already gone */ }
  }

  /* ------------------------------------------------------------ the team */

  function joinProblem(code) {
    return String(code || '').trim().toUpperCase() === TEAM_CODE
      ? null : 'That is not the join code.';
  }

  /** Join the team. The first rider on this device to join is its coach —
   *  some account has to be able to take a rider off the board. */
  function joinTeam(id, code) {
    const problem = joinProblem(code);
    if (problem) throw new Error(problem);
    const anyCoach = all().some(r => r.team === TEAM_NAME && r.role === 'coach');
    return update(id, { team: TEAM_NAME, role: anyCoach ? 'rider' : 'coach' });
  }

  function leaveTeam(id) { return update(id, { team: null, role: 'rider' }); }
  const teamRiders = () => all().filter(r => r.team === TEAM_NAME);
  const isCoach = rider => !!(rider && rider.team === TEAM_NAME && rider.role === 'coach');

  /* ----------------------------------------------------------- their data */

  function loadData(id) {
    try {
      const raw = localStorage.getItem(dataKey(id));
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function saveData(id, payload) {
    try { localStorage.setItem(dataKey(id), JSON.stringify(payload)); return true; }
    catch (e) { return false; }
  }

  function clearData(id) {
    try { localStorage.removeItem(dataKey(id)); } catch (e) { /* already gone */ }
  }

  /**
   * Rides loaded before there were accounts become the first account's.
   *
   * The profile goes with them. An FTP and a weight typed in before signing up
   * are the same rider's as the rides they were typed against, and leaving
   * them behind meant a rider watched their zones vanish at the moment they
   * made an account — which reads as the account having eaten them.
   */
  const LEGACY_PROFILE = 'training-hub-profile';
  const LEGACY_SETUP = 'training-hub-setup-done';

  function adoptLegacyData(id) {
    try {
      const raw = localStorage.getItem(LEGACY_DATA);
      if (!raw) return false;
      localStorage.setItem(dataKey(id), raw);
      localStorage.removeItem(LEGACY_DATA);
      [[LEGACY_PROFILE, LEGACY_PROFILE + ':' + id],
       [LEGACY_SETUP, LEGACY_SETUP + ':' + id]].forEach(([from, to]) => {
        const value = localStorage.getItem(from);
        if (value == null) return;
        localStorage.setItem(to, value);
        localStorage.removeItem(from);
      });
      return true;
    } catch (e) { return false; }
  }

  const api = { all, find, byId, current, signUp, signIn, signOut, changePassword,
                update, remove, usernameProblem,
                joinTeam, leaveTeam, joinProblem, teamRiders, isCoach,
                loadData, saveData, clearData, adoptLegacyData, dataKey,
                sha256, TEAM_NAME, TEAM_CODE };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Riders = api;
})(typeof self !== 'undefined' ? self : this);
