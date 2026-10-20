const Payment = require('../models/Payment');
const Property = require('../models/Property');
const User = require('../models/User');
const { creditWallet, debitWallet } = require('./walletService');
const { notify } = require('./notificationService');

const RENTAL_STATUSES = ['for_rent', 'lease', 'shortlet'];
const naira = (n) => `₦${Number(n || 0).toLocaleString('en-NG')}`;

const processSuccessfulPayment = async (paymentId) => {
  // Atomically claim the payment so the webhook and the app's verify call can't both process it
  const payment = await Payment.findOneAndUpdate(
    { _id: paymentId, processedAt: null },
    { $set: { processedAt: new Date(), status: 'completed' } },
    { new: true }
  );
  if (!payment) {
    console.log(`Payment ${paymentId} already processed, skipping`);
    return Payment.findById(paymentId);
  }

  // ─── 1. PAYOUT / WITHDRAWAL ───
  if (payment.type === 'payout') {
    await debitWallet(payment.userId, payment.amount);
    return payment;
  }

  // ─── 2. PROPERTY SALE / RENT ───
  if (['purchase', 'rent', 'reservation'].includes(payment.type) && payment.propertyId) {
    const property = await Property.findById(payment.propertyId);
    if (property) {
      const isRental = RENTAL_STATUSES.includes(property.status) || payment.type === 'rent';
      const isReservation = payment.type === 'reservation';

      property.status = isReservation ? 'reserved' : isRental ? 'rented' : 'sold';
      property.buyer = payment.userId;
      property.soldAt = new Date();
      property.isFeatured = false; // a sold/rented property drops off Featured automatically
      await property.save();

      const sellerId = payment.sellerId || payment.recipientId || property.listedBy;

      if (payment.settledBySplit) {
        // Paystack already paid the seller directly (minus commission + fee): nothing to credit
      } else if (sellerId) {
        const net = payment.amount - (payment.platformFee || 0) - (payment.commissionAmount || 0);
        await creditWallet(sellerId, Math.max(0, net));
      }

      const verb = isReservation ? 'reserved' : isRental ? 'rented' : 'sold';
      const buyer = await User.findById(payment.userId).select('firstName lastName');
      const buyerName = buyer ? `${buyer.firstName} ${buyer.lastName}` : 'A buyer';

      if (sellerId) {
        notify(sellerId, {
          type: 'payment_received',
          title: `Payment received - your property is ${verb}`,
          message: payment.settledBySplit
            ? `${buyerName} paid ${naira(payment.amount)} for "${property.title}". After our ${naira(payment.commissionAmount)} commission and ${naira(payment.paystackFee)} transaction fee, ${naira(payment.sellerAmount)} is on its way to your bank account.`
            : `${buyerName} paid ${naira(payment.amount)} for "${property.title}".`,
          data: { paymentId: String(payment._id), propertyId: String(property._id), screen: 'transactions' },
        });
      }
      notify(payment.userId, {
        type: 'payment_sent',
        title: 'Payment successful',
        message: `Your payment of ${naira(payment.amount)} for "${property.title}" was successful. You can download your receipt in Transactions.`,
        data: { paymentId: String(payment._id), propertyId: String(property._id), screen: 'transactions' },
      });
    }
  }

  // ─── 3. WALLET TOP-UP ───
  if (payment.type === 'wallet_fund') {
    await creditWallet(payment.userId, payment.amount);
  }

  console.log(`✅ Payment ${paymentId} processed successfully`);
  return payment;
};

module.exports = { processSuccessfulPayment };
