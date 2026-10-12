'use strict';
/* ============================================================
   ⭐ PREMIUM HELP DESK API (2026-10-10)
   ------------------------------------------------------------
   Student (premium only to open a new question):
   GET    /api/help/tickets                 my questions (newest activity first)
   POST   /api/help/tickets                 ask {category, subject, message}
   POST   /api/help/tickets/:id/reply       add a message {message}
   POST   /api/help/tickets/:id/close       mark solved
   POST   /api/help/tickets/:id/seen        clear the "new reply" mark

   Admin:
   GET    /api/admin/help/tickets?status=   waiting first (premium, then oldest wait)
   GET    /api/admin/help/summary           how many are waiting (tab badge)
   POST   /api/admin/help/tickets/:id/reply {message} → in-app notification + email
   POST   /api/admin/help/tickets/:id/status {status}

   A student keeps access to questions they already asked even after
   their premium ends (they can read replies and answer back); only
   opening a NEW question needs an active subscription.
   ============================================================ */

const LIMITS = {
  subject: 140,
  message: 4000,
  messagesPerTicket: 60,
  openPerStudent: 5,
  listPerStudent: 50,
  adminList: 200
};
const CATEGORIES = {
  course: 'Course or study material',
  doubt: 'Academic doubt',
  exam: 'Quiz or exam',
  payment: 'Payment or subscription',
  account: 'Account or login',
  technical: 'Technical problem',
  other: 'Something else'
};

function clean(v, max) {
  return String(v == null ? '' : v).replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, max);
}

function serialize(t, forAdmin) {
  const o = {
    id: String(t._id), category: t.category, categoryLabel: CATEGORIES[t.category] || CATEGORIES.other,
    subject: t.subject, status: t.status, messages: (t.messages || []).map(m => ({ from: m.from, name: m.name, text: m.text, at: m.at })),
    unread: !!t.unreadForStudent, createdAt: t.createdAt, lastActivityAt: t.lastActivityAt
  };
  if (forAdmin) Object.assign(o, { userId: String(t.userId), username: t.username, fullName: t.fullName, email: t.email, premium: !!t.premium, waitingSince: t.waitingSince });
  return o;
}

