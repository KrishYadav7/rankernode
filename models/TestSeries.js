const mongoose = require('mongoose');

/* ⭐ TEST SERIES (2026-10-11) — several tests ranked together */
const testSeriesSchema = new mongoose.Schema({
  title:       { type: String, required: true },
  description: { type: String, default: '' },
  tests:       [{ courseId: String, materialId: String, _id: false }],
  published:   { type: Boolean, default: true },
  createdBy:   { id: String, name: String, role: String }
}, { timestamps: true });

module.exports = mongoose.models.TestSeries || mongoose.model('TestSeries', testSeriesSchema);
