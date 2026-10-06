const mongoose = require('mongoose');

/* ============================================================
   ACCESS LOG (2026-10-04) — invisible leak tracing
   ------------------------------------------------------------
   One row each time a signed-in user opens a paper, slide deck
   or video. Nothing is shown to students; admins can answer
   "who opened this paper, and when?" if content leaks.
   Rows expire automatically after 365 days (TTL index).
   ============================================================ */
const accessLogSchema = new mongoose.Schema({
  userId:     { type: String, required: true },
  username:   { type: String, default: '' },
  fullName:   { type: String, default: '' },
  courseId:   { type: String, required: true },
  materialId: { type: String, required: true },
  title:      { type: String, default: '' },
  kind:       { type: String, default: 'document' },   // document | slides | video
  preview:    { type: Boolean, default: false },       // opened as a free preview only
  ip:         { type: String, default: '' },
  device:     { type: String, default: '' },
  at:         { type: Date, default: Date.now }
}, { versionKey: false });

accessLogSchema.index({ materialId: 1, at: -1 });
accessLogSchema.index({ userId: 1, at: -1 });
accessLogSchema.index({ at: 1 }, { expireAfterSeconds: 365 * 24 * 3600 });

module.exports = mongoose.model('AccessLog', accessLogSchema);
