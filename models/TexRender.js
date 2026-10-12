const mongoose = require('mongoose');

/* ============================================================
   ⭐ LaTeX ENGINE RESULTS (2026-10-10) — one compiled LaTeX block
   (TikZ / pgfplots / circuitikz / chemfig / full document …) as SVG,
   keyed by the SHA-256 of its source. Compiled once, served forever.
   Failed compiles are kept too (with the error), so a broken block
   is not recompiled on every view.
   ============================================================ */
const texRenderSchema = new mongoose.Schema({
  hash:   { type: String, required: true, unique: true },
  ok:     { type: Boolean, default: false },
  pages:  { type: [String], default: [] },      // SVG markup, one per page
  sizes:  { type: [[Number]], default: [] },    // [[widthPt, heightPt], …]
  error:  { type: String, default: '' },        // first TeX error, with the author's line number
  line:   { type: Number, default: 0 },
  ms:     { type: Number, default: 0 },
  bytes:  { type: Number, default: 0 },
  lastUsedAt: { type: Date, default: Date.now }
}, { timestamps: true });

module.exports = mongoose.models.TexRender || mongoose.model('TexRender', texRenderSchema);
