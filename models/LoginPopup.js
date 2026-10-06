const mongoose = require('mongoose');

/* ============================================================
   Login / landing-page announcement pop-up (admin-designed).
   Only one pop-up can be live at a time; the rest are saved
   designs the admin can reuse as templates.
   ============================================================ */
const loginPopupSchema = new mongoose.Schema({
  name:        { type: String, default: 'Untitled pop-up', maxlength: 120 },
  html:        { type: String, default: '', maxlength: 100000 },   // sanitised rich text
  design: {
    bg1:       { type: String, default: '#ffffff' },
    bg2:       { type: String, default: '' },          // second colour → gradient
    textColor: { type: String, default: '#0f172a' },
    accent:    { type: String, default: '#4f46e5' },   // button colour
    width:     { type: String, enum: ['sm', 'md', 'lg'], default: 'md' }
  },
  button: {
    text:      { type: String, default: '', maxlength: 60 },
    url:       { type: String, default: '', maxlength: 500 }
  },
  durationSec: { type: Number, default: 5, min: 0, max: 120 },     // 0 = stays until closed
  showOn:      { type: String, enum: ['both', 'landing', 'login'], default: 'both' },
  frequency:   { type: String, enum: ['session', 'always', 'once'], default: 'session' },
  active:      { type: Boolean, default: false, index: true },
  startAt:     { type: Date, default: null },
  endAt:       { type: Date, default: null },
  version:     { type: Number, default: 1 },
  updatedBy:   { type: String, default: '' }
}, { timestamps: true });

module.exports = mongoose.models.LoginPopup || mongoose.model('LoginPopup', loginPopupSchema);
