/**
 * HomeVista - Payment Routes (Paystack Integrated)
 */

const express = require('express');
const router = express.Router();
const fetch = require('node-fetch'); // npm install node-fetch@2
const crypto = require('crypto');
const { protect } = require('../middleware/auth');
const Payment = require('../models/Payment');
const User = require('../models/User');
const Property = require('../models/Property');

const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY;
const PAYSTACK_BASE = 'https://api.paystack.co';

// ─────────────────────────────────────────────────────────────────
// HELPER: Call Paystack API
// ─────────────────────────────────────────────────────────────────
const paystackFetch = (endpoint, options = {}) => {
  return fetch(`${PAYSTACK_BASE}${endpoint}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${PAYSTACK_SECRET}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
};

// ─────────────────────────────────────────────────────────────────
// POST /api/payments/initialize
// ─────────────────────────────────────────────────────────────────
router.post('/initialize', protect, async (req, res, next) => {
  try {
    const { type, amount, propertyId, method, description } = req.body;

    if (!type || !amount || amount <= 0 || !method) {
      return res.status(400).json({
        success: false,
        message: 'type, amount, and method are required',
      });
    }

    // Generate unique reference
    const reference = `HV_${Date.now()}_${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

    // Initialize with Paystack
    const response = await paystackFetch('/transaction/initialize', {
      method: 'POST',
      body: JSON.stringify({
        email: req.user.email,
        amount: Math.round(amount * 100), // kobo
        reference,
        callback_url: `${process.env.API_URL}/api/payments/callback-page`,
        metadata: {
          user_id: req.user._id.toString(),
          property_id: propertyId || null,
          payment_type: type,
          custom_fields: [
            { display_name: 'Payment Type', variable_name: 'payment_type', value: type },
            { display_name: 'User Email', variable_name: 'user_email', value: req.user.email },
            ...(propertyId ? [{ display_name: 'Property ID', variable_name: 'property_id', value: propertyId }] : []),
          ],
        },
      }),
    });

    const paystackData = await response.json();

    if (!paystackData.status) {
      return res.status(400).json({
        success: false,
        message: paystackData.message || 'Paystack initialization failed',
      });
    }

    // Save payment record
    const payment = await Payment.create({
      userId: req.user._id,
      propertyId: propertyId || null,
      type,
      amount,
      method, // 'card', 'bank_transfer', etc. (user's choice / default)
      description: description || `${type} payment`,
      status: 'pending',
      providerReference: reference,
      currency: 'NGN',
    });

    res.status(201).json({
      success: true,
      message: 'Payment initialized',
      data: {
        payment,
        authorization_url: paystackData.data.authorization_url,
        access_code: paystackData.data.access_code,
        reference,
      },
    });
  } catch (error) {
    next(error);
  }
});

// ─────────────────────────────────────────────────────────────────
// GET /api/payments/verify/:reference
// ─────────────────────────────────────────────────────────────────
router.get('/verify/:reference', protect, async (req, res, next) => {
  try {
    const { reference } = req.params;

    const payment = await Payment.findOne({
      providerReference: reference,
      userId: req.user._id,
    });

    if (!payment) {
      return res.status(404).json({
        success: false,
        message: 'Payment not found',
      });
    }

    // Already completed? Return early
    if (payment.status === 'completed') {
      return res.status(200).json({
        success: true,
        message: 'Payment already verified',
        data: payment,
      });
    }

    // Verify with Paystack
    const response = await paystackFetch(`/transaction/verify/${reference}`);
    const verifyData = await response.json();

    if (!verifyData.status) {
      return res.status(400).json({
        success: false,
        message: verifyData.message || 'Paystack verification failed',
      });
    }

    const tx = verifyData.data;

    // Map Paystack status to your schema
    let newStatus = 'pending';
    if (tx.status === 'success') newStatus = 'completed';
    else if (tx.status === 'failed') newStatus = 'failed';
    else if (tx.status === 'abandoned') newStatus = 'cancelled';
    else newStatus = 'processing';

    // Update payment record
    payment.status = newStatus;
    payment.providerResponse = tx;
    if (tx.channel) payment.method = tx.channel; // Paystack tells us actual method used
    if (newStatus === 'completed') payment.completedAt = new Date();
    await payment.save();

    // ─── BUSINESS LOGIC ON SUCCESS ───
    if (newStatus === 'completed') {
      // Property purchase / reservation
      if (payment.propertyId && ['reservation', 'rent', 'purchase'].includes(payment.type)) {
        // Example: mark property as reserved/sold
        // await Property.findByIdAndUpdate(payment.propertyId, {
        //   $set: { status: payment.type === 'purchase' ? 'sold' : 'reserved' }
        // });
      }

      // Wallet funding
      if (payment.type === 'wallet_fund') {
        await User.findByIdAndUpdate(req.user._id, {
          $inc: { walletBalance: payment.amount },
        });
      }

      // Subscription activation
      if (payment.type === 'subscription') {
        // TODO: activate user subscription
      }
    }

    res.status(200).json({
      success: true,
      message: newStatus === 'completed' ? 'Payment verified successfully' : `Payment ${newStatus}`,
      data: payment,
    });
  } catch (error) {
    next(error);
  }
});

