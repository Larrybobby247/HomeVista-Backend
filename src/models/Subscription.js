/**
 * HomeVista Backend - Subscription Model
 * Mongoose schema for subscription packages and user subscriptions
 */

const mongoose = require('mongoose');

// Subscription Package Schema
const subscriptionPackageSchema = new mongoose.Schema({
  name: { type: String, required: true },
  description: { type: String, required: true },
  price: { type: Number, required: true },
  duration: { type: Number, required: true }, // in days
  features: [{ type: String }],
  maxListings: { type: Number, required: true },
  isFeatured: { type: Boolean, default: false },
  isActive: { type: Boolean, default: true },
});

// User Subscription Schema
const userSubscriptionSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  packageId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'SubscriptionPackage',
    required: true,
  },
  startDate: { type: Date, required: true },
  endDate: { type: Date, required: true },
  isActive: { type: Boolean, default: true },
  autoRenew: { type: Boolean, default: false },
  paymentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Payment',
    required: true,
  },
}, {
  timestamps: true,
});

const SubscriptionPackage = mongoose.model('SubscriptionPackage', subscriptionPackageSchema);
const UserSubscription = mongoose.model('UserSubscription', userSubscriptionSchema);

module.exports = { SubscriptionPackage, UserSubscription };
