const mongoose = require('mongoose');

/* ============================================================
   ⭐ QUESTION BANK (2026-10-11)
   Reusable questions with topic + difficulty. Instructors build
   papers from it (pick or auto-generate); items marked `practice`
   also feed the students' Daily Challenge.
   ============================================================ */
const matrixRowSchema = new mongoose.Schema({
  text:         { type: String, default: '' },
  correctIndex: { type: Number, default: 0 }
}, { _id: false });

const qbankItemSchema = new mongoose.Schema({
  type:        { type: String, default: 'single' },   // single | multiple | integer | numerical | matrix | subjective
  question:    { type: String, required: true },
  explanation: { type: String, default: '' },
  options:        { type: [String], default: [] },
  correctIndexes: { type: [Number], default: [] },
  integerAnswer:    { type: Number, default: null },
  integerTolerance: { type: Number, default: 0 },
  rangeMin: { type: Number, default: null },
  rangeMax: { type: Number, default: null },
  matrixLeftItems:  { type: [String], default: [] },
  matrixRightItems: { type: [String], default: [] },
  matrixRows:       { type: [matrixRowSchema], default: [] },
  subjectiveMaxMarks:     { type: Number, default: 10 },
  subjectiveInstructions: { type: String, default: '' },
  marks:         { type: Number, default: 4 },
  negativeMarks: { type: Number, default: -1 },

  topic:      { type: String, default: '', index: true },
  difficulty: { type: String, default: '' },          // easy | medium | hard
  courseId:   { type: String, default: '', index: true },   // '' = any course
  practice:   { type: Boolean, default: true },       // offered in the Daily Challenge
  createdBy:  { id: String, name: String, role: String },
  usedCount:  { type: Number, default: 0 }
}, { timestamps: true });

qbankItemSchema.index({ question: 'text', topic: 'text' });

module.exports = mongoose.models.QBankItem || mongoose.model('QBankItem', qbankItemSchema);
