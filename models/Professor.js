const mongoose = require('mongoose');

const professorSchema = new mongoose.Schema({
  name: { type: String, required: true },
  title: { type: String, required: true },
  description: { type: String, default: '' },
  email: { type: String, default: '' },
  phone: { type: String, default: '' },
  office: { type: String, default: '' },
  department: { type: String, default: '' },
  website: { type: String, default: '' },
  photo: { type: String, default: '' }, // Base64 for now, Cloud URL later
  visible: { type: Boolean, default: true } // admin can hide/show without deleting
}, { timestamps: true });

module.exports = mongoose.model('Professor', professorSchema);