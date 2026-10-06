/* ============================================================
   VISIT — persistent, cumulative website traffic counters
   ------------------------------------------------------------
   This collection holds ONE document per key. Currently only
   key='global' is used.

   Why a singleton:
     • Total visits / device totals are counters, not rows.
       A single $inc per 5-second flush keeps the writes flat
       (1 update) no matter how many page views arrived.
     • Daily rollups are stored as MongoDB Maps keyed on
       'YYYY-MM-DD' — bounded by how many days the server runs,
       and cheap to prune.

   Safety:
     • No migration is required. The first flush upserts the doc.
     • No reference from User / Course / Settings.
     • Deleting this file does not affect any other feature.
   ============================================================ */
const mongoose = require('mongoose');

const visitSchema = new mongoose.Schema({
  key: { type: String, unique: true, default: 'global' },

  /* Cumulative counters (all time) */
  totalVisits: { type: Number, default: 0 },
  deviceCounts: {
    desktop: { type: Number, default: 0 },
    mobile:  { type: Number, default: 0 },
    tablet:  { type: Number, default: 0 }
  },

  /* Per-day Maps:  'YYYY-MM-DD' (IST)  →  integer counter */
  daily:         { type: Map, of: Number, default: {} },  // page views
  dailyUnique:   { type: Map, of: Number, default: {} },  // unique visitors
  dailyDesktop:  { type: Map, of: Number, default: {} },
  dailyMobile:   { type: Map, of: Number, default: {} },
  dailyTablet:   { type: Map, of: Number, default: {} },

  lastUpdatedAt: { type: Date, default: Date.now }
}, { timestamps: true });

module.exports = mongoose.model('Visit', visitSchema);