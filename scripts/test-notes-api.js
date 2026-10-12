// Run: node scripts/test-notes-api.js — notes API with an in-memory fake database (no MongoDB needed)
const assert = require('assert');
const path = require('path');
const mount = require(path.join(__dirname, '..', 'notes-api.js'));

/* ---------- tiny fake mongoose ---------- */
let seq = 0;
const oid = () => (++seq).toString(16).padStart(24, '0');
class ObjectId { constructor(v) { this.v = String(v || oid()); } toString() { return this.v; } static isValid(v) { return /^[0-9a-f]{24}$/.test(String(v)); } }
const eq = (a, b) => String(a) === String(b);
function match(doc, q) {
  return Object.entries(q).every(([k, v]) => {
    if (v && typeof v === 'object' && !(v instanceof ObjectId) && v.$in) return v.$in.map(String).includes(String(doc[k]));
    return eq(doc[k], v);
  });
}
function chain(result) {
  const c = { select: () => c, sort: () => c, limit: () => c, lean: async () => JSON.parse(JSON.stringify(await result())) };
  c.then = (r, j) => Promise.resolve(result()).then(r, j);
  return c;
}
function model(defaults) {
  const rows = [];
  const wrap = (d) => { if (!d) return null; d.save = async () => { d.updatedAt = new Date(); return d; }; d.markModified = () => {}; return d; };
  return {
    rows,
    find: (q) => chain(() => rows.filter(r => match(r, q))),
    findOne: (q) => chain(() => wrap(rows.find(r => match(r, q)))),
    countDocuments: async (q) => rows.filter(r => match(r, q)).length,
    create: async (d) => { const r = wrap(Object.assign({ _id: new ObjectId() }, JSON.parse(JSON.stringify(defaults)), d, { createdAt: new Date(), updatedAt: new Date() })); rows.push(r); return r; },
    deleteMany: async (q) => { for (let i = rows.length - 1; i >= 0; i--) if (match(rows[i], q)) rows.splice(i, 1); },
    deleteOne: async (q) => { const i = rows.findIndex(r => match(r, q)); if (i >= 0) rows.splice(i, 1); },
    findOneAndDelete: (q) => chain(() => { const i = rows.findIndex(r => match(r, q)); return i >= 0 ? rows.splice(i, 1)[0] : null; }),
    findOneAndUpdate: (q, u) => chain(() => {
      let r = rows.find(x => match(x, q));
      if (!r) { r = Object.assign({ _id: new ObjectId() }, JSON.parse(JSON.stringify(defaults)), q); rows.push(r); }
      Object.assign(r, u.$set || {}); for (const [k, v] of Object.entries(u.$inc || {})) r[k] = (r[k] || 0) + v;
      return r;
    })
  };
}
const Notebook = model({ title: 'Untitled notebook', cover: 'indigo', paper: 'lined', paperColor: 'white', courseId: null, pages: [], bytes: 0 });
const NotePage = model({ paper: '', data: '', bytes: 0, rev: 0 });
const mongoose = { Types: { ObjectId } };

/* ---------- fake express ---------- */
const routes = [];
const app = {};
['get', 'post', 'put', 'delete'].forEach(m => { app[m] = (p, guard, h) => routes.push({ m, p, h }); });
const rateLimit = () => (req, res, next) => next();
let currentUser = 'a'.repeat(24);
const requireUser = (req, res, next) => { req.authUserId = currentUser; next(); };
mount(app, { requireUser, rateLimit, mongoose, Notebook, NotePage, logger: { error() {}, log() {} } });

function call(m, url, body) {
  const [p, qs] = url.split('?');
  for (const r of routes) {
    if (r.m !== m) continue;
    const names = [];
    const re = new RegExp('^' + r.p.replace(/:(\w+)/g, (_, n) => { names.push(n); return '([^/]+)'; }) + '$');
    const mm = re.exec(p); if (!mm) continue;
    const params = {}; names.forEach((n, i) => params[n] = decodeURIComponent(mm[i + 1]));
    const query = Object.fromEntries(new URLSearchParams(qs || ''));
    return new Promise(resolve => {
      const res = { code: 200, setHeader() {}, status(c) { this.code = c; return this; }, json(o) { resolve({ code: this.code, body: o }); } };
      r.h({ params, query, body: body || {}, authUserId: currentUser, ip: '1' }, res);
    });
  }
  throw new Error('no route ' + m + ' ' + url);
}
const page = (strokes) => JSON.stringify({ v: 1, s: strokes, t: [] });

