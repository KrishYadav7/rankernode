// Run: node scripts/test-security-helpers.js
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const src = fs.readFileSync(require('path').join(__dirname, '..', 'server.js'), 'utf8');
const grab = (a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i); if (i < 0 || j < 0) throw new Error(a); return src.slice(i, j); };
const ctx = { Buffer, Set, console };
vm.createContext(ctx);
vm.runInContext(grab('const _BAD_KEYS', 'app.use((req, res, next) => {\n  try {\n    if (req.body') + grab('function paymentAlreadyApplied', '/* ---- Verify (subscription mode) ---- */') + '\nthis.f={_scrubKeys,paymentAlreadyApplied};', ctx);
const { _scrubKeys, paymentAlreadyApplied } = ctx.f;
const body = JSON.parse('{"username":{"$ne":null},"password":"x","nested":{"a":[{"$gt":1,"ok":2}]},"__proto__":{"isAdmin":true},"q":"$x^2$"}');
_scrubKeys(body, 0);
assert.deepStrictEqual(JSON.parse(JSON.stringify(body)), { username: {}, password: 'x', nested: { a: [{ ok: 2 }] }, q: '$x^2$' });
assert.strictEqual(({}).isAdmin, undefined);
assert.strictEqual(paymentAlreadyApplied({ subscription: { history: [{ paymentId: 'p1', status: 'charged' }] } }, 'p1'), true);
assert.strictEqual(paymentAlreadyApplied({ subscription: { history: [{ paymentId: 'p1', status: 'refunded' }] } }, 'p1'), false);
assert.strictEqual(paymentAlreadyApplied({ subscription: { history: [] } }, 'p2'), false);
assert.strictEqual(paymentAlreadyApplied({}, 'p2'), false);
console.log('✅ sanitiser + payment idempotency: passed');
