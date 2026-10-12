// Run: node scripts/test-admin-sessions.js   (no DB or npm packages needed — pure logic test)
// Admin multi-device sessions (max 3) + professor/student single-device rules.
// The code under test is extracted verbatim from server.js and run in a VM.
const fs = require('fs'), vm = require('vm'), crypto = require('crypto'), assert = require('assert');
const src = fs.readFileSync(require('path').join(__dirname, '..', 'server.js'), 'utf8');
function grab(startMarker, endMarker) {
  const a = src.indexOf(startMarker); const b = src.indexOf(endMarker, a);
  if (a < 0 || b < 0) throw new Error('marker not found: ' + startMarker);
  return src.slice(a, b);
}
const code = grab('const ADMIN_MAX_SESSIONS', '/* Optional auth');

/* tiny in-memory User model: findById().select().lean() + updateOne({_id}, {$set}) */
const users = {};
const clone = (o) => JSON.parse(JSON.stringify(o));
const User = {
  findById(id) { return { select() { return { lean: async () => (users[id] ? clone(users[id]) : null) }; } }; },
  async updateOne(filter, upd) {
    const u = users[filter._id]; if (!u) return { matchedCount: 0 };
    Object.assign(u, clone(upd.$set || {})); return { matchedCount: 1 };
  }
};
let cacheCleared = 0;
const ctx = { User, crypto, process: { env: {} }, console, Date, String, Math, Object, Array, parseInt,
              _clearAuthUserCache() { cacheCleared++; } };
vm.createContext(ctx);
vm.runInContext(code.replace(/^async function resolveSessionUser[\s\S]*$/m, '') +
  '\nthis.api = { ADMIN_MAX_SESSIONS, _sessionVerdict, _createLoginSession, _validSessionIds, _shortDevice };', ctx);
const { ADMIN_MAX_SESSIONS, _sessionVerdict, _createLoginSession, _shortDevice } = ctx.api;
const req = (ua) => ({ headers: { 'user-agent': ua || 'Mozilla/5.0 (Windows NT 10.0) Chrome/120.0' }, ip: '1.2.3.4' });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  assert.strictEqual(ADMIN_MAX_SESSIONS, 3);

  /* ---- admin: 3 devices at once, 4th signs out the least recently used ---- */
  users.A = { _id: 'A', role: 'admin', activeSession: { sessionId: null }, sessions: [] };
  const d1 = await _createLoginSession(users.A, req()); await sleep(5);
  const d2 = await _createLoginSession(users.A, req()); await sleep(5);
  const d3 = await _createLoginSession(users.A, req()); await sleep(5);
  assert.strictEqual(users.A.sessions.length, 3);
  for (const d of [d1, d2, d3]) assert.strictEqual(_sessionVerdict(users.A, d.sessionId), null, 'all 3 devices valid');
  assert.strictEqual(d3.evicted, 0);

  // device 1 is used recently → device 2 becomes the least recently used one
  users.A.sessions.find(s => s.sessionId === d1.sessionId).lastSeenAt = new Date(Date.now() + 1000).toISOString();
  const d4 = await _createLoginSession(users.A, req()); await sleep(5);
  assert.strictEqual(d4.evicted, 1);
  assert.strictEqual(users.A.sessions.length, 3);
  assert.strictEqual(_sessionVerdict(users.A, d2.sessionId).code, 'SESSION_REPLACED', 'LRU device is signed out');
  for (const d of [d1, d3, d4]) assert.strictEqual(_sessionVerdict(users.A, d.sessionId), null);
  assert.strictEqual(users.A.activeSession.sessionId, d4.sessionId, 'activeSession mirrors newest');

  /* ---- pre-upgrade admin token stored only in activeSession keeps working & counts ---- */
  users.B = { _id: 'B', role: 'admin', activeSession: { sessionId: 'legacy', loginAt: new Date().toISOString(), lastSeenAt: new Date().toISOString() } };
  assert.strictEqual(_sessionVerdict(users.B, 'legacy'), null, 'legacy admin token still valid after deploy');
  await _createLoginSession(users.B, req());
  assert.strictEqual(_sessionVerdict(users.B, 'legacy'), null, 'legacy device kept as one of the 3');
  assert.strictEqual(users.B.sessions.length, 2);

  /* ---- expired (>24 h) sessions do not count toward the limit ---- */
  const old = new Date(Date.now() - 25 * 3600 * 1000).toISOString();
  users.C = { _id: 'C', role: 'admin', activeSession: {}, sessions: [1, 2, 3].map(i => ({ sessionId: 'old' + i, loginAt: old, lastSeenAt: old })) };
  const c1 = await _createLoginSession(users.C, req());
  assert.strictEqual(c1.evicted, 0); assert.strictEqual(users.C.sessions.length, 1);

  /* ---- professor & student: single device; sessions[] ignored ---- */
  users.P = { _id: 'P', role: 'professor', activeSession: {}, sessions: [{ sessionId: 'sneaky' }] };
  const p1 = await _createLoginSession(users.P, req());
  const p2 = await _createLoginSession(users.P, req());
  assert.strictEqual(_sessionVerdict(users.P, p1.sessionId).code, 'SESSION_REPLACED', 'professor: one device only');
  assert.strictEqual(_sessionVerdict(users.P, p2.sessionId), null);
  assert.strictEqual(_sessionVerdict(users.P, 'sneaky').code, 'SESSION_REPLACED', 'non-admin sessions[] never accepted');
  users.S = { _id: 'S', role: 'student', activeSession: { sessionId: null } };
  assert.strictEqual(_sessionVerdict(users.S, 'x').code, 'SESSION_ENDED');

  assert.ok(/Chrome on Windows/.test(_shortDevice('Mozilla/5.0 (Windows NT 10.0) AppleWebKit Chrome/120.0 Safari/537')));
  assert.ok(/Safari on iOS/.test(_shortDevice('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Version/17.0 Mobile Safari/604.1')));
  assert.ok(cacheCleared > 0, 'auth cache cleared on every login');
  console.log('✅ admin sessions: all checks passed');
})().catch(e => { console.error('❌', e); process.exit(1); });
