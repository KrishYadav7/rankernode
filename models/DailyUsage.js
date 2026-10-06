/* ============================================================
   DAILY USAGE — per-user, per-day activity aggregation
   ------------------------------------------------------------
   Memory-safe design:
     • ONE document per (userId, date) — never an unbounded array
     • Courses/materials stored as compact { id: seconds } maps
     • TTL index auto-deletes docs after 180 days
     • Atomic $inc updates — no read-modify-write races
   ============================================================ */
const mongoose = require('mongoose');

const dailyUsageSchema = new mongoose.Schema({
  userId:   { type: String, required: true },
  username: { type: String, default: '' },
  fullName: { type: String, default: '' },

  /* "YYYY-MM-DD" in IST — the calendar day this data belongs to */
  date:     { type: String, required: true },

  totalSeconds: { type: Number, default: 0 },

  /* id → cumulative seconds. Bounded by how many distinct items
     a student opens in a single day (typically < 30). */
  courses:   { type: Map, of: Number, default: {} },
  materials: { type: Map, of: Number, default: {} },

  /* Behavioural counters — updated via $inc on key actions */
  views:              { type: Number, default: 0 },
  quizzesTaken:       { type: Number, default: 0 },
  quizzesCompleted:   { type: Number, default: 0 },
  materialsCompleted: { type: Number, default: 0 },

  firstSeenAt:  { type: Date, default: null },
  lastSeenAt:   { type: Date, default: null },
  sessionCount: { type: Number, default: 0 }
}, { timestamps: true });

dailyUsageSchema.index({ userId: 1, date: 1 }, { unique: true });
dailyUsageSchema.index({ date: 1, totalSeconds: -1 });
dailyUsageSchema.index({ updatedAt: 1 }, { expireAfterSeconds: 180 * 24 * 60 * 60 });

module.exports = mongoose.model('DailyUsage', dailyUsageSchema);