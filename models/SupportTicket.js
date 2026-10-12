const mongoose = require('mongoose');

/* ============================================================
   ⭐ PREMIUM HELP DESK — one conversation between a premium
   student and the admin team (2026-10-10)
   Messages live inside the ticket (capped by help-api.js), so a
   ticket is always one small document.
   ============================================================ */
const messageSchema = new mongoose.Schema({
  from: { type: String, enum: ['student', 'admin'], required: true },
  name: { type: String, default: '' },
  text: { type: String, required: true },
  at:   { type: Date, default: Date.now }
}, { _id: false });

const supportTicketSchema = new mongoose.Schema({
  userId:   { type: mongoose.Schema.Types.ObjectId, required: true },
  username: { type: String, default: '' },
  fullName: { type: String, default: '' },
  email:    { type: String, default: '' },
  premium:  { type: Boolean, default: true },           // subscription active when it was opened
  category: { type: String, default: 'other' },
  subject:  { type: String, required: true },
  status:   { type: String, enum: ['open', 'answered', 'closed'], default: 'open' },
  messages: { type: [messageSchema], default: [] },
  unreadForStudent: { type: Boolean, default: false },
  lastActivityAt:   { type: Date, default: Date.now },
  waitingSince:     { type: Date, default: Date.now }  // when the student last wrote and is waiting
}, { timestamps: true });

supportTicketSchema.index({ userId: 1, lastActivityAt: -1 });
supportTicketSchema.index({ status: 1, waitingSince: 1 });

module.exports = mongoose.models.SupportTicket || mongoose.model('SupportTicket', supportTicketSchema);
