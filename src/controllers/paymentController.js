const fetch = require('node-fetch');
const crypto = require('crypto');
const Payment = require('../models/Payment');
const User = require('../models/User');
const Property = require('../models/Property');
const { processSuccessfulPayment } = require('../services/paymentProcessor');

const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY;
const PAYSTACK_BASE = 'https://api.paystack.co';

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

// ─── POST /api/payments/initialize ───
exports.initializePayment = async (req, res, next) => {
  try {
    const { type, amount, propertyId, method, description } = req.body;
    if (!type || !amount || amount <= 0 || !method) {
      return res.status(400).json({ success: false, message: 'type, amount, and method are required' });
    }

    const reference = `HV_${Date.now()}_${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

    const response = await paystackFetch('/transaction/initialize', {
      method: 'POST',
      body: JSON.stringify({
        email: req.user.email,
        amount: Math.round(amount * 100),
        reference,
        callback_url: 'https://standard.paystack.co/close',
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
      return res.status(400).json({ success: false, message: paystackData.message || 'Paystack initialization failed' });
    }

    const payment = await Payment.create({
      userId: req.user._id,
      propertyId: propertyId || null,
      type,
      amount,
      method,
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
};

// ─── GET /api/payments/verify/:reference ───
exports.verifyPayment = async (req, res, next) => {
  try {
    const { reference } = req.params;
    const payment = await Payment.findOne({ providerReference: reference, userId: req.user._id });
    if (!payment) return res.status(404).json({ success: false, message: 'Payment not found' });

    if (payment.status === 'completed' && payment.processedAt) {
      return res.status(200).json({ success: true, message: 'Already verified', data: payment });
    }

    const response = await paystackFetch(`/transaction/verify/${reference}`);
    const verifyData = await response.json();

    if (!verifyData.status) {
      return res.status(400).json({ success: false, message: verifyData.message || 'Verification failed' });
    }

    const tx = verifyData.data;
    if (tx.status === 'success') {
      payment.status = 'completed';
      payment.completedAt = new Date();
      payment.paidAt = tx.paid_at ? new Date(tx.paid_at) : new Date();
      payment.channel = tx.channel;
      payment.currency = tx.currency;
      await payment.save();

      await processSuccessfulPayment(payment._id);

      return res.status(200).json({ success: true, message: 'Payment verified', data: payment });
    }

    payment.status = tx.status || 'failed';
    await payment.save();
    return res.status(400).json({ success: false, message: `Payment ${payment.status}` });
  } catch (error) {
    next(error);
  }
};

// ─── POST /api/payments/webhook ───
// NOTE: server.js uses express.raw() for this route, so req.body is a Buffer
exports.paystackWebhook = async (req, res) => {
  try {
    const hash = crypto
      .createHmac('sha512', PAYSTACK_SECRET)
      .update(req.body) // Buffer from express.raw()
      .digest('hex');

    if (hash !== req.headers['x-paystack-signature']) {
      console.log('Webhook signature mismatch');
      return res.sendStatus(400);
    }

    const event = JSON.parse(req.body);

    if (event.event === 'charge.success') {
      const reference = event.data.reference;
      const payment = await Payment.findOne({ providerReference: reference });

      if (payment && !payment.processedAt) {
        payment.status = 'completed';
        payment.completedAt = new Date();
        payment.providerResponse = event.data;
        payment.method = event.data.channel || 'card';
        await payment.save();

        await processSuccessfulPayment(payment._id);
        console.log(`Webhook processed: ${reference}`);
      } else if (payment?.processedAt) {
        console.log(`Webhook: ${reference} already processed`);
      } else {
        console.log(`Webhook: payment not found for ${reference}`);
      }
    }

    res.sendStatus(200);
  } catch (err) {
    console.error('Webhook error:', err);
    res.sendStatus(200);
  }
};

// ─── GET /api/payments/history ───
exports.getPaymentHistory = async (req, res, next) => {
  try {
    const { type, limit = 50, page = 1, status } = req.query;
    const query = { userId: req.user._id };
    if (status) query.status = status;

    if (type) {
      const typeMap = {
        purchase: ['purchase', 'property_purchase'],
        deposit: ['wallet_fund'],
        rent: ['rent'],
        fee: ['service_charge', 'agency_fee', 'legal_fee', 'caution_fee'],
        payout: ['payout'],
      };
      query.type = typeMap[type] || type;
    }

    const payments = await Payment.find(query)
      .populate({
        path: 'propertyId',
        select: 'title images address city state listedBy status',
        populate: { path: 'listedBy', select: 'firstName lastName fullName email' },
      })
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip((parseInt(page) - 1) * parseInt(limit));

    const mapped = payments.map((p) => {
      const property = p.propertyId;
      const seller = property?.listedBy;
      return {
        _id: p._id,
        propertyId: property?._id?.toString() || p.propertyId?.toString() || '',
        propertyTitle: property?.title || p.description || 'Property Transaction',
        propertyImage: property?.images?.[0]?.url || null,
        amount: p.amount,
        status: p.status,
        type: p.type === 'property_purchase' ? 'purchase' : p.type,
        paymentMethod: p.method || p.channel || 'card',
        createdAt: p.createdAt,
        completedAt: p.completedAt,
        transactionRef: p.providerReference || p._id.toString(),
        sellerName: seller?.fullName || `${seller?.firstName || ''} ${seller?.lastName || ''}`.trim() || 'HomeVista',
        description: p.description,
        currency: p.currency || 'NGN',
        bankName: p.recipientBankDetails?.bankName,
        accountNumber: p.recipientBankDetails?.accountNumber,
        accountName: p.recipientBankDetails?.accountName,
        platformFee: p.platformFee,
      };
    });

    res.status(200).json({ success: true, count: mapped.length, data: mapped });
  } catch (error) {
    next(error);
  }
};

// ─── GET /api/payments/:id ───
exports.getPaymentById = async (req, res, next) => {
  try {
    const payment = await Payment.findOne({
      _id: req.params.id,
      userId: req.user._id,
    }).populate({
      path: 'propertyId',
      select: 'title images address city state listedBy',
      populate: { path: 'listedBy', select: 'firstName lastName fullName' },
    });

    if (!payment) return res.status(404).json({ success: false, message: 'Payment not found' });

    const property = payment.propertyId;
    const seller = property?.listedBy;

    res.status(200).json({
      success: true,
      data: {
        _id: payment._id,
        propertyId: property?._id?.toString() || '',
        propertyTitle: property?.title || payment.description || 'Property Transaction',
        propertyImage: property?.images?.[0]?.url || null,
        amount: payment.amount,
        status: payment.status,
        type: payment.type === 'property_purchase' ? 'purchase' : payment.type,
        paymentMethod: payment.method || payment.channel || 'card',
        createdAt: payment.createdAt,
        completedAt: payment.completedAt,
        transactionRef: payment.providerReference || payment._id.toString(),
        sellerName: seller?.fullName || 'HomeVista',
        description: payment.description,
        currency: payment.currency || 'NGN',
      },
    });
  } catch (error) {
    next(error);
  }
};

// ─── GET /api/payments/wallet/balance ───
exports.getWalletBalance = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id).select('walletBalance');
    res.status(200).json({ success: true, data: { balance: user?.walletBalance || 0 } });
  } catch (error) {
    next(error);
  }
};

// ─── GET /api/payments/wallet/transactions ───
exports.getWalletTransactions = async (req, res, next) => {
  try {
    const transactions = await Payment.find({
      userId: req.user._id,
      $or: [{ type: 'wallet_fund' }, { type: 'payout' }, { method: 'wallet' }],
    }).sort({ createdAt: -1 });
    res.status(200).json({ success: true, data: transactions });
  } catch (error) {
    next(error);
  }
};

// ─── POST /api/payments/payouts ───
exports.requestPayout = async (req, res, next) => {
  try {
    const { amount, netAmount, platformFee, bankName, accountNumber, accountName, currency } = req.body;
    const userId = req.user._id;

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    const availableBalance = user.walletBalance || 0;
    if (availableBalance < amount) {
      return res.status(400).json({
        success: false,
        message: `Insufficient balance. Available: ${availableBalance}, Requested: ${amount}`,
      });
    }

    const payout = await Payment.create({
      userId,
      recipientId: userId,
      type: 'payout',
      amount,
      netAmount,
      platformFee,
      status: 'pending',
      method: 'bank_transfer',
      description: `Payout to ${bankName} ••••${accountNumber.slice(-4)}`,
      currency: currency || 'NGN',
      recipientBankDetails: { bankName, accountNumber, accountName },
    });

    res.status(201).json({ success: true, data: payout });
  } catch (error) {
    next(error);
  }
};