// ─────────────────────────────────────────────────────────────────
// GET /api/payments/history
// ─────────────────────────────────────────────────────────────────
router.get('/history', protect, async (req, res, next) => {
  try {
    const payments = await Payment.find({ userId: req.user._id })
      .populate('propertyId', 'title images address city')
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      data: payments,
    });
  } catch (error) {
    next(error);
  }
});

// ─────────────────────────────────────────────────────────────────
// GET /api/payments/:id
// ─────────────────────────────────────────────────────────────────
router.get('/:id', protect, async (req, res, next) => {
  try {
    const payment = await Payment.findOne({
      _id: req.params.id,
      userId: req.user._id,
    }).populate('propertyId', 'title images address city');

    if (!payment) {
      return res.status(404).json({ success: false, message: 'Payment not found' });
    }

    res.status(200).json({ success: true, data: payment });
  } catch (error) {
    next(error);
  }
});

// ─────────────────────────────────────────────────────────────────
// GET /api/payments/wallet/balance
// ─────────────────────────────────────────────────────────────────
router.get('/wallet/balance', protect, async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id).select('walletBalance');
    res.status(200).json({
      success: true,
      data: { balance: user?.walletBalance || 0 },
    });
  } catch (error) {
    next(error);
  }
});

// ─────────────────────────────────────────────────────────────────
// GET /api/payments/wallet/transactions
// ─────────────────────────────────────────────────────────────────
router.get('/wallet/transactions', protect, async (req, res, next) => {
  try {
    const transactions = await Payment.find({
      userId: req.user._id,
      $or: [{ type: 'wallet_fund' }, { method: 'wallet' }],
    }).sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      data: transactions,
    });
  } catch (error) {
    next(error);
  }
});

// ─────────────────────────────────────────────────────────────────
// POST /api/payments/wallet/fund
// ─────────────────────────────────────────────────────────────────
router.post('/wallet/fund', protect, async (req, res, next) => {
  try {
    const { amount, method } = req.body;
    // Reuse initialize logic — frontend should call /initialize with type='wallet_fund'
    // This endpoint is here for API completeness
    res.status(200).json({
      success: true,
      message: 'Use POST /payments/initialize with type=wallet_fund',
      data: { amount, method },
    });
  } catch (error) {
    next(error);
  }
});

// ─────────────────────────────────────────────────────────────────
// PAYSTACK WEBHOOK
// Must be mounted in app.js BEFORE express.json() with raw body parser
// ─────────────────────────────────────────────────────────────────
router.post('/webhook', async (req, res) => {
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
            providerResponse: tx,
            method: tx.channel || 'card',
          },
        },
        { new: true }
      );

      if (payment) {
        // Apply business logic asynchronously
        if (payment.type === 'wallet_fund') {
          await User.findByIdAndUpdate(payment.userId, {
            $inc: { walletBalance: payment.amount },
          });
        }
        if (payment.propertyId && ['reservation', 'rent', 'purchase'].includes(payment.type)) {
          // await Property.findByIdAndUpdate(payment.propertyId, { ... });
        }
        console.log(`Webhook: Payment ${reference} marked completed`);
      }
    } catch (err) {
      console.error('Webhook error:', err);
    }
  }

  res.sendStatus(200);
});

module.exports = router;