'use strict';
/* ============================================================
   ⭐ STUDENT NOTES API (2026-10-09)
   ------------------------------------------------------------
   GET    /api/notes                       my notebooks (metadata only)
   POST   /api/notes                       create  {title, cover, paper, paperColor, courseId, pageId}
   GET    /api/notes/:id                   one notebook + page list (no ink)
   PUT    /api/notes/:id                   rename / cover / paper / course / page order
   DELETE /api/notes/:id                   delete notebook and all its pages
   GET    /api/notes/:id/pages?ids=a,b     ink of up to 12 pages
   PUT    /api/notes/:id/pages/:pageId     save one page {data, paper, after}
   DELETE /api/notes/:id/pages/:pageId     delete one page

   Every route is scoped to the signed-in user — nobody can read or
   change someone else's notebook. Ink is saved page by page, so an
   autosave sends only the page that changed (a few KB), never the
   whole notebook.
   ============================================================ */

const LIMITS = {
  notebooks: 200,            // per user
  pages: 400,                // per notebook
  pageBytes: 1500000,        // one page of ink (~1.5 MB JSON)
  notebookBytes: 60000000,   // all pages of one notebook
  userBytes: 200000000,      // all notebooks of one user
  batch: 12                  // pages per GET
};
const COVERS = ['indigo', 'violet', 'rose', 'amber', 'emerald', 'teal', 'sky', 'slate', 'crimson', 'forest'];
const PAPERS = ['blank', 'lined', 'grid', 'dotted', 'eng', 'cornell'];
const PAPER_COLORS = ['white', 'cream', 'night'];
const PAGE_ID = /^[A-Za-z0-9_-]{6,32}$/;

function cleanText(v, max) {
  return String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}
function pick(v, list, dflt) { return list.includes(v) ? v : dflt; }

/* Light shape check — the server never interprets ink, but it refuses
   anything that is not a notes.js page so junk cannot be stored. */
function validPageData(data) {
  if (data === '') return true;
  if (typeof data !== 'string' || data.length > LIMITS.pageBytes) return false;
  if (data.charAt(0) !== '{') return false;
  try {
    const j = JSON.parse(data);
    if (!j || j.v !== 1) return false;
    if (j.s != null && !Array.isArray(j.s)) return false;
    if (j.t != null && !Array.isArray(j.t)) return false;
    if (j.b != null && !Array.isArray(j.b)) return false;   // pen tip table (notes.js 2026-10-10)
    return true;
  } catch (_) { return false; }
}

function serializeNotebook(nb) {
  return {
    id: String(nb._id), title: nb.title, cover: nb.cover, paper: nb.paper, paperColor: nb.paperColor,
    courseId: nb.courseId || null, pageCount: (nb.pages || []).length, bytes: nb.bytes || 0,
    createdAt: nb.createdAt, updatedAt: nb.updatedAt
  };
}

