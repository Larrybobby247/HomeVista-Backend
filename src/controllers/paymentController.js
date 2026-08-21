/**
 * HomeVista Backend - Payment Controller (Paystack Integrated)
 * Handles payments, wallet, and subscriptions via Paystack
 */

const fetch = require('node-fetch');
const crypto = require('crypto');
const Payment = require('../models/Payment');
const User = require('../models/User');
const Property = require('../models/Property');

const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY; // sk_test_...
const PAYSTACK_BASE = 'https://api.paystack.co';

/**
 * @desc    Initialize payment (with Paystack)
 * @route   POST /api/payments/initialize
 * @access  Private
 */
const initializePayment = async (req, res, next) => {
  try {
    const { type, amount, propertyId, method, description } = req.body;

    if (!type || !amount || amount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'type and valid amount are required',
      });
    }

    if (method !== 'paystack') {
      return res.status(400).json({
        success: false,
        message: 'Only paystack method is supported',
      });
    }

    // Generate unique Paystack reference
    const timestamp = Date.now();
    const randomStr = Math.random().toString(36).slice(2, 7).toUpperCase();
    const paystackRef = `HV_${type.toUpperCase()}_${timestamp}_${randomStr}`;

    // Call Paystack to initialize
    const paystackRes = await fetch(`${PAYSTACK_BASE}/transaction/initialize`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${PAYSTACK_SECRET}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: req.user.email,
        amount: Math.round(amount * 100), // Convert to kobo
        reference: paystackRef,
        callback_url: `${process.env.FRONTEND_URL}/payments/verify`, // fallback for web
        metadata: {
          user_id: req.user._id.toString(),
          payment_id: null, // will update after create
          type,
          property_id: propertyId || null,
          description: description || '',
          custom_fields: [
            { display_name: 'Payment Type', variable_name: 'payment_type', value: type },
            { display_name: 'User', variable_name: 'user_email', value: req.user.email },
            ...(propertyId ? [{ display_name: 'Property ID', variable_name: 'property_id', value: propertyId }] : []),
          ],
        },
      }),
    });

    const paystackData = await paystackRes.json();

    if (!paystackData.status) {
      return res.status(400).json({
        success: false,
        message: paystackData.message || 'Paystack initialization failed',
      });
    }

    // Create payment record in your DB
    const payment = await Payment.create({
      userId: req.user._id,
      propertyId: propertyId || null,
      type,
      amount,
      method: 'paystack',
      description: description || '',
      status: 'pending',
      providerReference: paystackRef,
      authorizationUrl: paystackData.data.authorization_url,
      accessCode: paystackData.data.access_code,
    });

    // Update Paystack metadata with the payment ID (for webhook matching)
    // (Optional — Paystack doesn't let you update after init, but reference is enough)

    res.status(201).json({
      success: true,
      message: 'Payment initialized',
      data: {
        _id: payment._id,
        authorization_url: paystackData.data.authorization_url,
        access_code: paystackData.data.access_code,
        reference: paystackRef,
        amount,
        status: 'pending',
      },
    });
  } catch (error) {
    next(error);
  }
};

const updatePropertyOnPayment = async (payment) => {
  // Only run for property-related payments that have a propertyId
  if (!payment.propertyId) return;
  if (!['purchase', 'rent', 'reservation'].includes(payment.type)) return;

  const property = await Property.findById(payment.propertyId);
  if (!property) return;

  // Determine new status based on how the property was listed
  // If your property model uses 'listingType' (for_sale / for_rent):
  const isRental = property.listingType === 'for_rent' || property.listingType === 'rent';
  
  // Or if you determine it from the payment type:
  // const isRental = payment.type === 'rent';

  property.status = isRental ? 'rented' : 'sold';
  
  // Record who bought/rented it
  property.buyer = payment.userId;      // or property.tenant = payment.userId
  property.soldAt = new Date();         // or property.rentedAt
  property.paymentReference = payment.providerReference;

  await property.save();
};

/**
 * @desc    Verify payment (with Paystack)
 * @route   GET /api/payments/verify/:reference
 * @access  Private
 */
