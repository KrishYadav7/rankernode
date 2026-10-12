'use strict';
/* ============================================================
   ⭐ LEARNING API (2026-10-11)
   ------------------------------------------------------------
   Student
   GET  /api/learn/summary              streak, today's challenge, mistakes, assignments due
   GET  /api/learn/mistakes             wrong / skipped questions from published results
   POST /api/learn/mistakes/check       {materialId, qi, answer} → right? (mastered when right)
   POST /api/learn/explain              {materialId, qi, answer} | {bankId, answer} → AI explanation
   GET  /api/learn/daily                today's 5-question challenge
   POST /api/learn/daily/answer         {index, answer}
   GET  /api/learn/performance          per test: %, rank, percentile; per topic / difficulty
   GET  /api/learn/assignments          assignments in my courses with status
   GET  /api/learn/series               test series with my progress + rank
   GET  /api/learn/report-card.pdf      ?userId= (self, admin, or the professor of the courses)

   Instructor (admin, or a professor — scoped to their courses)
   GET/POST        /api/qbank           list (filters) / add
   PUT/DELETE      /api/qbank/:id
   POST            /api/qbank/import    {items:[…]}
   POST            /api/qbank/pick      {count, topics, mix:{easy,medium,hard}, types, courseId}
   GET             /api/qbank/topics
   GET/POST        /api/admin/series
   PUT/DELETE      /api/admin/series/:id
   ============================================================ */

const crypto = require('crypto');

const AUTO_TYPES = ['single', 'multiple', 'integer', 'numerical', 'matrix'];
const ALL_TYPES = [...AUTO_TYPES, 'subjective'];
const DIFFS = ['easy', 'medium', 'hard'];

function clean(v, max) {
  return String(v == null ? '' : v).replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, max);
}
const num = (v) => (v === null || v === undefined || v === '' || !isFinite(Number(v))) ? null : Number(v);

/* Is this answer right? Same rules as the exam grader. */
function isCorrect(q, ans) {
  const t = q.type || 'single';
  if (t === 'single') {
    const chosen = Array.isArray(ans) ? ans[0] : ans;
    const key = (q.correctIndexes && q.correctIndexes[0] != null) ? q.correctIndexes[0] : (typeof q.correctIndex === 'number' ? q.correctIndex : 0);
    return chosen !== null && chosen !== undefined && chosen !== '' && Number(chosen) === Number(key);
  }
  if (t === 'multiple') {
    const a = (Array.isArray(ans) ? ans : []).map(Number).sort();
    const e = (q.correctIndexes || []).map(Number).sort();
    return a.length > 0 && a.length === e.length && a.every((v, k) => v === e[k]);
  }
  if (t === 'integer') {
    const a = num(ans), e = num(q.integerAnswer);
    return a !== null && e !== null && Math.abs(a - e) <= (Number(q.integerTolerance) || 0);
  }
  if (t === 'numerical') {
    const a = num(ans), lo = num(q.rangeMin), hi = num(q.rangeMax);
    return a !== null && lo !== null && hi !== null && a >= lo && a <= hi;
  }
  if (t === 'matrix') {
    const a = Array.isArray(ans) ? ans : [];
    const rows = q.matrixRows || [];
    return rows.length > 0 && rows.every((r, i) => a[i] !== null && a[i] !== undefined && a[i] !== '' && Number(a[i]) === Number(r.correctIndex));
  }
  return false;
}

/* question for a student who must not see the key yet */
function publicQ(q) {
  return {
    type: q.type || 'single', question: q.question || '', options: q.options || [],
    matrixLeftItems: q.matrixLeftItems || [], matrixRightItems: q.matrixRightItems || [],
    rows: (q.matrixRows || []).length, topic: q.topic || '', difficulty: q.difficulty || '',
    marks: typeof q.marks === 'number' ? q.marks : 4
  };
}
/* …and with the key (after answering / published results) */
function keyedQ(q) {
  return Object.assign(publicQ(q), {
    correctIndexes: q.correctIndexes || (typeof q.correctIndex === 'number' ? [q.correctIndex] : []),
    integerAnswer: q.integerAnswer, integerTolerance: q.integerTolerance || 0,
    rangeMin: q.rangeMin, rangeMax: q.rangeMax,
    matrixRows: (q.matrixRows || []).map(r => ({ correctIndex: r.correctIndex })),
    explanation: q.explanation || ''
  });
}
function keyText(q) {
  const t = q.type || 'single';
  if (t === 'single' || t === 'multiple') return (q.correctIndexes || []).map(i => `${String.fromCharCode(65 + Number(i))}) ${(q.options || [])[i] || ''}`).join('; ');
  if (t === 'integer') return String(q.integerAnswer) + (q.integerTolerance ? ` (± ${q.integerTolerance})` : '');
  if (t === 'numerical') return `any value from ${q.rangeMin} to ${q.rangeMax}`;
  if (t === 'matrix') return (q.matrixLeftItems || []).map((l, i) => `${l} → ${(q.matrixRightItems || [])[((q.matrixRows || [])[i] || {}).correctIndex] || '?'}`).join('; ');
  return '';
}
function answerText(q, a) {
  const t = q.type || 'single';
  if (a === null || a === undefined || a === '' || (Array.isArray(a) && !a.filter(x => x !== null && x !== undefined && x !== '').length)) return '(no answer)';
  if (t === 'single' || t === 'multiple') return (Array.isArray(a) ? a : [a]).map(i => `${String.fromCharCode(65 + Number(i))}) ${(q.options || [])[i] || ''}`).join('; ');
  if (t === 'matrix') return (q.matrixLeftItems || []).map((l, i) => `${l} → ${a[i] === null || a[i] === undefined ? '?' : (q.matrixRightItems || [])[a[i]] || '?'}`).join('; ');
  return String(a);
}

