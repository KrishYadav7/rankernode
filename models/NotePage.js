const mongoose = require('mongoose');

/* ============================================================
   ⭐ STUDENT NOTES — one page of ink (2026-10-09)
   `data` is the page's strokes + text boxes as compact JSON
   (delta-encoded integer points), written by notes.js. The server
   stores it as-is after checking its size and shape.
   ============================================================ */
const notePageSchema = new mongoose.Schema({
  notebookId: { type: mongoose.Schema.Types.ObjectId, required: true },
  userId:     { type: mongoose.Schema.Types.ObjectId, required: true },
  pageId:     { type: String, required: true },
  paper:      { type: String, default: '' },           // '' = notebook default
  data:       { type: String, default: '' },
  bytes:      { type: Number, default: 0 },
  rev:        { type: Number, default: 0 }
}, { timestamps: true });

notePageSchema.index({ notebookId: 1, pageId: 1 }, { unique: true });
notePageSchema.index({ userId: 1 });

module.exports = mongoose.models.NotePage || mongoose.model('NotePage', notePageSchema);
