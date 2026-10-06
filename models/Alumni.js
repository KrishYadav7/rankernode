const mongoose = require('mongoose');

const alumniSchema = new mongoose.Schema({
  name:        { type: String, required: true, trim: true },
  batch:       { type: String, default: '' },        // e.g. "2020-2024"
  degree:      { type: String, default: '' },        // e.g. "B.Tech, IIT Bombay"
  currentRole: { type: String, default: '' },        // e.g. "Design Engineer"
  company:     { type: String, default: '' },        // e.g. "ISRO / SpaceX"
  location:    { type: String, default: '' },        // e.g. "Bengaluru, India"
  email:       { type: String, default: '' },
  phone:       { type: String, default: '' },
  linkedin:    { type: String, default: '' },
  bio:         { type: String, default: '' },        // short journey / achievement
  photo:       { type: String, default: '' },        // URL or base64
  status:      { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
  approvedAt:  { type: Date, default: null },
  approvedBy:  { type: String, default: null },
  submittedAt: { type: Date, default: Date.now }
}, { timestamps: true });

alumniSchema.index({ status: 1, approvedAt: -1 });
alumniSchema.index({ submittedAt: -1 });

module.exports = mongoose.model('Alumni', alumniSchema);