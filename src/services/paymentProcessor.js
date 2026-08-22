const Payment = require('../models/Payment');
const Property = require('../models/Property');
const { creditWallet, debitWallet } = require('./walletService');

const processSuccessfulPayment = async (paymentId) => {
  const payment = await Payment.findById(paymentId);
  if (!payment) throw new Error('Payment not found');

  // Prevent double-processing
  if (payment.processedAt) {
    console.log(`Payment ${paymentId} already processed, skipping`);
    return payment;
  }

  // ─── 1. PAYOUT / WITHDRAWAL ───
  if (payment.type === 'payout') {
    await debitWallet(payment.userId, payment.amount);
    payment.status = 'completed';
    payment.processedAt = new Date();
    await payment.save();
    return payment;
  }

  // ─── 2. REGULAR PAYMENTS ───
  payment.status = 'completed';
  payment.processedAt = new Date();
  await payment.save();

  // Property sale: update property + credit seller
  if (['purchase', 'rent', 'reservation'].includes(payment.type)) {
    if (payment.propertyId) {
      const property = await Property.findById(payment.propertyId);
      if (property) {
        const isRental = property.listingType === 'for_rent' || property.listingType === 'rent';
        property.status = isRental ? 'rented' : 'sold';
        property.buyer = payment.userId;
        property.soldAt = new Date();
        await property.save();

        const sellerId = payment.recipientId || property.listedBy;
        if (sellerId) {
          const net = payment.amount - (payment.platformFee || 0) - (payment.commissionAmount || 0);
          await creditWallet(sellerId, Math.max(0, net));
        }
      }
    }
  }

  // Wallet top-up: credit buyer
  if (payment.type === 'wallet_fund') {
    await creditWallet(payment.userId, payment.amount);
  }

  console.log(`✅ Payment ${paymentId} processed successfully`);
  return payment;
};

module.exports = { processSuccessfulPayment };