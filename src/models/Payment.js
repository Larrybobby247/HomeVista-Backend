/**
 * HomeVista - Payment Model (Updated)
 */

const mongoose = require('mongoose');

const paymentSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  propertyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Property',
  },
  type: {
    type: String,
    required: true,
    enum: ['reservation', 'rent', 'agency_fee', 'inspection_fee', 'featured_ad', 'subscription', 'verification_fee', 'commission', 'service_charge', 'caution_fee', 'legal_fee', 'purchase', 'wallet_fund', 'payout'],
  },
  amount: {
    type: Number,
    required: true,
    min: [0, 'Amount cannot be negative'],
  },
  currency: { type: String, default: 'NGN' },
  status: {
    type: String,
    enum: ['pending', 'processing', 'completed', 'failed', 'refunded', 'cancelled'],
    default: 'pending',
  },
  method: {
    type: String,
    enum: ['card', 'bank_transfer', 'ussd', 'mobile_money', 'wallet', 'cash'],
    required: true,
  },

  // Payment provider details
  providerReference: { type: String, index: true }, // indexed for webhook speed
  providerResponse: { type: mongoose.Schema.Types.Mixed },

  // Escrow for secure transactions
  isEscrow: { type: Boolean, default: false },
  escrowReleased: { type: Boolean, default: false },
  escrowReleasedAt: { type: Date },

  // Recipient for admin sending payments
  recipientId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  recipientBankDetails: {
    bankName: { type: String },
    accountNumber: { type: String },
    accountName: { type: String },
  },

  // Commission and fees
  commissionAmount: { type: Number, default: 0 },
  platformFee: { type: Number, default: 0 },

  description: { type: String, trim: true },
  metadata: { type: mongoose.Schema.Types.Mixed },

  completedAt: { type: Date },
}, { timestamps: true });

paymentSchema.index({ userId: 1 });
paymentSchema.index({ status: 1 });
paymentSchema.index({ type: 1 });
paymentSchema.index({ createdAt: -1 });
// paymentSchema.index({ providerReference: 1 }); // critical for Paystack webhook

module.exports = mongoose.model('Payment', paymentSchema);