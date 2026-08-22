const Payment = require('../models/Payment');
const Property = require('../models/Property');
const User = require('../models/User');
const { creditWallet, debitWallet } = require('./walletService');

/**
 * Process ANY payment that has been confirmed successful.
 * Called by: Webhook, verifyPayment, and Admin confirmPayment
 */
const processSuccessfulPayment = async (paymentId) => {
  const payment = await Payment.findById(paymentId);
  if (!payment) throw new Error('Payment not found');
  if (payment.processedAt) {
    console.log('Payment already processed, skipping');
    return payment; // Already handled
  }

  // ─── 1. PAYOUT / WITHDRAWAL ───
  if (payment.type === 'payout') {
    await debitWallet(payment.userId, payment.amount);
    payment.status = 'completed';
    payment.processedAt = new Date();
    await payment.save();
    return payment;
  }

  // ─── 2. REGULAR PAYMENTS (purchase, rent, reservation, wallet_fund) ───
  payment.status = 'completed';
  payment.processedAt = new Date();
  await payment.save();

  // Credit seller for property sales
  if (['purchase', 'rent', 'reservation'].includes(payment.type)) {
    if (payment.propertyId) {
      const property = await Property.findById(payment.propertyId);
      if (property) {
        // Update property status
        const isRental = property.listingType === 'for_rent' || property.listingType === 'rent';
        property.status = isRental ? 'rented' : 'sold';
        property.buyer = payment.userId;
        property.soldAt = new Date();
        await property.save();

        // Credit the property owner
        const sellerId = payment.recipientId || property.listedBy;
        if (sellerId) {
          const netAmount = payment.amount - (payment.platformFee || 0) - (payment.commissionAmount || 0);
          await creditWallet(sellerId, Math.max(0, netAmount));
        }
      }
    }
  }

  // Credit buyer's own wallet for wallet top-ups
  if (payment.type === 'wallet_fund') {
    await creditWallet(payment.userId, payment.amount);
  }

  // TODO: Handle subscriptions here
  if (payment.type === 'subscription') {
    // Activate subscription logic
  }

  return payment;
};

module.exports = { processSuccessfulPayment };