/* may the student see the result (and therefore the key) of this test? */
function resultVisible(r, cfg) {
  if (!r || !r.attempts) return false;
  const mode = (cfg && cfg.resultPublishMode) || 'immediate';
  if (mode === 'immediate' || r.publishedAt) return true;
  if (mode === 'scheduled') {
    const abs = cfg.resultPublishAt ? new Date(cfg.resultPublishAt).getTime() : null;
    const rel = !abs && Number(cfg.resultPublishDelayHours) > 0 && r.lastAttemptAt ? new Date(r.lastAttemptAt).getTime() + Number(cfg.resultPublishDelayHours) * 3600e3 : null;
    const at = abs || rel;
    return !!(at && Date.now() >= at);
  }
  return false;
}
function finalOf(r) {
  const e = (Number(r.marksEarned) || 0) + (Number(r.subjectiveMarksAwarded) || 0);
  const p = (Number(r.marksPossible) || 0) + (Number(r.subjectiveMaxTotal) || 0);
  return { earned: Math.round(e * 100) / 100, possible: p, pct: p > 0 ? Math.round(e / p * 1000) / 10 : 0 };
}
function seededShuffle(arr, seed) {
  const a = arr.slice();
  let h = crypto.createHash('sha256').update(String(seed)).digest();
  let k = 0;
  const rnd = () => { if (k + 4 > h.length) { h = crypto.createHash('sha256').update(h).digest(); k = 0; } const v = h.readUInt32BE(k); k += 4; return v / 4294967296; };
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
function sanitizeQuestion(b) {
  const type = ALL_TYPES.includes(b.type) ? b.type : 'single';
  const q = {
    type, question: clean(b.question, 8000), explanation: clean(b.explanation, 6000),
    topic: clean(b.topic, 80), difficulty: DIFFS.includes(b.difficulty) ? b.difficulty : '',
    marks: Math.max(0, Math.min(100, num(b.marks) === null ? 4 : num(b.marks))),
    negativeMarks: Math.max(-100, Math.min(0, num(b.negativeMarks) === null ? -1 : num(b.negativeMarks)))
  };
  if (type === 'single' || type === 'multiple') {
    q.options = (Array.isArray(b.options) ? b.options : []).map(o => clean(o, 2000)).filter(Boolean).slice(0, 10);
    q.correctIndexes = [...new Set((Array.isArray(b.correctIndexes) ? b.correctIndexes : []).map(Number).filter(i => Number.isInteger(i) && i >= 0 && i < q.options.length))];
    if (type === 'single') q.correctIndexes = q.correctIndexes.slice(0, 1);
  }
  if (type === 'integer') { q.integerAnswer = num(b.integerAnswer); q.integerTolerance = Math.abs(num(b.integerTolerance) || 0); }
  if (type === 'numerical') { q.rangeMin = num(b.rangeMin); q.rangeMax = num(b.rangeMax); }
  if (type === 'matrix') {
    q.matrixLeftItems = (b.matrixLeftItems || []).map(x => clean(x, 500)).filter(Boolean).slice(0, 10);
    q.matrixRightItems = (b.matrixRightItems || []).map(x => clean(x, 500)).filter(Boolean).slice(0, 10);
    q.matrixRows = q.matrixLeftItems.map((t, i) => {
      const ci = Number(((b.matrixRows || [])[i] || {}).correctIndex);
      return { text: t, correctIndex: Number.isInteger(ci) && ci >= 0 && ci < q.matrixRightItems.length ? ci : 0 };
    });
  }
  if (type === 'subjective') {
    q.subjectiveMaxMarks = Math.max(1, Math.min(100, num(b.subjectiveMaxMarks) || 10));
    q.subjectiveInstructions = clean(b.subjectiveInstructions, 1000);
    q.marks = q.subjectiveMaxMarks; q.negativeMarks = 0;
  }
  return q;
}
function validQuestion(q) {
  if (!q.question) return 'Question text is required.';
  if (q.type === 'single' || q.type === 'multiple') {
    if (q.options.length < 2) return 'At least 2 options are required.';
    if (!q.correctIndexes.length) return 'Choose the correct option.';
  }
  if (q.type === 'integer' && q.integerAnswer === null) return 'The integer answer is required.';
  if (q.type === 'numerical' && (q.rangeMin === null || q.rangeMax === null || q.rangeMin > q.rangeMax)) return 'A valid answer range is required.';
  if (q.type === 'matrix' && (q.matrixLeftItems.length < 2 || q.matrixRightItems.length < 2)) return 'Matrix needs at least 2 items on each side.';
  return '';
}

/* PDF text: the standard fonts only cover Latin-1 */
function pdfSafe(s) {
  return String(s == null ? '' : s)
    .replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/…/g, '...')
    .replace(/₹/g, 'Rs.').replace(/[^\x20-\x7e\xa0-\xff]/g, '');
}

