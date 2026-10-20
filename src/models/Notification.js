/**
 * HomeVista - Notification Model
 * Mongoose schema for user notifications
 */

const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  type: {
    type: String,
    required: true,
    enum: [
      'listing_approved', 'listing_rejected', 'listing_submitted', 'payment_received', 'payment_sent',
      'inspection_scheduled', 'new_message', 'new_inquiry', 'offer_received', 'offer_accepted',
      'offer_rejected', 'verification_required', 'new_listings', 'property_sold', 'payout_setup_needed',
      'system',
    ],
  },
  title: {
    type: String,
    required: true,
  },
  message: {
    type: String,
    required: true,
  },
  data: { type: mongoose.Schema.Types.Mixed },
  isRead: { type: Boolean, default: false },
  pushSent: { type: Boolean, default: false },
  emailSent: { type: Boolean, default: false },
}, { timestamps: true });

notificationSchema.index({ userId: 1, isRead: 1 });
notificationSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model('Notification', notificationSchema);
