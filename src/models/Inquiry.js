/**
 * HomeVista - Inquiry Model
 * Mongoose schema for property inquiries and offers
 */

const mongoose = require('mongoose');

const inquirySchema = new mongoose.Schema({
  propertyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Property',
    required: true,
  },
  senderId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  receiverId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  message: {
    type: String,
    required: true,
    trim: true,
  },
  type: {
    type: String,
    enum: ['inquiry', 'inspection_request', 'offer', 'general'],
    default: 'general',
  },
  status: {
    type: String,
    enum: ['pending', 'responded', 'closed'],
    default: 'pending',
  },
  inspectionDate: { type: Date },
  offerAmount: { type: Number, min: 0 },
}, { timestamps: true });

inquirySchema.index({ propertyId: 1 });
inquirySchema.index({ senderId: 1 });
inquirySchema.index({ receiverId: 1 });

module.exports = mongoose.model('Inquiry', inquirySchema);