module.exports = function mountNotesApi(app, deps) {
  const { requireUser, rateLimit, mongoose, Notebook, NotePage, logger } = deps;
  const log = logger || console;
  const isId = (v) => mongoose.Types.ObjectId.isValid(String(v || ''));

  const notesLimiter = rateLimit({
    windowMs: 60 * 1000, max: 240,
    standardHeaders: true, legacyHeaders: false,
    keyGenerator: (req) => 'nt:' + (req.authUserId || req.ip),
    message: { success: false, message: 'Saving too often — please wait a moment.' }
  });
  const guard = [requireUser, notesLimiter];
  const noStore = (res) => res.setHeader('Cache-Control', 'no-store, private');
  const fail = (res, code, message) => res.status(code).json({ success: false, message });
  const uid = (req) => new mongoose.Types.ObjectId(String(req.authUserId));

  async function ownNotebook(req, res) {
    if (!isId(req.params.id)) { fail(res, 404, 'Notebook not found.'); return null; }
    const nb = await Notebook.findOne({ _id: req.params.id, userId: uid(req) });
    if (!nb) { fail(res, 404, 'Notebook not found.'); return null; }
    return nb;
  }

  /* ---- list ---- */
  app.get('/api/notes', guard, async (req, res) => {
    try {
      noStore(res);
      const list = await Notebook.find({ userId: uid(req) })
        .select('title cover paper paperColor courseId pages bytes createdAt updatedAt')
        .sort({ updatedAt: -1 }).limit(LIMITS.notebooks).lean();
      const used = list.reduce((n, nb) => n + (nb.bytes || 0), 0);
      res.json({ success: true, notebooks: list.map(serializeNotebook), usage: { bytes: used, limit: LIMITS.userBytes } });
    } catch (e) { log.error('[notes] list', e); fail(res, 500, 'Could not load your notebooks.'); }
  });

  /* ---- create ---- */
  app.post('/api/notes', guard, async (req, res) => {
    try {
      noStore(res);
      const b = req.body || {};
      const count = await Notebook.countDocuments({ userId: uid(req) });
      if (count >= LIMITS.notebooks) return fail(res, 400, `You can keep up to ${LIMITS.notebooks} notebooks. Delete an old one first.`);
      const firstPage = PAGE_ID.test(String(b.pageId || '')) ? String(b.pageId) : 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      const nb = await Notebook.create({
        userId: uid(req),
        title: cleanText(b.title, 120) || 'Untitled notebook',
        cover: pick(b.cover, COVERS, 'indigo'),
        paper: pick(b.paper, PAPERS, 'lined'),
        paperColor: pick(b.paperColor, PAPER_COLORS, 'white'),
        courseId: b.courseId && isId(b.courseId) ? String(b.courseId) : null,
        pages: [firstPage]
      });
      res.json({ success: true, notebook: serializeNotebook(nb), pages: [{ id: firstPage, rev: 0, bytes: 0, paper: '' }] });
    } catch (e) { log.error('[notes] create', e); fail(res, 500, 'Could not create the notebook.'); }
  });

  /* ---- open (metadata + page list, no ink) ---- */
  app.get('/api/notes/:id', guard, async (req, res) => {
    try {
      noStore(res);
      const nb = await ownNotebook(req, res); if (!nb) return;
      const pages = await NotePage.find({ notebookId: nb._id }).select('pageId rev bytes paper').lean();
      const byId = new Map(pages.map(p => [p.pageId, p]));
      res.json({
        success: true, notebook: serializeNotebook(nb),
        pages: (nb.pages || []).map(id => {
          const p = byId.get(id);
          return { id, rev: p ? p.rev : 0, bytes: p ? p.bytes : 0, paper: (p && p.paper) || '' };
        })
      });
    } catch (e) { log.error('[notes] open', e); fail(res, 500, 'Could not open the notebook.'); }
  });

  /* ---- update metadata / order ---- */
  app.put('/api/notes/:id', guard, async (req, res) => {
    try {
      noStore(res);
      const nb = await ownNotebook(req, res); if (!nb) return;
      const b = req.body || {};
      if (b.title !== undefined) nb.title = cleanText(b.title, 120) || 'Untitled notebook';
      if (b.cover !== undefined) nb.cover = pick(b.cover, COVERS, nb.cover);
      if (b.paper !== undefined) nb.paper = pick(b.paper, PAPERS, nb.paper);
      if (b.paperColor !== undefined) nb.paperColor = pick(b.paperColor, PAPER_COLORS, nb.paperColor);
      if (b.courseId !== undefined) nb.courseId = b.courseId && isId(b.courseId) ? String(b.courseId) : null;
      if (Array.isArray(b.order)) {
        /* a new order must contain exactly the same pages */
        const cur = new Set(nb.pages);
        const next = b.order.map(String);
        if (next.length !== cur.size || new Set(next).size !== next.length || next.some(id => !cur.has(id))) {
          return fail(res, 409, 'The page list changed on another device. Reload the notebook.');
        }
        nb.pages = next;
      }
      await nb.save();
      res.json({ success: true, notebook: serializeNotebook(nb) });
    } catch (e) { log.error('[notes] update', e); fail(res, 500, 'Could not update the notebook.'); }
  });

  /* ---- delete notebook ---- */
  app.delete('/api/notes/:id', guard, async (req, res) => {
    try {
      noStore(res);
      const nb = await ownNotebook(req, res); if (!nb) return;
      await NotePage.deleteMany({ notebookId: nb._id });
      await Notebook.deleteOne({ _id: nb._id });
      res.json({ success: true });
    } catch (e) { log.error('[notes] delete', e); fail(res, 500, 'Could not delete the notebook.'); }
  });

  /* ---- read pages (batched) ---- */
  app.get('/api/notes/:id/pages', guard, async (req, res) => {
    try {
      noStore(res);
      const nb = await ownNotebook(req, res); if (!nb) return;
      const ids = String(req.query.ids || '').split(',').map(s => s.trim()).filter(id => PAGE_ID.test(id)).slice(0, LIMITS.batch);
      if (!ids.length) return res.json({ success: true, pages: [] });
      const rows = await NotePage.find({ notebookId: nb._id, pageId: { $in: ids } }).select('pageId data rev paper').lean();
      const byId = new Map(rows.map(r => [r.pageId, r]));
      res.json({ success: true, pages: ids.filter(id => nb.pages.includes(id)).map(id => {
        const r = byId.get(id);
        return { id, data: r ? r.data : '', rev: r ? r.rev : 0, paper: (r && r.paper) || '' };
      }) });
    } catch (e) { log.error('[notes] pages', e); fail(res, 500, 'Could not load the pages.'); }
  });

  /* ---- save one page (creates it if new) ---- */
  app.put('/api/notes/:id/pages/:pageId', guard, async (req, res) => {
    try {
      noStore(res);
      const pageId = String(req.params.pageId || '');
      if (!PAGE_ID.test(pageId)) return fail(res, 400, 'Invalid page.');
      const b = req.body || {};
      const data = b.data == null ? '' : b.data;
      if (!validPageData(data)) {
        return fail(res, typeof data === 'string' && data.length > LIMITS.pageBytes ? 413 : 400,
          typeof data === 'string' && data.length > LIMITS.pageBytes ? 'This page is too full to save. Add a new page and continue there.' : 'Invalid page data.');
      }
      const nb = await ownNotebook(req, res); if (!nb) return;
      const isNew = !nb.pages.includes(pageId);
      if (isNew && nb.pages.length >= LIMITS.pages) return fail(res, 400, `A notebook can have up to ${LIMITS.pages} pages. Start a new notebook.`);

      const prev = await NotePage.findOne({ notebookId: nb._id, pageId }).select('bytes rev').lean();
      const bytes = data.length;
      const delta = bytes - (prev ? prev.bytes || 0 : 0);
      if (delta > 0 && (nb.bytes || 0) + delta > LIMITS.notebookBytes) return fail(res, 413, 'This notebook is full. Start a new notebook.');
      if (delta > 0) {
        const all = await Notebook.find({ userId: uid(req) }).select('bytes').lean();
        const used = all.reduce((n, x) => n + (x.bytes || 0), 0);
        if (used + delta > LIMITS.userBytes) return fail(res, 413, 'Your notes storage is full. Delete old notebooks to free space.');
      }

      const set = { data, bytes, userId: uid(req) };
      if (b.paper !== undefined) set.paper = b.paper ? pick(b.paper, PAPERS, '') : '';
      const saved = await NotePage.findOneAndUpdate(
        { notebookId: nb._id, pageId },
        { $set: set, $inc: { rev: 1 } },
        { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
      ).select('rev').lean();

      if (isNew) {
        const after = String(b.after || '');
        const at = nb.pages.indexOf(after);
        if (at >= 0) nb.pages.splice(at + 1, 0, pageId); else nb.pages.push(pageId);
      }
      nb.bytes = Math.max(0, (nb.bytes || 0) + delta);
      nb.markModified('pages');
      await nb.save();
      res.json({ success: true, rev: saved ? saved.rev : 1, notebook: serializeNotebook(nb) });
    } catch (e) { log.error('[notes] save page', e); fail(res, 500, 'Could not save the page.'); }
  });

  /* ---- delete one page ---- */
  app.delete('/api/notes/:id/pages/:pageId', guard, async (req, res) => {
    try {
      noStore(res);
      const nb = await ownNotebook(req, res); if (!nb) return;
      const pageId = String(req.params.pageId || '');
      if (!nb.pages.includes(pageId)) return res.json({ success: true, notebook: serializeNotebook(nb) });
      if (nb.pages.length <= 1) return fail(res, 400, 'A notebook needs at least one page.');
      const prev = await NotePage.findOneAndDelete({ notebookId: nb._id, pageId }).select('bytes').lean();
      nb.pages = nb.pages.filter(id => id !== pageId);
      nb.bytes = Math.max(0, (nb.bytes || 0) - ((prev && prev.bytes) || 0));
      await nb.save();
      res.json({ success: true, notebook: serializeNotebook(nb) });
    } catch (e) { log.error('[notes] delete page', e); fail(res, 500, 'Could not delete the page.'); }
  });

  /* when an account is deleted elsewhere, its notes can be removed with this */
  return { LIMITS, deleteUserNotes: async (userId) => {
    const nbs = await Notebook.find({ userId }).select('_id').lean();
    await NotePage.deleteMany({ notebookId: { $in: nbs.map(n => n._id) } });
    await Notebook.deleteMany({ userId });
  } };
};

module.exports.LIMITS = LIMITS;
module.exports.validPageData = validPageData;
