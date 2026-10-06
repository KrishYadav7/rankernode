const mongoose = require('mongoose');

const contributionSchema = new mongoose.Schema({
  studentName:     { type: String, default: '' },
  studentUsername: { type: String, default: '' },
  studentEmail:    { type: String, default: '' },

  title:           { type: String, required: true, trim: true },
  description:     { type: String, default: '', trim: true },
  subject:         { type: String, default: '' },

  fileUrl:             { type: String, required: true },
  cloudUrl:            { type: String, default: '' },
  fileName:            { type: String, default: '' },
  fileSize:            { type: Number, default: 0 },
  fileType:            { type: String, default: '' },
  cloudinaryPublicId:  { type: String, default: '' },

  status:          { type: String, enum: ['pending', 'downloaded', 'deleted'], default: 'pending' },
  downloadedAt:    { type: Date, default: null },

  submittedAt:     { type: Date, default: Date.now }
}, { timestamps: true });

contributionSchema.index({ status: 1, submittedAt: -1 });
contributionSchema.index({ studentUsername: 1 });

module.exports = mongoose.model('Contribution', contributionSchema);