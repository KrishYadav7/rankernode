// Run: node scripts/test-auth-core.js   (no DB or npm packages needed — pure logic test)
// Unit tests for the new auth core, extracted verbatim from server.js and run in a VM.
const fs = require('fs'), vm = require('vm'), crypto = require('crypto'), assert = require('assert');
const src = fs.readFileSync(require('path').join(__dirname, '..', 'server.js'), 'utf8');
function grab(startMarker, endMarker) {
  const a = src.indexOf(startMarker); const b = src.indexOf(endMarker, a);
  if (a < 0 || b < 0) throw new Error('marker not found: ' + startMarker);
  return src.slice(a, b);
}
const code = [
  grab('async function requireAdminAuth(req, res, next) {', '/* ============================================================\n   AUTH — optional token attach'),
  grab('const AUTH_USER_CACHE_TTL_MS', '/* ============================================================\n   PREMIUM ACCESS — single source of truth'),
].join('\n');

// --- minimal HS256 jwt shim ---
const b64u = b => Buffer.from(b).toString('base64url');
const jwt = {
  sign(p, secret) { const h = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' })); const pl = b64u(JSON.stringify(p)); const sig = crypto.createHmac('sha256', secret).update(h + '.' + pl).digest('base64url'); return `${h}.${pl}.${sig}`; },
  verify(t, secret, opts) { assert.deepStrictEqual(opts, { algorithms: ['HS256'] }); const [h, pl, sig] = String(t).split('.'); const exp = crypto.createHmac('sha256', secret).update(h + '.' + pl).digest('base64url'); if (sig !== exp) throw new Error('bad sig'); return JSON.parse(Buffer.from(pl, 'base64url').toString()); }
};
const users = {};
let dbDown = false;
const User = { findById(id) { return { select() { return { lean: async () => { if (dbDown) throw new Error('db'); return users[id] ? JSON.parse(JSON.stringify(users[id])) : null; } }; } }; } };
const mongoose = { Types: { ObjectId: { isValid: v => /^[0-9a-f]{24}$/.test(v) } } };
const ctx = { jwt, User, mongoose, JWT_SECRET: 's'.repeat(40), JWT_VERIFY_OPTS: { algorithms: ['HS256'] }, console: { warn() {}, log() {} }, Date, Map, String, Number, Promise };
vm.createContext(ctx);
vm.runInContext(code + '\nthis.api = { requireAdminAuth, requireUser, requireSelfOrAdmin, attachUserFromToken, _clearAuthUserCache, resolveSessionUser };', ctx);
const { requireAdminAuth, requireUser, requireSelfOrAdmin, attachUserFromToken, _clearAuthUserCache } = ctx.api;

const A = 'a'.repeat(24), S = 'b'.repeat(24), S2 = 'c'.repeat(24);
users[A] = { _id: A, role: 'admin', username: 'admin', activeSession: { sessionId: 'sa' } };
users[S] = { _id: S, role: 'student', username: 'stu', activeSession: { sessionId: 's1' } };
users[S2] = { _id: S2, role: 'student', username: 'stu2', activeSession: { sessionId: 's2' }, suspended: { active: true } };
const tok = (id, sid) => jwt.sign({ id, role: 'x', sessionId: sid }, ctx.JWT_SECRET);

function run(mw, req) {
  return new Promise(resolve => {
    const res = { code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; resolve({ next: false, res: this, req }); return this; } };
    req.headers = req.headers || {}; req.query = req.query || {}; req.params = req.params || {};
    Promise.resolve(mw(req, res, () => resolve({ next: true, res, req })));
  });
}
const bearer = t => ({ authorization: 'Bearer ' + t });
(async () => {
  let r;
  r = await run(requireUser, {}); assert.strictEqual(r.res.code, 401); assert.strictEqual(r.res.body.code, 'NO_TOKEN');
  r = await run(requireUser, { headers: bearer('garbage') }); assert.strictEqual(r.res.body.code, 'INVALID_TOKEN');
  r = await run(requireUser, { headers: bearer(tok(S, 's1')) }); assert.ok(r.next); assert.strictEqual(r.req.authUserId, S);
  // forged with wrong secret
  r = await run(requireUser, { headers: bearer(jwt.sign({ id: A, sessionId: 'sa' }, 'SuperSecretAeroKey')) }); assert.strictEqual(r.res.body.code, 'INVALID_TOKEN');
  // pending 2FA token (no id) must not authenticate
  r = await run(requireUser, { headers: bearer(jwt.sign({ pendingId: 'x' }, ctx.JWT_SECRET)) }); assert.strictEqual(r.res.body.code, 'INVALID_TOKEN');
  // session replaced
  r = await run(requireUser, { headers: bearer(tok(S, 'old')) }); assert.strictEqual(r.res.body.code, 'SESSION_REPLACED');
  // logout → sessionId null → ended (after cache clear)
  users[S].activeSession.sessionId = null; _clearAuthUserCache();
  r = await run(requireUser, { headers: bearer(tok(S, 's1')) }); assert.strictEqual(r.res.body.code, 'SESSION_ENDED');
  users[S].activeSession.sessionId = 's1'; _clearAuthUserCache();
  // suspended
  r = await run(requireUser, { headers: bearer(tok(S2, 's2')) }); assert.strictEqual(r.res.body.code, 'SUSPENDED');
  // db down → 503, not cached
  _clearAuthUserCache(); dbDown = true;
  r = await run(requireUser, { headers: bearer(tok(S, 's1')) }); assert.strictEqual(r.res.code, 503);
  dbDown = false;
  r = await run(requireUser, { headers: bearer(tok(S, 's1')) }); assert.ok(r.next, 'recovers after db hiccup');
  // query param ?auth=
  r = await run(requireUser, { query: { auth: tok(S, 's1') } }); assert.ok(r.next);
  // ?token= only for admin route
  r = await run(requireUser, { query: { token: tok(S, 's1') } }); assert.strictEqual(r.res.body.code, 'NO_TOKEN');
  // admin
  r = await run(requireAdminAuth, { headers: bearer(tok(S, 's1')) }); assert.strictEqual(r.res.code, 403);
  r = await run(requireAdminAuth, { query: { token: tok(A, 'sa') } }); assert.ok(r.next); assert.strictEqual(String(r.req.adminUser._id), A);
  r = await run(requireAdminAuth, { headers: bearer(tok(A, 'stale')) }); assert.strictEqual(r.res.code, 401);
  // self-or-admin
  const self = requireSelfOrAdmin('params'), body = requireSelfOrAdmin('body');
  r = await run(requireUser, { headers: bearer(tok(S, 's1')), params: { userId: A } });
  r = await run(self, r.req); assert.strictEqual(r.res.code, 403, 'student cannot read another user');
  r = await run(requireUser, { headers: bearer(tok(S, 's1')), params: { userId: S } }); r = await run(self, r.req); assert.ok(r.next);
  r = await run(requireUser, { headers: bearer(tok(A, 'sa')), params: { userId: S } }); r = await run(self, r.req); assert.ok(r.next, 'admin may read any');
  r = await run(requireUser, { headers: bearer(tok(S, 's1')), body: {} }); r = await run(body, r.req); assert.ok(r.next); assert.strictEqual(r.req.body.userId, S, 'fills userId from token');
  r = await run(requireUser, { headers: bearer(tok(S, 's1')), body: { userId: A } }); r = await run(body, r.req); assert.strictEqual(r.res.code, 403);
  // optional attach
  r = await run(attachUserFromToken, { headers: bearer(tok(S, 'old')) }); assert.ok(r.next); assert.strictEqual(r.req.authUser, undefined);
  r = await run(attachUserFromToken, { headers: bearer(tok(S, 's1')) }); assert.ok(r.next); assert.strictEqual(String(r.req.authUser._id), S);
  console.log('✅ auth core: all 24 assertions passed');
})().catch(e => { console.error('❌', e); process.exit(1); });
