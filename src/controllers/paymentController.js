/**
 * HomeVista Backend - Payment Controller (Paystack Integrated)
 * Handles payments, wallet, and subscriptions via Paystack
 */

const fetch = require('node-fetch');
const crypto = require('crypto');
const Payment = require('../models/Payment');
const User = require('../models/User');
const Property = require('../models/Property');
const { processSuccessfulPayment } = require('../services/paymentProcessor');

const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY;
const PAYSTACK_BASE = 'https://api.paystack.co';

/* ─── Shared helper: run AFTER a payment is confirmed completed ─── */
const processCompletedPayment = async (payment) => {
  // 1. Property purchase / rent / reservation
  if (['purchase', 'rent', 'reservation'].includes(payment.type) && payment.propertyId) {
    await updatePropertyOnPayment(payment);

    // Credit seller / landlord / agent wallet
    const property = await Property.findById(payment.propertyId).select('listedBy');
    const recipientId = payment.recipientId || property?.listedBy;

    if (recipientId) {
      const platformFee = payment.platformFee || 0;
      const commission = payment.commissionAmount || 0;
      const netAmount = Math.max(0, payment.amount - platformFee - commission);

      if (netAmount > 0) {
        await User.findByIdAndUpdate(recipientId, {
          $inc: { walletBalance: netAmount },
        });
      }
    }
  }

  // 2. Wallet funding — credit the payer's own wallet
  if (payment.type === 'wallet_fund') {
    await User.findByIdAndUpdate(payment.userId, {
      $inc: { walletBalance: payment.amount },
    });
  }

  // 3. Subscription
  if (payment.type === 'subscription') {
    // TODO: activate subscription
  }
};

const updatePropertyOnPayment = async (payment) => {
  if (!payment.propertyId) return;
  if (!['purchase', 'rent', 'reservation'].includes(payment.type)) return;

  const property = await Property.findById(payment.propertyId);
  if (!property) return;

  const isRental = property.listingType === 'for_rent' || property.listingType === 'rent';
  property.status = isRental ? 'rented' : 'sold';
  property.buyer = payment.userId;
  property.soldAt = new Date();
  property.paymentReference = payment.providerReference;

  await property.save();
};

/**
 * @desc    Initialize payment
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

    const timestamp = Date.now();
    const randomStr = Math.random().toString(36).slice(2, 7).toUpperCase();
    const paystackRef = `HV_${type.toUpperCase()}_${timestamp}_${randomStr}`;

    const paystackRes = await fetch(`${PAYSTACK_BASE}/transaction/initialize`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${PAYSTACK_SECRET}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: req.user.email,
        amount: Math.round(amount * 100),
        reference: paystackRef,
        callback_url: `${process.env.FRONTEND_URL}/payments/verify`,
        metadata: {
          user_id: req.user._id.toString(),
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

/**
 * @desc    Verify payment
 * @route   GET /api/payments/verify/:reference
 * @access  Private
 */
const verifyPayment = async (req, res, next) => {
  try {
    const { reference } = req.params;
    const payment = await Payment.findOne({ providerReference: reference, userId: req.user._id });
    if (!payment) return res.status(404).json({ success: false, message: 'Payment not found' });

    // If already processed by webhook, just return
    if (payment.status === 'completed') {
      return res.status(200).json({ success: true, data: payment });
    }

    // Verify with Paystack
    const verifyRes = await fetch(`${PAYSTACK_BASE}/transaction/verify/${reference}`, {
      headers: { Authorization: `Bearer ${PAYSTACK_SECRET}` },
    });
    const verifyData = await verifyRes.json();

    if (verifyData.data?.status === 'success') {
  payment.status = 'completed';
  payment.completedAt = new Date();
  payment.paidAt = verifyData.data.paid_at ? new Date(verifyData.data.paid_at) : new Date();
  payment.channel = verifyData.data.channel;
  payment.currency = verifyData.data.currency;
  await payment.save();

  await processSuccessfulPayment(payment._id);
}

    payment.status = verifyData.data?.status || 'failed';
    await payment.save();
    return res.status(400).json({ success: false, message: `Status: ${payment.status}` });

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
  .populate({
    path: 'propertyId',
    select: 'title images address city state listedBy',
    populate: {
      path: 'listedBy',
      select: 'firstName lastName fullName',
    },
  })
  .sort({ createdAt: -1 });

    const mapped = payments.map((p) => ({
      _id: p._id,
      propertyId: p.propertyId?._id?.toString() || p.propertyId,
      propertyTitle: p.propertyId?.title || p.description || 'Property Transaction',
      propertyImage: p.propertyId?.images?.[0]?.url || null,
      
      amount: p.amount,
      status: p.status,
      type: p.type === 'property_purchase' ? 'purchase' : p.type,
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
        amount: user.walletBalance || 0,
      },
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
  .update(req.body)  // <-- Pass Buffer directly, no JSON.stringify
  .digest('hex');
  if (hash !== req.headers['x-paystack-signature']) {
    return res.sendStatus(400);
  }

  const event = req.body;

   if (event.event === 'charge.success') {
  const reference = event.data.reference;
  
  try {
    const payment = await Payment.findOne({ providerReference: reference });
    if (payment && payment.status !== 'completed') {
      payment.status = 'completed';
      payment.completedAt = new Date();
      await payment.save();
      await processSuccessfulPayment(payment._id);
    }
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