const fetch = require('node-fetch');
const crypto = require('crypto');
const Payment = require('../models/Payment');
const User = require('../models/User');
const Property = require('../models/Property');
const { processSuccessfulPayment } = require('../services/paymentProcessor');
const { sendPaymentRequest } = require('../utils/email');
const { notify } = require('../services/notificationService');

// Platform commission taken from every sale/rent (percentage of the property price)
const COMMISSION_PERCENT = Number(process.env.PLATFORM_COMMISSION_PERCENT || 5);
const SALE_TYPES = ['purchase', 'rent', 'reservation'];
const UNAVAILABLE = ['sold', 'rented', 'reserved'];

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

// Work out what the seller receives once Paystack's fee and our commission are removed
const recordSplit = (payment, tx) => {
  if (!payment.settledBySplit) return;
  const paystackFee = (tx.fees || 0) / 100;
  payment.paystackFee = paystackFee;
  payment.platformFee = paystackFee;
  payment.sellerAmount = Math.max(0, payment.amount - (payment.commissionAmount || 0) - paystackFee);
};

// ─── POST /api/payments/initialize ───
exports.initializePayment = async (req, res, next) => {
  try {
    const { type, propertyId, method, description } = req.body;
    let amount = Number(req.body.amount);
    if (!type || !method || (!SALE_TYPES.includes(type) && !(amount > 0))) {
      return res.status(400).json({ success: false, message: 'type, amount, and method are required' });
    }

    const reference = `HV_${Date.now()}_${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    const paystackBody = {
      email: req.user.email,
      reference,
      callback_url: 'https://standard.paystack.co/close',
    };
    const paymentExtra = {};
    let sellerId;

    // ── Property sale / rent: Paystack splits the money automatically ──
    if (SALE_TYPES.includes(type)) {
      if (!propertyId) return res.status(400).json({ success: false, message: 'propertyId is required' });

      const property = await Property.findById(propertyId);
      if (!property || property.verificationStatus !== 'verified') {
        return res.status(404).json({ success: false, message: 'Property not found' });
      }
      if (UNAVAILABLE.includes(property.status)) {
        return res.status(400).json({ success: false, message: 'This property is no longer available' });
      }
      if (String(property.listedBy) === String(req.user._id)) {
        return res.status(400).json({ success: false, message: 'You cannot buy your own listing' });
      }

      const seller = await User.findById(property.listedBy);
      if (!seller?.paystackSubaccountCode) {
        notify(seller?._id, {
          type: 'payout_setup_needed',
          title: 'A buyer is ready to pay you',
          message: `Someone tried to pay for "${property.title}" but you haven't added your bank account. Add it in Settings → Payout account so you can get paid automatically.`,
          data: { propertyId: String(property._id), screen: 'bank_setup' },
        });
        return res.status(400).json({
          success: false,
          message: 'The seller has not finished setting up their payout account yet. Please try again shortly.',
        });
      }

      // The price always comes from the listing, never from the client
      amount = property.price;
      const commission = Math.round((amount * COMMISSION_PERCENT) / 100);

      paystackBody.subaccount = seller.paystackSubaccountCode;
      // Flat amount (kobo) that stays with HomeVista; everything else goes to the seller.
      paystackBody.transaction_charge = commission * 100;
      // The seller also bears the Paystack transaction fee, so it is deducted from their share
      paystackBody.bearer = 'subaccount';

      sellerId = seller._id;
      Object.assign(paymentExtra, {
        sellerId: seller._id,
        recipientId: seller._id,
        subaccountCode: seller.paystackSubaccountCode,
        commissionAmount: commission,
        settledBySplit: true,
      });
    }

    paystackBody.amount = Math.round(amount * 100);
    paystackBody.metadata = {
      user_id: req.user._id.toString(),
      property_id: propertyId || null,
      payment_type: type,
      custom_fields: [
        { display_name: 'Payment Type', variable_name: 'payment_type', value: type },
        { display_name: 'User Email', variable_name: 'user_email', value: req.user.email },
        ...(propertyId ? [{ display_name: 'Property ID', variable_name: 'property_id', value: propertyId }] : []),
      ],
    };

    const response = await paystackFetch('/transaction/initialize', {
      method: 'POST',
      body: JSON.stringify(paystackBody),
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
      ...paymentExtra,
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
      recordSplit(payment, tx);
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
        payment.channel = event.data.channel;
        payment.paidAt = event.data.paid_at ? new Date(event.data.paid_at) : new Date();
        recordSplit(payment, event.data);
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
        populate: { path: 'listedBy', select: 'firstName lastName email companyName' },
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
        sellerName: seller?.displayName || 'HomeVista',
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
      populate: { path: 'listedBy', select: 'firstName lastName companyName' },
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
        sellerName: seller?.displayName || 'HomeVista',
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
    const {
      amount,
      netAmount,
      platformFee,
      bankName,
      accountNumber,
      accountName,
      currency,
    } = req.body;

    const userId = req.user._id;

    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    const availableBalance = user.walletBalance || 0;

    if (availableBalance < amount) {
      return res.status(400).json({
        success: false,
        message: `Insufficient balance. Available: ${availableBalance}, Requested: ${amount}`,
      });
    }

    // Create payout request
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
      recipientBankDetails: {
        bankName,
        accountNumber,
        accountName,
      },
    });

    // ============================================
    // NOTIFY HOMEVISTA BUSINESS
    // ============================================

    try {
      await sendPaymentRequest({
        email: process.env.ADMIN_EMAIL,

        firstName: 'HomeVista Admin',

        amount: amount,

        description: `Payout request from ${user.firstName} ${user.lastName}`,

        reference: payout._id.toString(),

        // You can later replace this with your admin dashboard URL
        paymentLink: null,
      });

      console.log(
        `📧 Payout notification sent to ${process.env.ADMIN_EMAIL}`
      );
    } catch (emailError) {
      // Don't fail the payout request just because the email failed
      console.error(
        'Failed to send payout notification email:',
        emailError
      );
    }

    return res.status(201).json({
      success: true,
      message: 'Payout request submitted successfully',
      data: payout,
    });

  } catch (error) {
    next(error);
  }
};