module.exports = function mountHelpApi(app, deps) {
  const { requireUser, requireAdminAuth, rateLimit, mongoose, SupportTicket, User,
          userHasActiveSubscription, transporter, escapeHtml, withTimeout, clearAuthCache } = deps;
  const log = deps.logger || console;
  const isId = (v) => mongoose.Types.ObjectId.isValid(String(v || ''));
  const noStore = (res) => res.setHeader('Cache-Control', 'no-store, private');
  const fail = (res, code, message, extra) => res.status(code).json(Object.assign({ success: false, message }, extra || {}));

  const helpLimiter = rateLimit({
    windowMs: 10 * 60 * 1000, max: 30,
    standardHeaders: true, legacyHeaders: false,
    keyGenerator: (req) => 'help:' + (req.authUserId || req.ip),
    message: { success: false, message: 'You are sending messages very quickly — please wait a few minutes.' }
  });
  const isStudent = (u) => String((u && u.role) || '').trim().toLowerCase() === 'student';

  async function ownTicket(req, res) {
    if (!isId(req.params.id)) { fail(res, 404, 'Question not found.'); return null; }
    const t = await SupportTicket.findOne({ _id: req.params.id, userId: req.authUser._id });
    if (!t) { fail(res, 404, 'Question not found.'); return null; }
    return t;
  }

  function mail(to, subject, heading, lines, ctaText) {
    if (!to || !transporter) return;
    const html = `
      <div style="font-family:Inter,-apple-system,'Segoe UI',Roboto,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px 20px;color:#14161c;line-height:1.6;background:#ffffff;">
        <div style="border-left:4px solid #f59e0b;padding-left:14px;margin-bottom:20px;">
          <div style="font-size:18px;font-weight:700;">${escapeHtml(heading)}</div>
          <div style="font-size:12px;color:#8b8d98;letter-spacing:.5px;">RANKERNODE · PREMIUM HELP DESK</div>
        </div>
        ${lines.map(l => `<p style="margin:0 0 12px;white-space:pre-wrap;">${escapeHtml(l)}</p>`).join('')}
        ${ctaText ? `<p style="margin:18px 0 0;color:#6b6f7b;font-size:13px;">${escapeHtml(ctaText)}</p>` : ''}
      </div>`;
    const p = transporter.sendMail({ to, subject, text: lines.join('\n\n') + (ctaText ? '\n\n' + ctaText : ''), html });
    (withTimeout ? withTimeout(p, 15000, 'help-desk email') : p).catch(e => log.warn('[help] email failed:', e.message));
  }

  /* ================= STUDENT ================= */
  app.get('/api/help/tickets', requireUser, async (req, res) => {
    try {
      noStore(res);
      const list = await SupportTicket.find({ userId: req.authUser._id }).sort({ lastActivityAt: -1 }).limit(LIMITS.listPerStudent).lean();
      res.json({
        success: true,
        premium: userHasActiveSubscription(req.authUser),
        categories: CATEGORIES,
        tickets: list.map(t => serialize(t))
      });
    } catch (e) { log.error('[help] list', e); fail(res, 500, 'Could not load your questions.'); }
  });

  app.post('/api/help/tickets', requireUser, helpLimiter, async (req, res) => {
    try {
      noStore(res);
      const u = req.authUser;
      if (!isStudent(u)) return fail(res, 403, 'The help desk is for student accounts.');
      if (!userHasActiveSubscription(u)) return fail(res, 403, 'The Premium Help Desk is part of Premium. Subscribe to ask the team directly.', { code: 'PREMIUM_REQUIRED' });
      const b = req.body || {};
      const subject = clean(b.subject, LIMITS.subject).replace(/\s+/g, ' ');
      const message = clean(b.message, LIMITS.message);
      const category = CATEGORIES[b.category] ? b.category : 'other';
      if (subject.length < 3) return fail(res, 400, 'Please add a short subject.');
      if (message.length < 5) return fail(res, 400, 'Please describe your question.');
      const open = await SupportTicket.countDocuments({ userId: u._id, status: { $ne: 'closed' } });
      if (open >= LIMITS.openPerStudent) return fail(res, 400, `You have ${open} open questions. Close one that is solved before asking another.`);
      const now = new Date();
      const t = await SupportTicket.create({
        userId: u._id, username: u.username || '', fullName: u.fullName || '', email: u.email || '',
        premium: true, category, subject, status: 'open',
        messages: [{ from: 'student', name: u.fullName || u.username || 'Student', text: message, at: now }],
        lastActivityAt: now, waitingSince: now
      });
      if (process.env.ADMIN_EMAIL) {
        mail(process.env.ADMIN_EMAIL, `[Premium Help] ${subject}`, 'New premium question',
          [`${u.fullName || u.username} (${u.username}) asked — ${CATEGORIES[category]}:`, subject, message],
          'Reply from Admin → Help Desk.');
      }
      res.json({ success: true, ticket: serialize(t) });
    } catch (e) { log.error('[help] create', e); fail(res, 500, 'Could not send your question.'); }
  });

  app.post('/api/help/tickets/:id/reply', requireUser, helpLimiter, async (req, res) => {
    try {
      noStore(res);
      const t = await ownTicket(req, res); if (!t) return;
      const message = clean((req.body || {}).message, LIMITS.message);
      if (message.length < 1) return fail(res, 400, 'Message is empty.');
      if (t.messages.length >= LIMITS.messagesPerTicket) return fail(res, 400, 'This conversation is full — please ask a new question.');
      const now = new Date();
      t.messages.push({ from: 'student', name: req.authUser.fullName || req.authUser.username || 'Student', text: message, at: now });
      if (t.status !== 'open') t.waitingSince = now;
      t.status = 'open'; t.lastActivityAt = now; t.unreadForStudent = false;
      await t.save();
      res.json({ success: true, ticket: serialize(t) });
    } catch (e) { log.error('[help] reply', e); fail(res, 500, 'Could not send your message.'); }
  });

  app.post('/api/help/tickets/:id/close', requireUser, async (req, res) => {
    try {
      noStore(res);
      const t = await ownTicket(req, res); if (!t) return;
      t.status = 'closed'; t.unreadForStudent = false; t.lastActivityAt = new Date();
      await t.save();
      res.json({ success: true, ticket: serialize(t) });
    } catch (e) { log.error('[help] close', e); fail(res, 500, 'Could not update the question.'); }
  });

  app.post('/api/help/tickets/:id/seen', requireUser, async (req, res) => {
    try {
      noStore(res);
      if (!isId(req.params.id)) return fail(res, 404, 'Question not found.');
      await SupportTicket.updateOne({ _id: req.params.id, userId: req.authUser._id }, { $set: { unreadForStudent: false } });
      res.json({ success: true });
    } catch (e) { fail(res, 500, 'Server error.'); }
  });

  /* ================= ADMIN ================= */
  app.get('/api/admin/help/summary', requireAdminAuth, async (req, res) => {
    try {
      noStore(res);
      const waiting = await SupportTicket.countDocuments({ status: 'open' });
      res.json({ success: true, waiting });
    } catch (e) { fail(res, 500, 'Server error.'); }
  });

  app.get('/api/admin/help/tickets', requireAdminAuth, async (req, res) => {
    try {
      noStore(res);
      const st = String(req.query.status || 'open');
      const q = ['open', 'answered', 'closed'].includes(st) ? { status: st } : {};
      /* waiting questions: premium first, then whoever has waited longest */
      const sort = st === 'open' ? { premium: -1, waitingSince: 1 } : { lastActivityAt: -1 };
      const list = await SupportTicket.find(q).sort(sort).limit(LIMITS.adminList).lean();
      const counts = {};
      (await SupportTicket.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }])).forEach(r => { counts[r._id] = r.n; });
      res.json({ success: true, tickets: list.map(t => serialize(t, true)), counts });
    } catch (e) { log.error('[help] admin list', e); fail(res, 500, 'Could not load questions.'); }
  });

  app.post('/api/admin/help/tickets/:id/reply', requireAdminAuth, async (req, res) => {
    try {
      noStore(res);
      if (!isId(req.params.id)) return fail(res, 404, 'Question not found.');
      const t = await SupportTicket.findById(req.params.id);
      if (!t) return fail(res, 404, 'Question not found.');
      const message = clean((req.body || {}).message, LIMITS.message);
      if (!message) return fail(res, 400, 'Reply is empty.');
      if (t.messages.length >= LIMITS.messagesPerTicket) return fail(res, 400, 'This conversation is full.');
      const now = new Date();
      const admin = req.adminUser || {};
      t.messages.push({ from: 'admin', name: admin.fullName || 'RankerNode Team', text: message, at: now });
      t.status = (req.body || {}).close ? 'closed' : 'answered';
      t.unreadForStudent = true; t.lastActivityAt = now;
      await t.save();

      /* tell the student: bell notification + email */
      try {
        const user = await User.findById(t.userId);
        if (user) {
          if (!user.notifications) user.notifications = [];
          user.notifications.push({
            id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
            type: 'help-reply',
            title: '💬 The team replied to your question',
            body: t.subject,
            link: 'help:' + String(t._id),
            read: false, createdAt: now
          });
          if (user.notifications.length > 50) user.notifications = user.notifications.slice(-50);
          await user.save();
          if (clearAuthCache) clearAuthCache();
          mail(user.email, `Reply to your question: ${t.subject}`, 'The team replied to your question',
            [`Hi ${user.fullName || user.username},`, `About "${t.subject}":`, message],
            'Open RankerNode → Premium → Help Desk to read the full conversation or reply.');
        }
      } catch (e) { log.warn('[help] notify failed:', e.message); }

      res.json({ success: true, ticket: serialize(t, true) });
    } catch (e) { log.error('[help] admin reply', e); fail(res, 500, 'Could not send the reply.'); }
  });

  app.post('/api/admin/help/tickets/:id/status', requireAdminAuth, async (req, res) => {
    try {
      noStore(res);
      if (!isId(req.params.id)) return fail(res, 404, 'Question not found.');
      const st = String((req.body || {}).status || '');
      if (!['open', 'answered', 'closed'].includes(st)) return fail(res, 400, 'Invalid status.');
      const t = await SupportTicket.findByIdAndUpdate(req.params.id, { $set: { status: st, lastActivityAt: new Date() } }, { returnDocument: 'after' });
      if (!t) return fail(res, 404, 'Question not found.');
      res.json({ success: true, ticket: serialize(t, true) });
    } catch (e) { fail(res, 500, 'Server error.'); }
  });

  return { LIMITS, CATEGORIES };
};
module.exports.CATEGORIES = CATEGORIES;
