const mongoose = require('mongoose');

/* ============================================================
   ⭐ STUDENT NOTES — notebook (2026-10-09)
   One document per notebook. Only metadata + page ORDER live here;
   the ink of every page is a separate NotePage document, so opening
   a notebook never loads all pages at once.
   ============================================================ */
const notebookSchema = new mongoose.Schema({
  userId:     { type: mongoose.Schema.Types.ObjectId, required: true },
  title:      { type: String, default: 'Untitled notebook', maxlength: 120 },
  cover:      { type: String, default: 'indigo' },     // cover colour key
  paper:      { type: String, default: 'lined' },      // blank | lined | grid | dotted | eng | cornell
  paperColor: { type: String, default: 'white' },      // white | cream | night
  courseId:   { type: String, default: null },         // optional link to a course
  pages:      { type: [String], default: [] },         // page ids, in order
  bytes:      { type: Number, default: 0 }             // total stored ink, for limits
}, { timestamps: true });

notebookSchema.index({ userId: 1, updatedAt: -1 });

module.exports = mongoose.models.Notebook || mongoose.model('Notebook', notebookSchema);