const verifyPayment = async (req, res, next) => {
  try {
    const { reference } = req.params;

    const payment = await Payment.findOne({
      providerReference: reference,
      userId: req.user._id,
    });

    if (!payment) {
      return res.status(404).json({ success: false, message: 'Payment not found' });
    }

    if (payment.status === 'completed') {
      return res.status(200).json({
        success: true,
        message: 'Payment already verified',
        data: payment,
      });
    }

    // Just check status with Paystack — don't redo completion logic here,
    // the webhook is the source of truth for marking completed + crediting.
    const verifyRes = await fetch(`${PAYSTACK_BASE}/transaction/verify/${reference}`, {
      headers: { Authorization: `Bearer ${PAYSTACK_SECRET}` },
    });
    const verifyData = await verifyRes.json();

    if (!verifyData.status) {
      return res.status(400).json({
        success: false,
        message: verifyData.message || 'Paystack verification failed',
      });
    }

    const tx = verifyData.data;

    if (tx.status === 'success') {
      // Re-fetch in case the webhook already completed it in the meantime
      const refreshed = await Payment.findById(payment._id);
      return res.status(200).json({
        success: true,
        message: refreshed.status === 'completed' ? 'Payment verified and completed' : 'Payment verified, awaiting webhook confirmation',
        data: refreshed,
      });
    }

    payment.status = tx.status;
    await payment.save();

    return res.status(400).json({
      success: false,
      message: `Payment status: ${tx.status}`,
      data: payment,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get payment history
 * @route   GET /api/payments/history
 * @access  Private
 */
const getPaymentHistory = async (req, res, next) => {
  try {
    const payments = await Payment.find({ userId: req.user._id })
      .populate('propertyId', 'title images address city state listedBy')
      .populate('userId', 'firstName lastName email')
      .sort({ createdAt: -1 });

    // Map to the shape your frontend expects
    const mapped = payments.map((p) => ({
      _id: p._id,
      propertyId: p.propertyId?._id?.toString() || p.propertyId,
      propertyTitle: p.propertyId?.title || p.description || 'Property Transaction',
      propertyImage: p.propertyId?.images?.[0]?.url || null,
      amount: p.amount,
      status: p.status, // 'pending', 'completed', 'failed', etc.
      type: p.type,     // 'purchase', 'rent', 'wallet_fund', etc.
      paymentMethod: p.method || p.channel || 'card',
      createdAt: p.createdAt,
      completedAt: p.completedAt,
      transactionRef: p.providerReference || p._id.toString(),
      sellerName: p.propertyId?.listedBy?.fullName || 'HomeVista',
      description: p.description,
      currency: p.currency || 'NGN',
    }));

    res.status(200).json({
      success: true,
      data: mapped,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get wallet balance
 * @route   GET /api/payments/wallet/balance
 * @access  Private
 */
const getWalletBalance = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    res.status(200).json({
      success: true,
      data: { 
        balance: user.walletBalance || 0,
        amount: user.walletBalance || 0 
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Paystack Webhook
 * @route   POST /api/payments/webhook
 * @access  Public (but signed by Paystack)
 */
const paystackWebhook = async (req, res) => {
  const hash = crypto
    .createHmac('sha512', PAYSTACK_SECRET)
    .update(JSON.stringify(req.body))
    .digest('hex');

  if (hash !== req.headers['x-paystack-signature']) {
    return res.sendStatus(400);
  }

  const event = req.body;

  if (event.event === 'charge.success') {
    const tx = event.data;
    const reference = tx.reference;

    try {
      const payment = await Payment.findOneAndUpdate(
        { providerReference: reference, status: { $ne: 'completed' } },
        {
          $set: {
            status: 'completed',
            completedAt: new Date(),
            paidAt: tx.paid_at ? new Date(tx.paid_at) : new Date(),
            channel: tx.channel,
            currency: tx.currency,
            fees: tx.fees ? tx.fees / 100 : 0,
            customerCode: tx.customer?.customer_code || null,
          },
        },
        { new: true }
      );

      if (!payment) {
        console.log(`Webhook: no pending payment found for ${reference} (already completed or missing)`);
        return res.sendStatus(200);
      }

      // Property purchase / rent: update property + credit seller's wallet
      if (['purchase', 'rent', 'reservation'].includes(payment.type) && payment.propertyId) {
        await updatePropertyOnPayment(payment);

        const property = await Property.findById(payment.propertyId).select('listedBy listedByType');
        const creditRecipientId = payment.recipientId || property?.listedBy;

        if (creditRecipientId) {
          const netAmount = payment.amount - (payment.platformFee || 0) - (payment.commissionAmount || 0);
          const credit = Math.max(0, netAmount);

          const updatedUser = await User.findByIdAndUpdate(
            creditRecipientId,
            { $inc: { walletBalance: credit } },
            { new: true }
          );

          console.log('Webhook: credited wallet', {
            recipientId: creditRecipientId,
            credit,
            paymentId: payment._id,
            newBalance: updatedUser?.walletBalance,
          });
        } else {
          console.log('Webhook: no recipient resolved for payment', payment._id);
        }
      }

      // Wallet funding: credit the buyer's own wallet
      if (payment.type === 'wallet_fund') {
        await User.findByIdAndUpdate(payment.userId, {
          $inc: { walletBalance: payment.amount },
        });
      }

      // Subscription
      if (payment.type === 'subscription') {
        // TODO: activate subscription
      }

      console.log(`Webhook: Payment ${reference} completed`);
    } catch (err) {
      console.error('Webhook processing error:', err);
    }
  }

  res.sendStatus(200);
};

module.exports = {
  initializePayment,
  verifyPayment,
  getPaymentHistory,
  getWalletBalance,
  paystackWebhook,
};