// Run: node scripts/test-login-tabs.js — each account signs in only from its own login tab (no DB needed)
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const src = fs.readFileSync(require('path').join(__dirname, '..', 'server.js'), 'utf8');
const a = src.indexOf("app.post('/api/login', async (req, res) => {");
const b = src.indexOf('/* ============================================================\n   ADMIN 2FA — step 2 of 2');
let handler;
const users = {
  stu:  { _id: 's1', username: 'stu', role: 'student', password: 'pw', email: 's@x', referralCode: 'R1' },
  prof: { _id: 'p1', username: 'prof', role: 'professor', password: 'pw', email: 'p@x', professor: { status: 'approved' } },
  pend: { _id: 'p2', username: 'pend', role: 'professor', password: 'pw', email: 'q@x', professor: { status: 'pending' } },
  leg:  { _id: 'l1', username: 'leg', role: 'user', password: 'pw', email: 'l@x', referralCode: 'R2' },
  adm:  { _id: 'a1', username: 'adm', role: 'admin', password: 'pw', email: 'a@x' },
};
const ctx = {
  app: { post: (p, fn) => { handler = fn; } },
  User: { findOne: async (q) => { const u = users[typeof q.username === 'string' ? q.username : '']; return u ? Object.assign({ save: async () => {} }, u) : null; },
          updateOne: async () => ({ matchedCount: 1 }), findById: () => ({ select: () => ({ lean: async () => ({}) }) }) },
  bcrypt: { compare: async (p, h) => p === h },
  crypto: require('crypto'), jwt: { sign: () => 'tok' }, JWT_SECRET: 'x',
  adminLoginStore: new Map(), transporter: { sendMail: async () => ({}) }, withTimeout: (p) => p,
  _loginOtpMail: () => ({}), maskEmail: (e) => e, ensureReferralCode: async () => {}, bumpStreak: () => {},
  serializeUser: (u) => ({ username: u.username, role: u.role }), _clearAuthUserCache: () => {},
  process: { env: { NODE_ENV: 'production' } }, console: { log() {}, warn() {}, error() {} }, Date, String, setTimeout: () => 0, Object, Math, Number, Boolean
};
vm.createContext(ctx);
vm.runInContext(src.slice(a, b), ctx);
const call = (username, role) => new Promise(resolve => {
  const res = { code: 200, status(c) { this.code = c; return this; }, json(o) { resolve({ code: this.code, body: o }); } };
  handler({ body: { username, password: 'pw', role }, ip: '1', headers: {} }, res);
});
(async () => {
  const rows = [];
  for (const u of ['stu', 'prof', 'adm']) for (const tab of ['student', 'professor', 'admin']) {
    const r = await call(u, tab);
    const ok = r.body.success === true;
    rows.push(`${u.padEnd(5)} on ${tab.padEnd(9)} → ${ok ? (r.body.requires2FA ? 'OK (OTP sent)' : 'OK (logged in)') : r.code + ' ' + r.body.code}`);
    const own = { stu: 'student', prof: 'professor', adm: 'admin' }[u] === tab;
    assert.strictEqual(ok, own, `${u} on ${tab}`);
    if (!own) assert.strictEqual(r.body.code, 'WRONG_LOGIN_TAB');
  }
  let r = await call('pend', 'professor'); assert.strictEqual(r.body.code, 'PROFESSOR_PENDING'); rows.push('pending prof on professor → ' + r.body.code);
  r = await call('pend', 'student'); assert.strictEqual(r.body.code, 'WRONG_LOGIN_TAB');
  r = await call('leg', 'student'); assert.strictEqual(r.body.success, true); rows.push('legacy role "user" on student → OK');
  r = await call('leg', 'admin'); assert.strictEqual(r.body.code, 'WRONG_LOGIN_TAB');
  r = await call('stu', undefined); assert.strictEqual(r.body.success, true); rows.push('student, no tab sent → OK (defaults to Student)');
  r = await call('adm', undefined); assert.strictEqual(r.body.code, 'WRONG_LOGIN_TAB');
  r = await (async () => { users.stu.password = 'other'; const x = await call('stu', 'admin'); users.stu.password = 'pw'; return x; })();
  assert.strictEqual(r.code, 400); rows.push('wrong password on wrong tab → 400 Invalid username or password (account type not revealed)');
  console.log(rows.join('\n')); console.log('✅ strict login tabs: all passed');
})().catch(e => { console.error('❌', e); process.exit(1); });