module.exports = function mountLearningApi(app, deps) {
  const { requireUser, requireGrader, rateLimit, mongoose, Course, User, QBankItem, TestSeries,
          evaluateMaterialAccess, istDateKey, awardXP, getAI, pickModel } = deps;
  const log = deps.logger || console;
  const isId = (v) => mongoose.Types.ObjectId.isValid(String(v || '')) && /^[a-f0-9]{24}$/i.test(String(v));
  const noStore = (res) => res.setHeader('Cache-Control', 'no-store, private');
  const isStudentish = (u) => !['admin', 'professor'].includes(String(u.role || '').toLowerCase());
  const editorStamp = (u) => ({ id: String(u._id), name: u.fullName || u.username || '', role: String(u.role || '') });

  const aiLimiter = rateLimit({ windowMs: 10 * 60 * 1000, max: 25, standardHeaders: true, legacyHeaders: false,
    keyGenerator: (req) => 'learn-ai:' + String(req.authUserId || req.ip),
    message: { success: false, code: 'RATE_LIMITED', message: 'Too many explanations in a short time — try again in a few minutes.' } });
  const writeLimiter = rateLimit({ windowMs: 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false,
    keyGenerator: (req) => 'learn-w:' + String(req.authUserId || req.ip),
    message: { success: false, code: 'RATE_LIMITED', message: 'Slow down a little.' } });

  /* ---------- shared loaders ---------- */
  async function loadUser(id, extra) {
    return User.findById(id).select('username fullName email role quizResults learning xp level notifications ' + (extra || '')).lean();
  }
  /* all courses (lean, only what we need) — cached 30 s */
  let _cc = { at: 0, list: null };
  async function allCourses() {
    if (_cc.list && Date.now() - _cc.at < 30000) return _cc.list;
    const list = await Course.find({}).select('name code title isPremium price materials').lean();
    _cc = { at: Date.now(), list };
    return list;
  }
  function findMat(courses, mid) {
    for (const c of courses) for (const m of (c.materials || [])) if (String(m._id) === String(mid)) return { course: c, mat: m };
    return null;
  }
  function canAccess(user, course, mat) {
    try { return !!evaluateMaterialAccess(user, course, mat).allowed; } catch (_) { return false; }
  }
  /* materials of a few tests → every student's stored result (for ranks) */
  async function resultsFor(mids) {
    if (!mids.length) return {};
    const or = mids.map(id => ({ [`quizResults.${id}`]: { $exists: true } }));
    const sel = mids.map(id => `quizResults.${id}`).join(' ') + ' username fullName';
    const users = await User.find({ $or: or }).select(sel).lean();
    const out = {};
    mids.forEach(id => { out[id] = []; });
    users.forEach(u => mids.forEach(id => {
      const r = (u.quizResults || {})[id];
      if (r && r.attempts) out[id].push({ userId: String(u._id), name: u.fullName || u.username, pct: finalOf(r).pct });
    }));
    return out;
  }
  function rankOf(list, userId) {
    const sorted = list.slice().sort((a, b) => b.pct - a.pct);
    const me = sorted.find(x => x.userId === String(userId));
    if (!me) return { rank: null, of: sorted.length, percentile: null };
    const rank = sorted.findIndex(x => x.pct <= me.pct) + 1;
    const below = sorted.filter(x => x.pct < me.pct).length;
    const percentile = sorted.length > 1 ? Math.round(below / (sorted.length - 1) * 1000) / 10 : 100;
    return { rank, of: sorted.length, percentile };
  }

  /* the student's published tests with answer details */
  function myGradedTests(user, courses) {
    const out = [];
    for (const [mid, r] of Object.entries(user.quizResults || {})) {
      const hit = findMat(courses, mid);
      if (!hit || !r || !r.attempts) continue;
      const cfg = hit.mat.examConfig || {};
      if (!resultVisible(r, cfg)) continue;
      out.push({ mid, r, course: hit.course, mat: hit.mat, cfg });
    }
    return out;
  }
  const mastered = (user) => new Set(((user.learning || {}).mastered || []).map(String));

  function mistakeList(user, courses) {
    const done = mastered(user);
    const items = [];
    for (const t of myGradedTests(user, courses)) {
      const quiz = t.mat.quiz || [];
      const resp = Array.isArray(t.r.responses) ? t.r.responses : null;
      if (!resp || resp.length !== quiz.length) continue;          // paper changed since — answers no longer line up
      resp.forEach((x, qi) => {
        const q = quiz[qi];
        if (!q || q.type === 'subjective' || !x || x.c) return;
        if (done.has(`${t.mid}:${qi}`)) return;
        items.push({
          key: `${t.mid}:${qi}`, materialId: t.mid, qi, courseId: String(t.course._id),
          courseName: t.course.name || t.course.title || 'Course', courseCode: t.course.code || '',
          testTitle: t.mat.title || 'Test', at: t.r.lastAttemptAt || null,
          status: x.at ? 'wrong' : 'skipped', yourAnswer: x.a === undefined ? null : x.a,
          q: keyedQ(q)
        });
      });
    }
    items.sort((a, b) => new Date(b.at || 0) - new Date(a.at || 0));
    return items;
  }

  /* ============================ SUMMARY ============================ */
  app.get('/api/learn/summary', requireUser, async (req, res) => {
    try {
      noStore(res);
      const user = await loadUser(req.authUserId);
      if (!user) return res.status(404).json({ success: false, message: 'User not found.' });
      const courses = await allCourses();
      const L = user.learning || {};
      const today = istDateKey();
      const daily = L.daily && L.daily.date === today ? L.daily : null;
      const dailyDone = !!(daily && daily.items && daily.items.length && Object.keys(daily.answers || {}).length >= daily.items.length);
      const streak = L.streak || {};
      const yesterday = istDateKey(new Date(Date.now() - 86400e3));
      const alive = streak.last === today || streak.last === yesterday;
      let due = 0;
      for (const c of courses) for (const m of (c.materials || [])) {
        const cfg = m.examConfig || {};
        if (cfg.kind !== 'assignment' || !(m.quiz || []).length) continue;
        if (!canAccess(user, c, m)) continue;
        const r = (user.quizResults || {})[String(m._id)];
        if (r && r.attempts) continue;
        if (cfg.dueAt && Date.now() > new Date(cfg.dueAt).getTime() && cfg.allowLate === false) continue;
        due++;
      }
      res.json({
        success: true,
        streak: { count: alive ? Number(streak.count) || 0 : 0, best: Number(streak.best) || 0, doneToday: streak.last === today },
        dailyDone, mistakes: mistakeList(user, courses).length, assignmentsDue: due
      });
    } catch (e) { log.error('[learn/summary]', e); res.status(500).json({ success: false, message: e.message }); }
  });

  /* ============================ MISTAKES ============================ */
  app.get('/api/learn/mistakes', requireUser, async (req, res) => {
    try {
      noStore(res);
      const user = await loadUser(req.authUserId);
      if (!user) return res.status(404).json({ success: false, message: 'User not found.' });
      const items = mistakeList(user, await allCourses());
      res.json({ success: true, items: items.slice(0, 300), total: items.length, masteredCount: mastered(user).size });
    } catch (e) { log.error('[learn/mistakes]', e); res.status(500).json({ success: false, message: e.message }); }
  });

  async function questionForStudent(user, materialId, qi) {
    if (!isId(materialId)) return { error: 'Invalid question.' };
    const courses = await allCourses();
    const hit = findMat(courses, materialId);
    if (!hit) return { error: 'Test not found.' };
    const r = (user.quizResults || {})[String(materialId)];
    if (!resultVisible(r, hit.mat.examConfig || {})) return { error: 'This result is not published yet.' };
    const q = (hit.mat.quiz || [])[Number(qi)];
    if (!q || q.type === 'subjective') return { error: 'Question not found.' };
    return { q, hit, r };
  }

  app.post('/api/learn/mistakes/check', requireUser, writeLimiter, async (req, res) => {
    try {
      const { materialId, qi, answer } = req.body || {};
      const user = await loadUser(req.authUserId);
      const got = await questionForStudent(user, materialId, qi);
      if (got.error) return res.status(400).json({ success: false, message: got.error });
      const correct = isCorrect(got.q, answer);
      if (correct) {
        await User.updateOne({ _id: user._id }, { $addToSet: { 'learning.mastered': `${materialId}:${Number(qi)}` } });
      }
      res.json({ success: true, correct, q: keyedQ(got.q) });
    } catch (e) { log.error('[learn/check]', e); res.status(500).json({ success: false, message: e.message }); }
  });

  /* ============================ AI EXPLAIN ============================ */
  const _explainCache = new Map();          // hash → { text, model, at }
  app.post('/api/learn/explain', requireUser, aiLimiter, async (req, res) => {
    try {
      const { materialId, qi, bankId, answer } = req.body || {};
      const user = await loadUser(req.authUserId);
      let q = null;
      if (bankId) {
        if (!isId(bankId)) return res.status(400).json({ success: false, message: 'Invalid question.' });
        /* only a bank question the student already answered today */
        const daily = (user.learning || {}).daily || {};
        const idx = (daily.items || []).findIndex(it => it.src === 'bank' && it.id === String(bankId));
        if (idx < 0 || !(daily.answers || {})[idx]) return res.status(403).json({ success: false, message: 'Answer the question first.' });
        q = await QBankItem.findById(bankId).lean();
      } else if (materialId !== undefined) {
        const got = await questionForStudent(user, materialId, qi);
        if (got.error) {
          /* also allowed: a test question from today's challenge, after answering */
          const daily = (user.learning || {}).daily || {};
          const idx = (daily.items || []).findIndex(it => it.src === 'quiz' && it.mid === String(materialId) && Number(it.qi) === Number(qi));
          if (idx < 0 || !(daily.answers || {})[idx]) return res.status(400).json({ success: false, message: got.error });
          const hit = findMat(await allCourses(), materialId);
          q = hit && (hit.mat.quiz || [])[Number(qi)];
        } else q = got.q;
      }
      if (!q) return res.status(404).json({ success: false, message: 'Question not found.' });
      const ai = getAI();
      if (!ai || !ai.configured()) return res.status(503).json({ success: false, message: 'AI is not available right now.' });

      const opts = (q.type === 'single' || q.type === 'multiple') ? '\nOptions:\n' + (q.options || []).map((o, i) => `${String.fromCharCode(65 + i)}) ${o}`).join('\n') : '';
      const matrix = q.type === 'matrix' ? `\nList I: ${(q.matrixLeftItems || []).join(' | ')}\nList II: ${(q.matrixRightItems || []).join(' | ')}` : '';
      const mine = answerText(q, answer);
      const prompt =
        `Question (${q.type}):\n${q.question}${opts}${matrix}\n\n` +
        `Correct answer: ${keyText(q)}\n` +
        `Student's answer: ${mine}\n` +
        (q.explanation ? `Instructor's note: ${q.explanation}\n` : '') +
        `\nExplain step by step how to reach the correct answer. ` +
        (mine === '(no answer)' ? 'The student skipped it — start from the key idea.' : `Then say briefly what mistake leads to "${mine}" and how to avoid it.`) +
        ' End with one short tip to remember.';
      const hash = crypto.createHash('sha256').update(prompt).digest('hex');
      const hitC = _explainCache.get(hash);
      if (hitC && Date.now() - hitC.at < 24 * 3600e3) return res.json({ success: true, explanation: hitC.text, model: hitC.model, cached: true });

      const catalog = await ai.getCatalog();
      const plan = ai.buildChain(catalog, pickModel ? pickModel((req.body || {}).model) : 'auto', {});
      if (!plan.chain.length) return res.status(503).json({ success: false, message: 'AI is not available right now.' });
      let text = '';
      const result = await ai.run({
        chain: plan.chain,
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        system: 'You are a patient tutor for students preparing for JEE Main, JEE Advanced, NEET and Class 11–12 boards (Physics, Chemistry, Mathematics, Biology). Be correct and concise (under 300 words unless a derivation needs more). ' +
                'Use Markdown and LaTeX ($...$ inline, $$...$$ display). Never contradict the given correct answer.',
        temperature: 0.4, maxTokens: 4096, onDelta: (t) => { text += t; }
      });
      if (!result.used || !text.trim()) {
        const f = ai.failureMessage(result, plan.chain);
        return res.status(503).json({ success: false, message: f.message });
      }
      _explainCache.set(hash, { text: text.trim(), model: result.used.label, at: Date.now() });
      if (_explainCache.size > 2000) _explainCache.delete(_explainCache.keys().next().value);
      res.json({ success: true, explanation: text.trim(), model: result.used.label });
    } catch (e) { log.error('[learn/explain]', e); res.status(500).json({ success: false, message: e.message }); }
  });

  /* ============================ DAILY CHALLENGE ============================ */
  const DAILY_SIZE = 5;
  async function buildDailyPool(user, courses) {
    const pool = [];
    const accessibleCourseIds = new Set();
    for (const c of courses) {
      if ((c.materials || []).some(m => canAccess(user, c, m))) accessibleCourseIds.add(String(c._id));
    }
    const bank = await QBankItem.find({ practice: true, type: { $in: AUTO_TYPES } }).select('_id courseId').lean();
    bank.forEach(b => { if (!b.courseId || accessibleCourseIds.has(String(b.courseId))) pool.push({ src: 'bank', id: String(b._id) }); });
    /* questions from tests the student already finished (published) — never from a test still to take */
    for (const t of myGradedTests(user, courses)) {
      (t.mat.quiz || []).forEach((q, qi) => { if (AUTO_TYPES.includes(q.type || 'single')) pool.push({ src: 'quiz', mid: t.mid, qi }); });
    }
    return pool;
  }
  async function resolveItem(it, courses, bankCache) {
    if (it.src === 'bank') {
      const b = bankCache.get(it.id) || await QBankItem.findById(it.id).lean();
      if (b) bankCache.set(it.id, b);
      return b ? { q: b, source: b.topic ? `Practice · ${b.topic}` : 'Practice question' } : null;
    }
    const hit = findMat(courses, it.mid);
    const q = hit && (hit.mat.quiz || [])[Number(it.qi)];
    return q ? { q, source: `${hit.mat.title || 'Test'} · Q${Number(it.qi) + 1}` } : null;
  }
  async function dailyFor(user) {
    const today = istDateKey();
    const L = user.learning || {};
    if (L.daily && L.daily.date === today && Array.isArray(L.daily.items)) return L.daily;
    const courses = await allCourses();
    const pool = await buildDailyPool(user, courses);
    /* prefer questions the student got wrong before */
    const wrong = new Set(mistakeList(user, courses).map(m => `quiz:${m.materialId}:${m.qi}`));
    const shuffled = seededShuffle(pool, `${user._id}:${today}`);
    shuffled.sort((a, b) => (wrong.has(`quiz:${b.mid}:${b.qi}`) ? 1 : 0) - (wrong.has(`quiz:${a.mid}:${a.qi}`) ? 1 : 0));
    const daily = { date: today, items: shuffled.slice(0, DAILY_SIZE), answers: {} };
    await User.updateOne({ _id: user._id }, { $set: { 'learning.daily': daily } });
    return daily;
  }

  app.get('/api/learn/daily', requireUser, async (req, res) => {
    try {
      noStore(res);
      const user = await loadUser(req.authUserId);
      if (!user) return res.status(404).json({ success: false, message: 'User not found.' });
      const daily = await dailyFor(user);
      const courses = await allCourses();
      const bankCache = new Map();
      const items = [];
      for (let i = 0; i < daily.items.length; i++) {
        const got = await resolveItem(daily.items[i], courses, bankCache);
        if (!got) continue;
        const ans = (daily.answers || {})[i];
        items.push({
          index: i, source: got.source, src: daily.items[i].src,
          ref: daily.items[i].src === 'bank' ? { bankId: daily.items[i].id } : { materialId: daily.items[i].mid, qi: daily.items[i].qi },
          q: ans ? keyedQ(got.q) : publicQ(got.q),
          answered: !!ans, answer: ans ? ans.a : null, correct: ans ? !!ans.c : null
        });
      }
      const L = user.learning || {};
      res.json({ success: true, date: daily.date, items, streak: L.streak || {}, empty: items.length === 0 });
    } catch (e) { log.error('[learn/daily]', e); res.status(500).json({ success: false, message: e.message }); }
  });

  app.post('/api/learn/daily/answer', requireUser, writeLimiter, async (req, res) => {
    try {
      const { index, answer } = req.body || {};
      const i = Number(index);
      const userDoc = await User.findById(req.authUserId);
      if (!userDoc) return res.status(404).json({ success: false, message: 'User not found.' });
      const L = userDoc.learning || {};
      const daily = L.daily;
      if (!daily || daily.date !== istDateKey() || !Array.isArray(daily.items) || !daily.items[i]) {
        return res.status(409).json({ success: false, code: 'STALE', message: 'A new challenge is ready — reload it.' });
      }
      if ((daily.answers || {})[i]) return res.status(409).json({ success: false, message: 'Already answered.' });
      const got = await resolveItem(daily.items[i], await allCourses(), new Map());
      if (!got) return res.status(404).json({ success: false, message: 'Question no longer exists.' });
      const correct = isCorrect(got.q, answer);
      daily.answers = daily.answers || {};
      daily.answers[i] = { a: answer === undefined ? null : answer, c: correct, at: new Date() };

      let finished = false, xpResult = null;
      const streak = L.streak || { count: 0, best: 0, last: '' };
      if (Object.keys(daily.answers).length >= daily.items.length) {
        finished = true;
        const today = istDateKey(), yesterday = istDateKey(new Date(Date.now() - 86400e3));
        if (streak.last !== today) {
          streak.count = streak.last === yesterday ? (Number(streak.count) || 0) + 1 : 1;
          streak.best = Math.max(Number(streak.best) || 0, streak.count);
          streak.last = today;
        }
        const right = Object.values(daily.answers).filter(a => a.c).length;
        xpResult = awardXP(userDoc, right * 5 + 10, 'daily-challenge');
      }
      if (!correct && daily.items[i].src === 'quiz') { /* nothing to do — it stays in My Mistakes */ }
      userDoc.learning = Object.assign({}, L, { daily, streak });
      userDoc.markModified('learning');
      await userDoc.save();
      res.json({ success: true, correct, q: keyedQ(got.q), finished, streak, xpResult });
    } catch (e) { log.error('[learn/daily/answer]', e); res.status(500).json({ success: false, message: e.message }); }
  });

  /* ============================ PERFORMANCE ============================ */
  async function performanceOf(user, scopeCourses) {
    const courses = await allCourses();
    let tests = myGradedTests(user, courses);
    if (scopeCourses) tests = tests.filter(t => scopeCourses.has(String(t.course._id)));
    const ranks = await resultsFor(tests.map(t => t.mid));
    const topic = new Map(), diff = new Map(), type = new Map();
    const bump = (m, k, ok) => { if (!k) return; const v = m.get(k) || { right: 0, total: 0 }; v.total++; if (ok) v.right++; m.set(k, v); };
    const rows = tests.map(t => {
      const f = finalOf(t.r);
      const rk = rankOf(ranks[t.mid] || [], user._id);
      const all = (ranks[t.mid] || []).map(x => x.pct);
      const resp = Array.isArray(t.r.responses) && t.r.responses.length === (t.mat.quiz || []).length ? t.r.responses : null;
      if (resp) resp.forEach((x, qi) => {
        const q = (t.mat.quiz || [])[qi];
        if (!q || q.type === 'subjective') return;
        bump(topic, (q.topic || '').trim(), x.c);
        bump(diff, q.difficulty || '', x.c);
        bump(type, q.type || 'single', x.c);
      });
      return {
        materialId: t.mid, courseId: String(t.course._id), courseName: t.course.name || t.course.title || 'Course', courseCode: t.course.code || '',
        title: t.mat.title || 'Test', kind: (t.cfg.kind === 'assignment') ? 'assignment' : 'test',
        at: t.r.lastAttemptAt || null, earned: f.earned, possible: f.possible, pct: f.pct,
        rank: rk.rank, of: rk.of, percentile: rk.percentile,
        classAvg: all.length ? Math.round(all.reduce((a, b) => a + b, 0) / all.length * 10) / 10 : 0,
        pending: Object.keys(t.r.subjectiveQuestionMeta || {}).length > Object.keys(t.r.subjectiveEvaluations || {}).length,
        late: !!t.r.late
      };
    }).sort((a, b) => new Date(a.at || 0) - new Date(b.at || 0));
    const toList = (m) => [...m.entries()].map(([k, v]) => ({ name: k, right: v.right, total: v.total, pct: Math.round(v.right / v.total * 100) }));
    const topics = toList(topic).sort((a, b) => a.pct - b.pct);
    const pcts = rows.map(r => r.pct);
    return {
      tests: rows,
      topics, difficulty: toList(diff), types: toList(type),
      weakTopics: topics.filter(t => t.total >= 2 && t.pct < 60).slice(0, 3),
      strongTopics: topics.filter(t => t.total >= 2 && t.pct >= 75).slice(-3).reverse(),
      summary: {
        tests: rows.length,
        avgPct: pcts.length ? Math.round(pcts.reduce((a, b) => a + b, 0) / pcts.length * 10) / 10 : 0,
        bestPct: pcts.length ? Math.max(...pcts) : 0,
        avgPercentile: rows.filter(r => r.percentile !== null).length
          ? Math.round(rows.filter(r => r.percentile !== null).reduce((a, r) => a + r.percentile, 0) / rows.filter(r => r.percentile !== null).length) : null
      }
    };
  }
  app.get('/api/learn/performance', requireUser, async (req, res) => {
    try {
      noStore(res);
      const user = await loadUser(req.authUserId);
      if (!user) return res.status(404).json({ success: false, message: 'User not found.' });
      res.json(Object.assign({ success: true }, await performanceOf(user, null)));
    } catch (e) { log.error('[learn/performance]', e); res.status(500).json({ success: false, message: e.message }); }
  });

  /* ============================ ASSIGNMENTS ============================ */
  app.get('/api/learn/assignments', requireUser, async (req, res) => {
    try {
      noStore(res);
      const user = await loadUser(req.authUserId);
      const courses = await allCourses();
      const items = [];
      for (const c of courses) for (const m of (c.materials || [])) {
        const cfg = m.examConfig || {};
        if (cfg.kind !== 'assignment' || !(m.quiz || []).length) continue;
        if (!canAccess(user, c, m)) continue;
        const r = (user.quizResults || {})[String(m._id)];
        const due = cfg.dueAt ? new Date(cfg.dueAt).getTime() : null;
        const done = !!(r && r.attempts);
        const visible = done && resultVisible(r, cfg);
        let status = done ? (r.late ? 'late' : 'submitted') : (due && Date.now() > due ? (cfg.allowLate === false ? 'closed' : 'overdue') : 'open');
        const pending = done && Object.keys(r.subjectiveQuestionMeta || {}).length > Object.keys(r.subjectiveEvaluations || {}).length;
        if (done && visible && !pending) status = 'graded';
        items.push({
          courseId: String(c._id), courseName: c.name || c.title || 'Course', courseCode: c.code || '',
          materialId: String(m._id), title: m.title || 'Assignment', description: m.description || '',
          dueAt: cfg.dueAt || null, allowLate: cfg.allowLate !== false, questions: (m.quiz || []).length,
          status, submittedAt: done ? r.lastAttemptAt : null,
          score: visible ? finalOf(r) : null, pending
        });
      }
      const order = { overdue: 0, open: 1, late: 2, submitted: 3, graded: 4, closed: 5 };
      items.sort((a, b) => (order[a.status] - order[b.status]) || ((a.dueAt ? new Date(a.dueAt) : Infinity) - (b.dueAt ? new Date(b.dueAt) : Infinity)));
      res.json({ success: true, items });
    } catch (e) { log.error('[learn/assignments]', e); res.status(500).json({ success: false, message: e.message }); }
  });

  /* ============================ TEST SERIES ============================ */
  async function seriesView(series, user, courses) {
    const tests = (series.tests || []).map(t => {
      const hit = findMat(courses, t.materialId);
      return hit ? { courseId: String(hit.course._id), materialId: String(hit.mat._id), title: hit.mat.title || 'Test',
                     courseName: hit.course.name || hit.course.title || 'Course', courseCode: hit.course.code || '',
                     questions: (hit.mat.quiz || []).length, course: hit.course, mat: hit.mat } : null;
    }).filter(Boolean);
    const ranks = await resultsFor(tests.map(t => t.materialId));
    /* combined score per participant = average % over the series' tests (missing = 0) */
    const people = new Map();
    tests.forEach(t => (ranks[t.materialId] || []).forEach(x => {
      const p = people.get(x.userId) || { userId: x.userId, name: x.name, sum: 0, done: 0 };
      p.sum += x.pct; p.done++; people.set(x.userId, p);
    }));
    const board = [...people.values()].map(p => ({ userId: p.userId, name: p.name, done: p.done, pct: Math.round(p.sum / Math.max(1, tests.length) * 10) / 10 }))
      .sort((a, b) => b.pct - a.pct);
    const me = user ? board.find(b => b.userId === String(user._id)) : null;
    const myTests = tests.map(t => {
      const r = user && (user.quizResults || {})[t.materialId];
      const vis = r && resultVisible(r, t.mat.examConfig || {});
      return { courseId: t.courseId, materialId: t.materialId, title: t.title, courseName: t.courseName, courseCode: t.courseCode, questions: t.questions,
               done: !!(r && r.attempts), pct: vis ? finalOf(r).pct : null, locked: user ? !canAccess(user, t.course, t.mat) : false };
    });
    const nameOf = (n) => { const parts = String(n || 'Student').trim().split(/\s+/); return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0]}.` : parts[0]; };
    return {
      id: String(series._id), title: series.title, description: series.description || '', published: series.published !== false,
      tests: myTests, participants: board.length,
      my: me ? { pct: me.pct, done: me.done, rank: board.findIndex(b => b.pct <= me.pct) + 1 } : null,
      top: board.slice(0, 10).map((b, i) => ({ rank: i + 1, name: nameOf(b.name), pct: b.pct, done: b.done, me: user ? b.userId === String(user._id) : false }))
    };
  }
  app.get('/api/learn/series', requireUser, async (req, res) => {
    try {
      noStore(res);
      const user = await loadUser(req.authUserId);
      const courses = await allCourses();
      const list = await TestSeries.find({ published: true }).sort({ createdAt: -1 }).lean();
      const out = [];
      for (const s of list) {
        const v = await seriesView(s, user, courses);
        if (v.tests.length && v.tests.some(t => !t.locked)) out.push(v);
      }
      res.json({ success: true, series: out });
    } catch (e) { log.error('[learn/series]', e); res.status(500).json({ success: false, message: e.message }); }
  });

  /* admin / professor: manage series */
  function seriesScopeOk(req, tests) {
    if (!req.graderScope) return true;
    return tests.every(t => req.graderScope.has(String(t.courseId)));
  }
  function cleanSeriesBody(b, courses) {
    const tests = (Array.isArray(b.tests) ? b.tests : []).slice(0, 50).map(t => {
      const hit = findMat(courses, t && t.materialId);
      return hit ? { courseId: String(hit.course._id), materialId: String(hit.mat._id) } : null;
    }).filter(Boolean);
    return { title: clean(b.title, 120), description: clean(b.description, 600), tests, published: b.published !== false };
  }
  app.get('/api/admin/series', requireGrader, async (req, res) => {
    try {
      noStore(res);
      const courses = await allCourses();
      const list = await TestSeries.find({}).sort({ createdAt: -1 }).lean();
      const out = [];
      for (const s of list) {
        if (!seriesScopeOk(req, s.tests || [])) continue;
        out.push(await seriesView(s, null, courses));
      }
      res.json({ success: true, series: out });
    } catch (e) { log.error('[series/list]', e); res.status(500).json({ success: false, message: e.message }); }
  });
  app.post('/api/admin/series', requireGrader, async (req, res) => {
    try {
      const body = cleanSeriesBody(req.body || {}, await allCourses());
      if (!body.title) return res.status(400).json({ success: false, message: 'Give the series a name.' });
      if (body.tests.length < 2) return res.status(400).json({ success: false, message: 'Pick at least 2 tests.' });
      if (!seriesScopeOk(req, body.tests)) return res.status(403).json({ success: false, message: 'You can only use tests from your own courses.' });
      const s = await TestSeries.create(Object.assign(body, { createdBy: editorStamp(req.authUser) }));
      res.json({ success: true, id: String(s._id) });
    } catch (e) { log.error('[series/create]', e); res.status(500).json({ success: false, message: e.message }); }
  });
  app.put('/api/admin/series/:id', requireGrader, async (req, res) => {
    try {
      if (!isId(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid id.' });
      const cur = await TestSeries.findById(req.params.id).lean();
      if (!cur || !seriesScopeOk(req, cur.tests || [])) return res.status(404).json({ success: false, message: 'Series not found.' });
      const body = cleanSeriesBody(req.body || {}, await allCourses());
      if (!body.title || body.tests.length < 2) return res.status(400).json({ success: false, message: 'A name and at least 2 tests are needed.' });
      if (!seriesScopeOk(req, body.tests)) return res.status(403).json({ success: false, message: 'You can only use tests from your own courses.' });
      await TestSeries.updateOne({ _id: cur._id }, { $set: body });
      res.json({ success: true });
    } catch (e) { log.error('[series/update]', e); res.status(500).json({ success: false, message: e.message }); }
  });
  app.delete('/api/admin/series/:id', requireGrader, async (req, res) => {
    try {
      if (!isId(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid id.' });
      const cur = await TestSeries.findById(req.params.id).lean();
      if (!cur || !seriesScopeOk(req, cur.tests || [])) return res.status(404).json({ success: false, message: 'Series not found.' });
      await TestSeries.deleteOne({ _id: cur._id });
      res.json({ success: true });
    } catch (e) { log.error('[series/delete]', e); res.status(500).json({ success: false, message: e.message }); }
  });

  /* ============================ QUESTION BANK ============================ */
  function bankQueryFor(req) {
    if (!req.graderScope) return {};
    return { $or: [{ courseId: '' }, { courseId: { $in: [...req.graderScope] } }, { 'createdBy.id': String(req.authUser._id) }] };
  }
  function canEditItem(req, item) {
    if (!req.graderScope) return true;
    return (item.createdBy && item.createdBy.id === String(req.authUser._id)) || (item.courseId && req.graderScope.has(String(item.courseId)));
  }
  function bankCourseOk(req, courseId) {
    if (!courseId) return true;
    if (!isId(courseId)) return false;
    return !req.graderScope || req.graderScope.has(String(courseId));
  }

  app.get('/api/qbank', requireGrader, async (req, res) => {
    try {
      noStore(res);
      const q = req.query || {};
      const filter = Object.assign({}, bankQueryFor(req));
      const and = [];
      if (q.topic) and.push({ topic: clean(q.topic, 80) });
      if (DIFFS.includes(q.difficulty)) and.push({ difficulty: q.difficulty });
      if (ALL_TYPES.includes(q.type)) and.push({ type: q.type });
      if (q.courseId === 'none') and.push({ courseId: '' });
      else if (q.courseId && isId(q.courseId)) and.push({ courseId: String(q.courseId) });
      if (q.q) {
        const rx = new RegExp(clean(q.q, 80).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
        and.push({ $or: [{ question: rx }, { topic: rx }] });
      }
      if (and.length) filter.$and = and;
      const page = Math.max(1, parseInt(q.page, 10) || 1), per = 30;
      const [items, total] = await Promise.all([
        QBankItem.find(filter).sort({ updatedAt: -1 }).skip((page - 1) * per).limit(per).lean(),
        QBankItem.countDocuments(filter)
      ]);
      res.json({ success: true, items: items.map(i => Object.assign(i, { id: String(i._id), canEdit: canEditItem(req, i) })), total, page, pages: Math.max(1, Math.ceil(total / per)) });
    } catch (e) { log.error('[qbank/list]', e); res.status(500).json({ success: false, message: e.message }); }
  });
  app.get('/api/qbank/topics', requireGrader, async (req, res) => {
    try {
      noStore(res);
      const rows = await QBankItem.aggregate([
        { $match: bankQueryFor(req) },
        { $group: { _id: '$topic', n: { $sum: 1 }, easy: { $sum: { $cond: [{ $eq: ['$difficulty', 'easy'] }, 1, 0] } },
                    medium: { $sum: { $cond: [{ $eq: ['$difficulty', 'medium'] }, 1, 0] } }, hard: { $sum: { $cond: [{ $eq: ['$difficulty', 'hard'] }, 1, 0] } } } },
        { $sort: { _id: 1 } }
      ]);
      const total = rows.reduce((s, r) => s + r.n, 0);
      res.json({ success: true, total, topics: rows.map(r => ({ topic: r._id || '', count: r.n, easy: r.easy, medium: r.medium, hard: r.hard })) });
    } catch (e) { log.error('[qbank/topics]', e); res.status(500).json({ success: false, message: e.message }); }
  });
  app.post('/api/qbank', requireGrader, writeLimiter, async (req, res) => {
    try {
      const b = req.body || {};
      const q = sanitizeQuestion(b);
      const bad = validQuestion(q);
      if (bad) return res.status(400).json({ success: false, message: bad });
      const courseId = b.courseId && isId(b.courseId) ? String(b.courseId) : '';
      if (!bankCourseOk(req, courseId)) return res.status(403).json({ success: false, message: 'Not your course.' });
      /* skip exact duplicates */
      const dup = await QBankItem.findOne({ question: q.question, type: q.type }).select('_id').lean();
      if (dup) return res.json({ success: true, id: String(dup._id), duplicate: true });
      const item = await QBankItem.create(Object.assign(q, { courseId, practice: b.practice !== false, createdBy: editorStamp(req.authUser) }));
      res.json({ success: true, id: String(item._id) });
    } catch (e) { log.error('[qbank/create]', e); res.status(500).json({ success: false, message: e.message }); }
  });
  app.put('/api/qbank/:id', requireGrader, writeLimiter, async (req, res) => {
    try {
      if (!isId(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid id.' });
      const cur = await QBankItem.findById(req.params.id).lean();
      if (!cur || !canEditItem(req, cur)) return res.status(404).json({ success: false, message: 'Question not found.' });
      const b = req.body || {};
      const q = sanitizeQuestion(Object.assign({}, cur, b));
      const bad = validQuestion(q);
      if (bad) return res.status(400).json({ success: false, message: bad });
      const courseId = b.courseId !== undefined ? (b.courseId && isId(b.courseId) ? String(b.courseId) : '') : cur.courseId;
      if (!bankCourseOk(req, courseId)) return res.status(403).json({ success: false, message: 'Not your course.' });
      await QBankItem.updateOne({ _id: cur._id }, { $set: Object.assign(q, { courseId, practice: b.practice !== undefined ? b.practice !== false : cur.practice }) });
      res.json({ success: true });
    } catch (e) { log.error('[qbank/update]', e); res.status(500).json({ success: false, message: e.message }); }
  });
  app.delete('/api/qbank/:id', requireGrader, async (req, res) => {
    try {
      if (!isId(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid id.' });
      const cur = await QBankItem.findById(req.params.id).lean();
      if (!cur || !canEditItem(req, cur)) return res.status(404).json({ success: false, message: 'Question not found.' });
      await QBankItem.deleteOne({ _id: cur._id });
      res.json({ success: true });
    } catch (e) { log.error('[qbank/delete]', e); res.status(500).json({ success: false, message: e.message }); }
  });
  app.post('/api/qbank/import', requireGrader, async (req, res) => {
    try {
      const rows = Array.isArray((req.body || {}).items) ? req.body.items.slice(0, 500) : [];
      const courseId = req.body.courseId && isId(req.body.courseId) ? String(req.body.courseId) : '';
      if (!bankCourseOk(req, courseId)) return res.status(403).json({ success: false, message: 'Not your course.' });
      let added = 0, skipped = 0;
      const errors = [];
      for (let i = 0; i < rows.length; i++) {
        const q = sanitizeQuestion(rows[i] || {});
        const bad = validQuestion(q);
        if (bad) { errors.push({ row: i + 1, message: bad }); continue; }
        const dup = await QBankItem.findOne({ question: q.question, type: q.type }).select('_id').lean();
        if (dup) { skipped++; continue; }
        await QBankItem.create(Object.assign(q, { courseId, practice: (rows[i] || {}).practice !== false, createdBy: editorStamp(req.authUser) }));
        added++;
      }
      res.json({ success: true, added, skipped, errors: errors.slice(0, 50) });
    } catch (e) { log.error('[qbank/import]', e); res.status(500).json({ success: false, message: e.message }); }
  });
  /* pick questions for a paper: explicit ids, or auto by topic + difficulty mix */
  app.post('/api/qbank/pick', requireGrader, async (req, res) => {
    try {
      const b = req.body || {};
      const base = bankQueryFor(req);
      let items = [];
      if (Array.isArray(b.ids) && b.ids.length) {
        const ids = b.ids.filter(isId).slice(0, 100);
        items = await QBankItem.find(Object.assign({ _id: { $in: ids } }, base)).lean();
        items.sort((x, y) => ids.indexOf(String(x._id)) - ids.indexOf(String(y._id)));
      } else {
        const count = Math.max(1, Math.min(100, parseInt(b.count, 10) || 10));
        const and = [];
        const topics = (Array.isArray(b.topics) ? b.topics : []).map(t => clean(t, 80)).filter(t => t !== undefined);
        if (topics.length) and.push({ topic: { $in: topics } });
        const types = (Array.isArray(b.types) ? b.types : []).filter(t => ALL_TYPES.includes(t));
        if (types.length) and.push({ type: { $in: types } });
        if (b.courseId && isId(b.courseId)) and.push({ $or: [{ courseId: String(b.courseId) }, { courseId: '' }] });
        if (Array.isArray(b.excludeQuestions) && b.excludeQuestions.length) and.push({ question: { $nin: b.excludeQuestions.slice(0, 500).map(x => String(x)) } });
        const filter = Object.assign({}, base); if (and.length) filter.$and = and;
        const pool = await QBankItem.find(filter).lean();
        const mix = b.mix || {};
        const wanted = { easy: Number(mix.easy) || 0, medium: Number(mix.medium) || 0, hard: Number(mix.hard) || 0 };
        const sum = wanted.easy + wanted.medium + wanted.hard;
        const shuffled = seededShuffle(pool, crypto.randomBytes(8).toString('hex'));
        if (sum > 0) {
          const target = { easy: Math.round(count * wanted.easy / sum), medium: Math.round(count * wanted.medium / sum) };
          target.hard = Math.max(0, count - target.easy - target.medium);
          for (const d of DIFFS) items.push(...shuffled.filter(x => x.difficulty === d).slice(0, target[d]));
          /* not enough of a level → top up from the rest */
          if (items.length < count) {
            const have = new Set(items.map(x => String(x._id)));
            items.push(...shuffled.filter(x => !have.has(String(x._id))).slice(0, count - items.length));
          }
        } else items = shuffled.slice(0, count);
      }
      if (items.length) await QBankItem.updateMany({ _id: { $in: items.map(x => x._id) } }, { $inc: { usedCount: 1 } });
      const strip = (x) => { const o = Object.assign({}, x); delete o._id; delete o.__v; delete o.createdAt; delete o.updatedAt; delete o.createdBy; delete o.usedCount; delete o.practice; delete o.courseId; return o; };
      res.json({ success: true, questions: items.map(strip), found: items.length });
    } catch (e) { log.error('[qbank/pick]', e); res.status(500).json({ success: false, message: e.message }); }
  });

  /* ============================ REPORT CARD (PDF) ============================ */
  app.get('/api/learn/report-card.pdf', requireUser, async (req, res) => {
    try {
      const me = req.authUser;
      const targetId = String((req.query || {}).userId || me._id);
      if (!isId(targetId)) return res.status(400).json({ success: false, message: 'Invalid user.' });
      let scope = null;
      const role = String(me.role || '').toLowerCase();
      if (targetId !== String(me._id)) {
        if (role === 'admin') scope = null;
        else if (role === 'professor') scope = new Set(((me.professor && me.professor.courses) || []).map(String));
        else return res.status(403).json({ success: false, message: 'Not allowed.' });
      }
      const user = await loadUser(targetId, 'createdAt');
      if (!user) return res.status(404).json({ success: false, message: 'Student not found.' });
      const perf = await performanceOf(user, scope);
      const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
      const pdf = await PDFDocument.create();
      const font = await pdf.embedFont(StandardFonts.Helvetica);
      const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
      const W = 595, H = 842, M = 42;
      let page = pdf.addPage([W, H]);
      let y = H - M;
      const brand = rgb(0.31, 0.27, 0.9), ink = rgb(0.1, 0.12, 0.17), mute = rgb(0.42, 0.45, 0.5), line = rgb(0.88, 0.89, 0.92);
      const text = (s, x, yy, size, f, color) => page.drawText(pdfSafe(s), { x, y: yy, size: size || 10, font: f || font, color: color || ink });
      const fit = (s, f, size, max) => { s = pdfSafe(s); while (s.length > 1 && f.widthOfTextAtSize(s, size) > max) s = s.slice(0, -2) + '…'.replace('…', '.'); return s; };
      const need = (h) => { if (y - h < M + 20) { page = pdf.addPage([W, H]); y = H - M; } };

      /* header band */
      page.drawRectangle({ x: 0, y: H - 96, width: W, height: 96, color: brand });
      page.drawText('RankerNode', { x: M, y: H - 44, size: 20, font: bold, color: rgb(1, 1, 1) });
      page.drawText('Student Report Card', { x: M, y: H - 66, size: 12, font, color: rgb(0.9, 0.9, 1) });
      const gen = new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
      page.drawText(pdfSafe('Generated ' + gen), { x: W - M - font.widthOfTextAtSize('Generated ' + gen, 10), y: H - 66, size: 10, font, color: rgb(0.9, 0.9, 1) });
      y = H - 126;
      text(user.fullName || user.username, M, y, 16, bold); y -= 18;
      text(`@${user.username}${user.email ? '   ·   ' + user.email : ''}`.replace('·', '-'), M, y, 10, font, mute); y -= 26;

      /* summary boxes */
      const S = perf.summary;
      const boxes = [['Tests', String(S.tests)], ['Average', S.avgPct + '%'], ['Best', S.bestPct + '%'], ['Avg percentile', S.avgPercentile === null ? '-' : S.avgPercentile + '']];
      const bw = (W - 2 * M - 30) / 4;
      boxes.forEach((b, i) => {
        const x = M + i * (bw + 10);
        page.drawRectangle({ x, y: y - 46, width: bw, height: 50, borderColor: line, borderWidth: 1, color: rgb(0.97, 0.97, 1) });
        page.drawText(pdfSafe(b[1]), { x: x + 10, y: y - 22, size: 16, font: bold, color: ink });
        page.drawText(pdfSafe(b[0]), { x: x + 10, y: y - 38, size: 9, font, color: mute });
      });
      y -= 72;

      /* tests table */
      text('Tests & assignments', M, y, 12, bold); y -= 16;
      const cols = [{ h: 'Course', w: 90 }, { h: 'Test', w: 165 }, { h: 'Marks', w: 70 }, { h: '%', w: 40 }, { h: 'Rank', w: 55 }, { h: 'Date', w: 91 }];
      const drawHead = () => {
        page.drawRectangle({ x: M, y: y - 6, width: W - 2 * M, height: 18, color: rgb(0.94, 0.95, 0.98) });
        let x = M + 6; cols.forEach(c => { page.drawText(c.h, { x, y, size: 9, font: bold, color: mute }); x += c.w; });
        y -= 18;
      };
      drawHead();
      if (!perf.tests.length) { text('No published results yet.', M + 6, y, 10, font, mute); y -= 16; }
      perf.tests.slice().reverse().forEach(t => {
        need(20); if (y > H - M - 5) drawHead();
        let x = M + 6;
        const cells = [t.courseCode || t.courseName, t.title + (t.kind === 'assignment' ? ' (assignment)' : '') + (t.pending ? ' *' : ''),
          `${t.earned} / ${t.possible}`, `${t.pct}`, t.rank ? `${t.rank}/${t.of}` : '-',
          t.at ? new Date(t.at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '-'];
        cells.forEach((c, i) => { page.drawText(fit(c, font, 9.5, cols[i].w - 8), { x, y, size: 9.5, font, color: ink }); x += cols[i].w; });
        page.drawLine({ start: { x: M, y: y - 6 }, end: { x: W - M, y: y - 6 }, thickness: 0.5, color: line });
        y -= 18;
      });
      if (perf.tests.some(t => t.pending)) { need(14); text('* written answers still being graded', M, y, 8.5, font, mute); y -= 14; }
      y -= 10;

      /* topics */
      if (perf.topics.length) {
        need(40); text('Topic-wise accuracy', M, y, 12, bold); y -= 18;
        perf.topics.slice().sort((a, b) => b.pct - a.pct).slice(0, 18).forEach(tp => {
          need(18);
          page.drawText(fit(tp.name, font, 9.5, 170), { x: M, y, size: 9.5, font, color: ink });
          const bx = M + 180, bwid = 260;
          page.drawRectangle({ x: bx, y: y - 2, width: bwid, height: 8, color: rgb(0.92, 0.93, 0.95) });
          const col = tp.pct >= 75 ? rgb(0.06, 0.73, 0.51) : tp.pct >= 40 ? rgb(0.96, 0.62, 0.04) : rgb(0.94, 0.27, 0.27);
          page.drawRectangle({ x: bx, y: y - 2, width: Math.max(2, bwid * tp.pct / 100), height: 8, color: col });
          page.drawText(pdfSafe(`${tp.pct}%  (${tp.right}/${tp.total})`), { x: bx + bwid + 10, y, size: 9, font, color: mute });
          y -= 16;
        });
        y -= 6;
      }
      if (perf.weakTopics.length) {
        need(30); text('Focus next: ' + perf.weakTopics.map(t => t.name).join(', '), M, y, 10, bold, rgb(0.8, 0.2, 0.2)); y -= 16;
      }
      /* footer on every page */
      pdf.getPages().forEach((p, i, all) => {
        p.drawText(pdfSafe(`RankerNode  -  report card of @${user.username}  -  page ${i + 1} of ${all.length}`), { x: M, y: 24, size: 8, font, color: mute });
      });
      const bytes = await pdf.save();
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="report-card-${String(user.username).replace(/[^\w.-]/g, '')}.pdf"`);
      res.setHeader('Cache-Control', 'no-store, private');
      res.end(Buffer.from(bytes));
    } catch (e) { log.error('[learn/report-card]', e); res.status(500).json({ success: false, message: e.message }); }
  });

  /* exposed for server.js (leaderboard + my-result) */
  return { resultsFor, rankOf, finalOf, resultVisible, isCorrect };
};
module.exports.isCorrect = isCorrect;
module.exports.sanitizeQuestion = sanitizeQuestion;
module.exports.validQuestion = validQuestion;
