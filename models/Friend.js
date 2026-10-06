const mongoose = require('mongoose');

const friendSchema = new mongoose.Schema({
  name:     { type: String, required: true, trim: true },
  role:     { type: String, default: '' },        // e.g. "Mentor", "Supporter", "Co-Founder"
  bio:      { type: String, default: '' },
  email:    { type: String, default: '' },
  phone:    { type: String, default: '' },
  linkedin: { type: String, default: '' },
  photo:    { type: String, default: '' },        // URL or base64
  status:   { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
  approvedAt:  { type: Date, default: null },
  approvedBy:  { type: String, default: null },
  submittedAt: { type: Date, default: Date.now }
}, { timestamps: true });

friendSchema.index({ status: 1, approvedAt: -1 });
friendSchema.index({ submittedAt: -1 });

module.exports = mongoose.model('Friend', friendSchema);