(async () => {
  let r = await call('post', '/api/notes', { title: '  Aerodynamics  notes ', cover: 'rose', paper: 'grid', pageId: 'pg_first01' });
  assert.ok(r.body.success); const nb = r.body.notebook;
  assert.strictEqual(nb.title, 'Aerodynamics notes'); assert.strictEqual(nb.cover, 'rose'); assert.strictEqual(nb.pageCount, 1);

  r = await call('put', `/api/notes/${nb.id}/pages/pg_first01`, { data: page([[1, '#111', 6, 10, 10, 8, 2, 2, 0]]) });
  assert.ok(r.body.success); assert.strictEqual(r.body.rev, 1);
  r = await call('put', `/api/notes/${nb.id}/pages/pg_second2`, { data: page([]), after: 'pg_first01' });
  r = await call('put', `/api/notes/${nb.id}/pages/pg_third03`, { data: '', after: 'pg_first01' });
  r = await call('get', `/api/notes/${nb.id}`);
  assert.deepStrictEqual(r.body.pages.map(p => p.id), ['pg_first01', 'pg_third03', 'pg_second2'], 'inserted after the right page');

  r = await call('get', `/api/notes/${nb.id}/pages?ids=pg_first01,pg_second2,../bad,pg_nope000`);
  assert.strictEqual(r.body.pages.length, 2); assert.ok(r.body.pages[0].data.includes('#111'));

  // reorder: must be a permutation
  r = await call('put', `/api/notes/${nb.id}`, { order: ['pg_second2', 'pg_first01'] });
  assert.strictEqual(r.code, 409);
  r = await call('put', `/api/notes/${nb.id}`, { order: ['pg_second2', 'pg_first01', 'pg_third03'], title: 'Aero I', paperColor: 'night', cover: 'hacker' });
  assert.ok(r.body.success); assert.strictEqual(r.body.notebook.title, 'Aero I'); assert.strictEqual(r.body.notebook.cover, 'rose', 'unknown cover ignored');
  r = await call('put', `/api/notes/${nb.id}`, { paper: 'eng' }); assert.strictEqual(r.body.notebook.paper, 'eng', 'engineering paper accepted');
  r = await call('put', `/api/notes/${nb.id}`, { paper: 'music' }); assert.strictEqual(r.body.notebook.paper, 'eng', 'unknown paper ignored');
  r = await call('put', `/api/notes/${nb.id}/pages/pg_first01`, { data: page([[3, '#123456', 6, 0, 0, 0, 100, 0, 1]]), paper: 'cornell' }); assert.ok(r.body.success, 'shape stroke + cornell page accepted');

  // bad data refused
  r = await call('put', `/api/notes/${nb.id}/pages/pg_first01`, { data: '<script>alert(1)</script>' }); assert.strictEqual(r.code, 400);
  r = await call('put', `/api/notes/${nb.id}/pages/pg_first01`, { data: '{"v":2}' }); assert.strictEqual(r.code, 400);
  r = await call('put', `/api/notes/${nb.id}/pages/${'x'.repeat(40)}`, { data: '' }); assert.strictEqual(r.code, 400);
  r = await call('put', `/api/notes/${nb.id}/pages/pg_first01`, { data: '{"v":1,"s":[],"pad":"' + 'x'.repeat(1600000) + '"}' }); assert.strictEqual(r.code, 413);

  // bytes bookkeeping
  r = await call('get', '/api/notes'); assert.ok(r.body.notebooks[0].bytes > 0);

  // another user cannot see / change it
  currentUser = 'b'.repeat(24);
  r = await call('get', `/api/notes/${nb.id}`); assert.strictEqual(r.code, 404);
  r = await call('put', `/api/notes/${nb.id}/pages/pg_first01`, { data: page([]) }); assert.strictEqual(r.code, 404);
  r = await call('delete', `/api/notes/${nb.id}`); assert.strictEqual(r.code, 404);
  r = await call('get', '/api/notes'); assert.strictEqual(r.body.notebooks.length, 0);
  currentUser = 'a'.repeat(24);

  // delete pages: never the last one
  r = await call('delete', `/api/notes/${nb.id}/pages/pg_third03`); assert.ok(r.body.success);
  r = await call('delete', `/api/notes/${nb.id}/pages/pg_second2`); assert.ok(r.body.success);
  r = await call('delete', `/api/notes/${nb.id}/pages/pg_first01`); assert.strictEqual(r.code, 400);
  assert.strictEqual(NotePage.rows.length, 1);

  // delete notebook removes its pages
  r = await call('delete', `/api/notes/${nb.id}`); assert.ok(r.body.success);
  assert.strictEqual(Notebook.rows.length, 0); assert.strictEqual(NotePage.rows.length, 0);
  console.log('✅ notes API: all checks passed');
})().catch(e => { console.error('❌', e); process.exit(1); });
