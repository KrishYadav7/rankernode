const mongoose = require('mongoose');

/* ============================================================
   CATEGORY — the academic track a student studies for
   (Class 11, Class 12, JEE Main & Advanced, NEET, Foundation…).
   Students pick one before they see courses; each course lists
   the categories it belongs to (Course.tracks) and its subject.
   Admins add / edit / reorder categories in Admin → Categories.
   ============================================================ */
const subjectSchema = new mongoose.Schema({
  key:  { type: String, required: true },          // physics | chemistry | mathematics | biology | …
  name: { type: String, required: true }
}, { _id: false });

const categorySchema = new mongoose.Schema({
  key:      { type: String, required: true, unique: true, lowercase: true, trim: true },
  name:     { type: String, required: true, trim: true },
  tagline:  { type: String, default: '' },
  icon:     { type: String, default: 'fa-book-open' },   // Font Awesome icon name
  color:    { type: String, default: '#4F46E5' },
  subjects: { type: [subjectSchema], default: [] },
  order:    { type: Number, default: 0 },
  active:   { type: Boolean, default: true }
}, { timestamps: true });

categorySchema.index({ order: 1 });

const PCM  = [{ key: 'physics', name: 'Physics' }, { key: 'chemistry', name: 'Chemistry' }, { key: 'mathematics', name: 'Mathematics' }];
const PCB  = [{ key: 'physics', name: 'Physics' }, { key: 'chemistry', name: 'Chemistry' }, { key: 'biology', name: 'Biology' }];
const PCMB = PCM.concat([{ key: 'biology', name: 'Biology' }]);

/* First-run defaults (inserted only when the collection is empty) */
categorySchema.statics.DEFAULTS = [
  { key: 'class-11',   name: 'Class 11',            tagline: 'NCERT & board syllabus with a strong base for JEE and NEET', icon: 'fa-book-open',      color: '#6366F1', subjects: PCMB, order: 1 },
  { key: 'class-12',   name: 'Class 12',            tagline: 'Board-exam ready, chapter by chapter, NCERT first',          icon: 'fa-graduation-cap', color: '#0EA5E9', subjects: PCMB, order: 2 },
  { key: 'jee',        name: 'JEE Main & Advanced', tagline: 'Engineering entrance — IITs, NITs and IIITs',                icon: 'fa-atom',           color: '#F59E0B', subjects: PCM,  order: 3 },
  { key: 'neet',       name: 'NEET',                tagline: 'Medical entrance — MBBS, BDS and AYUSH',                     icon: 'fa-heart-pulse',    color: '#10B981', subjects: PCB,  order: 4 },
  { key: 'foundation', name: 'Foundation',          tagline: 'Classes 8–10 — concepts early for Olympiads, NTSE, JEE & NEET', icon: 'fa-seedling',   color: '#EC4899', subjects: PCMB, order: 5 }
];

module.exports = mongoose.model('Category', categorySchema);
