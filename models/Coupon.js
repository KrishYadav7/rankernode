const mongoose = require('mongoose');

const couponSchema = new mongoose.Schema({
  code:            { type: String, required: true, unique: true, uppercase: true, trim: true },
  description:     { type: String, default: '' },

  /* Fixed percentage discount, 1–100 */
  discountPercent: { type: Number, required: true, min: 1, max: 100 },

  /* 0 = unlimited uses */
  maxUses:         { type: Number, default: 0 },
  usedCount:       { type: Number, default: 0 },

  active:          { type: Boolean, default: true },
  expiresAt:       { type: Date, default: null },

  createdBy:       { type: String, default: null },

  /* Audit trail */
  usedBy: [{
    userId:      String,
    userEmail:   String,
    planId:      String,
    amountSaved: Number,
    usedAt:      { type: Date, default: Date.now }
  }]
}, { timestamps: true });

couponSchema.index({ active: 1, expiresAt: 1 });
couponSchema.index({ createdAt: -1 });

couponSchema.methods.isValid = function () {
  if (!this.active) return false;
  if (this.expiresAt && new Date(this.expiresAt) < new Date()) return false;
  if (this.maxUses > 0 && this.usedCount >= this.maxUses) return false;
  return true;
};

module.exports = mongoose.model('Coupon', couponSchema);