// ============================================
// PAYOUT ACCOUNT (Paystack subaccount)
// ============================================

// ─── GET /api/payments/banks ───
let banksCache = { at: 0, data: [] };
exports.getBanks = async (req, res, next) => {
  try {
    if (banksCache.data.length && Date.now() - banksCache.at < 6 * 60 * 60 * 1000) {
      return res.status(200).json({ success: true, data: banksCache.data });
    }
    const response = await paystackFetch('/bank?country=nigeria&currency=NGN&perPage=200&use_cursor=false');
    const json = await response.json();
    if (!json.status) return res.status(502).json({ success: false, message: json.message || 'Could not load banks' });
    const data = json.data
      .filter((b) => b.active && !b.is_deleted)
      .map((b) => ({ name: b.name, code: b.code }))
      .sort((a, b) => a.name.localeCompare(b.name));
    banksCache = { at: Date.now(), data };
    res.status(200).json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

// ─── POST /api/payments/bank/verify ───  (resolve account name without saving)
exports.verifyBankAccount = async (req, res, next) => {
  try {
    const { accountNumber, bankCode } = req.body;
    if (!/^\d{10}$/.test(String(accountNumber || '')) || !bankCode) {
      return res.status(400).json({ success: false, message: 'Enter a 10-digit account number and choose a bank' });
    }
    const response = await paystackFetch(
      `/bank/resolve?account_number=${encodeURIComponent(accountNumber)}&bank_code=${encodeURIComponent(bankCode)}`
    );
    const json = await response.json();
    if (!json.status) {
      return res.status(400).json({ success: false, message: json.message || 'We could not verify this account' });
    }
    res.status(200).json({ success: true, data: { accountName: json.data.account_name, accountNumber } });
  } catch (error) {
    next(error);
  }
};

// ─── GET /api/payments/bank ───  (current payout account)
exports.getPayoutAccount = async (req, res, next) => {
  try {
    const u = req.user;
    res.status(200).json({
      success: true,
      data: {
        isSetUp: !!u.paystackSubaccountCode && u.bankVerified,
        bankName: u.bankName || null,
        bankCode: u.bankCode || null,
        accountNumberLast4: u.accountNumber ? u.accountNumber.slice(-4) : null,
        accountName: u.accountName || null,
        commissionPercent: COMMISSION_PERCENT,
      },
    });
  } catch (error) {
    next(error);
  }
};

// ─── POST /api/payments/bank/setup ───
// Verifies the account with Paystack, then creates (or updates) the user's subaccount.
exports.setupPayoutAccount = async (req, res, next) => {
  try {
    const { accountNumber, bankCode, bankName } = req.body;
    if (!/^\d{10}$/.test(String(accountNumber || '')) || !bankCode) {
      return res.status(400).json({ success: false, message: 'Enter a 10-digit account number and choose a bank' });
    }

    // 1. Verify the account really exists and get the registered name from the bank
    const resolveRes = await paystackFetch(
      `/bank/resolve?account_number=${encodeURIComponent(accountNumber)}&bank_code=${encodeURIComponent(bankCode)}`
    );
    const resolved = await resolveRes.json();
    if (!resolved.status) {
      return res.status(400).json({ success: false, message: resolved.message || 'We could not verify this account' });
    }
    const accountName = resolved.data.account_name;

    // 2. Create or update the Paystack subaccount (this is where sale money is settled)
    const user = await User.findById(req.user._id);
    const businessName = (user.companyName && user.companyName.trim()) || `${user.firstName} ${user.lastName}`;
    const payload = {
      business_name: businessName,
      settlement_bank: bankCode,
      account_number: accountNumber,
      percentage_charge: COMMISSION_PERCENT,
      primary_contact_email: user.email,
      primary_contact_name: `${user.firstName} ${user.lastName}`,
      primary_contact_phone: user.phoneNumber,
      description: `HomeVista seller ${user._id}`,
    };

    const subRes = user.paystackSubaccountCode
      ? await paystackFetch(`/subaccount/${user.paystackSubaccountCode}`, { method: 'PUT', body: JSON.stringify(payload) })
      : await paystackFetch('/subaccount', { method: 'POST', body: JSON.stringify(payload) });
    const sub = await subRes.json();
    if (!sub.status) {
      return res.status(400).json({ success: false, message: sub.message || 'Could not set up your payout account' });
    }

    user.bankName = bankName || resolved.data.bank_name || user.bankName;
    user.bankCode = bankCode;
    user.accountNumber = accountNumber;
    user.accountName = accountName;
    user.paystackSubaccountCode = sub.data.subaccount_code;
    user.bankVerified = true;
    await user.save();

    res.status(200).json({
      success: true,
      message: 'Payout account verified and connected',
      data: {
        isSetUp: true,
        bankName: user.bankName,
        accountNumberLast4: accountNumber.slice(-4),
        accountName,
        commissionPercent: COMMISSION_PERCENT,
      },
    });
  } catch (error) {
    next(error);
  }
};

// ============================================
// RECEIPT
// ============================================

// ─── GET /api/payments/:id/receipt ───  (buyer or seller of the payment)
exports.getReceipt = async (req, res, next) => {
  try {
    const payment = await Payment.findById(req.params.id).populate({
      path: 'propertyId',
      select: 'title address city state price listedBy images',
    });
    if (!payment) return res.status(404).json({ success: false, message: 'Payment not found' });

    const property = payment.propertyId;
    const isBuyer = String(payment.userId) === String(req.user._id);
    const isSeller =
      String(payment.sellerId || '') === String(req.user._id) ||
      String(property?.listedBy || '') === String(req.user._id);
    if (!isBuyer && !isSeller && req.user.role !== 'super_admin') {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }
    if (payment.status !== 'completed') {
      return res.status(400).json({ success: false, message: 'A receipt is only available for completed payments' });
    }

    const [buyer, seller] = await Promise.all([
      User.findById(payment.userId).select('firstName lastName email phoneNumber companyName'),
      User.findById(payment.sellerId || property?.listedBy).select('firstName lastName email phoneNumber companyName'),
    ]);

    const showBreakdown = isSeller || req.user.role === 'super_admin';
    res.status(200).json({
      success: true,
      data: {
        receiptNumber: `HV-${(payment.providerReference || String(payment._id)).replace(/^HV_/, '')}`,
        reference: payment.providerReference || String(payment._id),
        status: payment.status,
        type: payment.type,
        description: payment.description,
        currency: payment.currency || 'NGN',
        amount: payment.amount,
        paymentMethod: payment.channel || payment.method,
        paidAt: payment.paidAt || payment.completedAt || payment.createdAt,
        property: property
          ? { title: property.title, address: [property.address, property.city, property.state].filter(Boolean).join(', ') }
          : null,
        buyer: buyer && { name: `${buyer.firstName} ${buyer.lastName}`, email: buyer.email, phone: buyer.phoneNumber },
        seller: seller && {
          name: (seller.companyName && seller.companyName.trim()) || `${seller.firstName} ${seller.lastName}`,
          email: seller.email,
          phone: seller.phoneNumber,
        },
        viewerRole: isBuyer ? 'buyer' : 'seller',
        // Only the seller sees how the money was split
        breakdown: showBreakdown && payment.settledBySplit
          ? {
              commission: payment.commissionAmount,
              transactionFee: payment.paystackFee,
              sellerReceives: payment.sellerAmount,
            }
          : null,
      },
    });
  } catch (error) {
    next(error);
  }
};
