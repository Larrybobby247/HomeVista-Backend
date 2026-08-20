/**
 * HomeVista - Payment Routes (Paystack Integrated)
 */

const express = require("express");
const router = express.Router();
const fetch = require("node-fetch");
const crypto = require("crypto");
const { protect } = require("../middleware/auth");
const Payment = require("../models/Payment");
const User = require("../models/User");
const Property = require("../models/Property");

const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY;
const PAYSTACK_BASE = "https://api.paystack.co";

// routes/payment.js or server.js
const { Resend } = require('resend');
const resend = new Resend(process.env.RESEND_API_KEY);

// ─────────────────────────────────────────────────────────────────
// HELPER: Call Paystack API
// ─────────────────────────────────────────────────────────────────
const paystackFetch = (endpoint, options = {}) => {
  return fetch(`${PAYSTACK_BASE}${endpoint}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${PAYSTACK_SECRET}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
};

// ─────────────────────────────────────────────────────────────────
// POST /api/payments/initialize
// ─────────────────────────────────────────────────────────────────
router.post("/initialize", protect, async (req, res, next) => {
  try {
    const { type, amount, propertyId, method, description } = req.body;

    if (!type || !amount || amount <= 0 || !method) {
      return res.status(400).json({
        success: false,
        message: "type, amount, and method are required",
      });
    }

    // Generate unique reference
    const reference = `HV_${Date.now()}_${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

    // Initialize with Paystack
    const response = await paystackFetch("/transaction/initialize", {
      method: "POST",
      body: JSON.stringify({
        email: req.user.email,
        amount: Math.round(amount * 100),
        reference,
        callback_url: "https://standard.paystack.co/close",
        metadata: {
          user_id: req.user._id.toString(),
          property_id: propertyId || null,
          payment_type: type,
          custom_fields: [
            {
              display_name: "Payment Type",
              variable_name: "payment_type",
              value: type,
            },
            {
              display_name: "User Email",
              variable_name: "user_email",
              value: req.user.email,
            },
            ...(propertyId
              ? [
                  {
                    display_name: "Property ID",
                    variable_name: "property_id",
                    value: propertyId,
                  },
                ]
              : []),
          ],
        },
      }),
    });

    const paystackData = await response.json();

    if (!paystackData.status) {
      return res.status(400).json({
        success: false,
        message: paystackData.message || "Paystack initialization failed",
      });
    }

    // Save payment record
    const payment = await Payment.create({
      userId: req.user._id,
      propertyId: propertyId || null,
      type,
      amount,
      method,
      description: description || `${type} payment`,
      status: "pending",
      providerReference: reference,
      currency: "NGN",
    });

    res.status(201).json({
      success: true,
      message: "Payment initialized",
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
router.get("/verify/:reference", protect, async (req, res, next) => {
  try {
    const { reference } = req.params;

    const payment = await Payment.findOne({
      providerReference: reference,
      userId: req.user._id,
    });

    if (!payment) {
      return res.status(404).json({
        success: false,
        message: "Payment not found",
      });
    }

    // Already completed? Return early
    if (payment.status === "completed") {
      return res.status(200).json({
        success: true,
        message: "Payment already verified",
        data: payment,
      });
    }

    // Verify with Paystack
    const response = await paystackFetch(`/transaction/verify/${reference}`);
    const verifyData = await response.json();

    if (!verifyData.status) {
      return res.status(400).json({
        success: false,
        message: verifyData.message || "Paystack verification failed",
      });
    }

    const tx = verifyData.data;

    // Map Paystack status to your schema
    let newStatus = "pending";
    if (tx.status === "success") newStatus = "completed";
    else if (tx.status === "failed") newStatus = "failed";
    else if (tx.status === "abandoned") newStatus = "cancelled";
    else newStatus = "processing";

    // Update payment record
    payment.status = newStatus;
    payment.providerResponse = tx;
    if (tx.channel) payment.method = tx.channel;
    if (newStatus === "completed") payment.completedAt = new Date();
    await payment.save();

    // ─── BUSINESS LOGIC ON SUCCESS ───
    if (newStatus === "completed") {
      // Property purchase / reservation / rent
      if (
        payment.propertyId &&
        ["reservation", "rent", "purchase"].includes(payment.type)
      ) {
        const property = await Property.findById(payment.propertyId);
        if (property) {
          // Determine correct status: rented for rentals, sold for sales
          const isRental =
            payment.type === "rent" || property.status === "for_rent";
          property.status = isRental ? "rented" : "sold";
          property.buyer = payment.userId;
          property.soldAt = new Date();
          await property.save();
        }
      }

      // Wallet funding
      if (payment.type === "wallet_fund") {
        await User.findByIdAndUpdate(req.user._id, {
          $inc: { walletBalance: payment.amount },
        });
      }

      // Subscription activation
      if (payment.type === "subscription") {
        // TODO: activate user subscription
      }
    }

    res.status(200).json({
      success: true,
      message:
        newStatus === "completed"
          ? "Payment verified successfully"
          : `Payment ${newStatus}`,
      data: payment,
    });
  } catch (error) {
    next(error);
  }
});

// ─────────────────────────────────────────────────────────────────
// GET /api/payments/history
// ─────────────────────────────────────────────────────────────────
router.get("/history", protect, async (req, res, next) => {
  try {
    const { type, limit = 50, page = 1, status } = req.query;

    const query = { userId: req.user._id };
    if (status) query.status = status;

    if (type) {
      const typeMap = {
  purchase: ["purchase", "property_purchase"],
  deposit: ["wallet_fund"],
  rent: ["rent"],
  fee: ["service_charge", "agency_fee", "legal_fee", "caution_fee"],
  payout: ["payout"],
};
      query.type = typeMap[type] || type;
    }

    const payments = await Payment.find(query)
      .populate({
        path: "propertyId",
        select: "title images address city state listedBy status",
        populate: {
          path: "listedBy",
          select: "firstName lastName fullName email",
        },
      })
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip((parseInt(page) - 1) * parseInt(limit));

    const mapped = payments.map((p) => {
      const property = p.propertyId;
      const seller = property?.listedBy;

      return {
  _id: p._id,
  propertyId: property?._id?.toString() || p.propertyId?.toString() || "",
  propertyTitle: property?.title || p.description || "Property Transaction",
  propertyImage: property?.images?.[0]?.url || null,
  amount: p.amount,
  status: p.status,
  type: p.type === "property_purchase" ? "purchase" : p.type,
  paymentMethod: p.method || p.channel || "card",
  createdAt: p.createdAt,
  completedAt: p.completedAt,
  transactionRef: p.providerReference || p._id.toString(),
  sellerName: seller?.fullName || `${seller?.firstName || ""} ${seller?.lastName || ""}`.trim() || "HomeVista",
  description: p.description,
  currency: p.currency || "NGN",
  
  // ADD THESE for payouts
  bankName: p.recipientBankDetails?.bankName,
  accountNumber: p.recipientBankDetails?.accountNumber,
  accountName: p.recipientBankDetails?.accountName,
  platformFee: p.platformFee,
};
    });

    res.status(200).json({
      success: true,
      count: mapped.length,
      data: mapped,
    });
  } catch (error) {
    next(error);
  }
});

// ─────────────────────────────────────────────────────────────────
// GET /api/payments/:id
// ─────────────────────────────────────────────────────────────────
router.get("/:id", protect, async (req, res, next) => {
  try {
    const payment = await Payment.findOne({
      _id: req.params.id,
      userId: req.user._id,
    }).populate({
      path: "propertyId",
      select: "title images address city state listedBy",
      populate: { path: "listedBy", select: "firstName lastName fullName" },
    });

    if (!payment) {
      return res
        .status(404)
        .json({ success: false, message: "Payment not found" });
    }

    const property = payment.propertyId;
    const seller = property?.listedBy;

    const mapped = {
      _id: payment._id,
      propertyId: property?._id?.toString() || "",
      propertyTitle:
        property?.title || payment.description || "Property Transaction",
      propertyImage: property?.images?.[0]?.url || null,
      amount: payment.amount,
      status: payment.status,
      type: payment.type === "property_purchase" ? "purchase" : payment.type,
      paymentMethod: payment.method || payment.channel || "card",
      createdAt: payment.createdAt,
      completedAt: payment.completedAt,
      transactionRef: payment.providerReference || payment._id.toString(),
      sellerName: seller?.fullName || "HomeVista",
      description: payment.description,
      currency: payment.currency || "NGN",
    };

    res.status(200).json({ success: true, data: mapped });
  } catch (error) {
    next(error);
  }
});

// ─────────────────────────────────────────────────────────────────
// GET /api/payments/wallet/balance
// ─────────────────────────────────────────────────────────────────
router.get("/wallet/balance", protect, async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id).select("walletBalance");
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
router.get("/wallet/transactions", protect, async (req, res, next) => {
  try {
    const transactions = await Payment.find({
      userId: req.user._id,
      $or: [{ type: "wallet_fund" }, { method: "wallet" }],
    }).sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      data: transactions,
    });
  } catch (error) {
    next(error);
  }
});



router.post('/payouts', protect, async (req, res, next) => {
  try {
    const { amount, netAmount, platformFee, bankName, accountNumber, accountName, currency } = req.body;

    const payout = await Payment.create({
      userId: req.user._id,           // who requested it
      recipientId: req.user._id,      // who receives it (same person)
      type: 'payout',
      amount: netAmount,              // what seller receives
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

    res.status(201).json({
      success: true,
      data: payout,
    });
  } catch (error) {
    next(error);
  }
});

// ─────────────────────────────────────────────────────────────────
// POST /api/payments/wallet/fund
// ─────────────────────────────────────────────────────────────────
router.post("/wallet/fund", protect, async (req, res, next) => {
  try {
    const { amount, method } = req.body;
    res.status(200).json({
      success: true,
      message: "Use POST /payments/initialize with type=wallet_fund",
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
router.post("/webhook", async (req, res) => {
  const hash = crypto
    .createHmac("sha512", PAYSTACK_SECRET)
    .update(JSON.stringify(req.body))
    .digest("hex");

  if (hash !== req.headers["x-paystack-signature"]) {
    return res.sendStatus(400);
  }

  const event = req.body;

  if (event.event === "charge.success") {
    const tx = event.data;
    const reference = tx.reference;

    try {
      const payment = await Payment.findOneAndUpdate(
        { providerReference: reference, status: { $ne: "completed" } },
        {
          $set: {
            status: "completed",
            completedAt: new Date(),
            providerResponse: tx,
            method: tx.channel || "card",
          },
        },
        { new: true },
      );

      if (payment) {
        // ─── UPDATE PROPERTY STATUS (FIXED: was commented out) ───
        if (
          payment.propertyId &&
          ["reservation", "rent", "purchase"].includes(payment.type)
        ) {
          const property = await Property.findById(payment.propertyId);
          if (
            property &&
            property.status !== "sold" &&
            property.status !== "rented"
          ) {
            const isRental =
              payment.type === "rent" || property.status === "for_rent";
            property.status = isRental ? "rented" : "sold";
            property.buyer = payment.userId;
            property.soldAt = new Date();
            await property.save();
          }
        }

        // Wallet funding
        if (payment.type === "wallet_fund") {
          await User.findByIdAndUpdate(payment.userId, {
            $inc: { walletBalance: payment.amount },
          });
        }

        console.log(
          `Webhook: Payment ${reference} marked completed, property updated`,
        );
      }
    } catch (err) {
      console.error("Webhook error:", err);
    }
  }

  res.sendStatus(200);
});

// Temporary callback page so WebView doesn't crash on deep links
router.get("/callback-page", (req, res) => {
  const ref = req.query.reference || req.query.trxref || "";
  res.send(`
    <!DOCTYPE html>
    <html>
      <head><meta name="viewport" content="width=device-width, initial-scale=1"></head>
    </html>`);
});



router.post('/send-payout-email', async (req, res) => {
  const { subject, body } = req.body;

  try {
    const { data, error } = await resend.emails.send({
  from: process.env.FROM_EMAIL,
  to: process.env.COMPANY_EMAIL,
  subject,
  html: `
    <h2>New Payout Request</h2>
    <table style="font-family: sans-serif; line-height: 1.6;">
      <tr><td><strong>Seller</strong></td><td>${displayName}</td></tr>
      <tr><td><strong>Amount</strong></td><td>${formatCurrency(payoutSummary.amount)}</td></tr>
      <tr><td><strong>Platform Fee (3%)</strong></td><td>${formatCurrency(payoutSummary.platformFee)}</td></tr>
      <tr><td><strong>Net Payout</strong></td><td style="color: green;"><strong>${formatCurrency(payoutSummary.netAmount)}</strong></td></tr>
      <tr><td><strong>Bank</strong></td><td>${payoutSummary.bankName}</td></tr>
      <tr><td><strong>Account Name</strong></td><td>${payoutSummary.accountName}</td></tr>
      <tr><td><strong>Account Number</strong></td><td>${payoutSummary.accountNumber}</td></tr>
    </table>
  `,
});

    if (error) {
      console.error('Resend error:', error);
      return res.status(500).json({ success: false, message: error.message });
    }

    res.json({ success: true, id: data?.id });
  } catch (err) {
    console.error('Email send failed:', err);
    res.status(500).json({ success: false, message: 'Email service failed' });
  }
});

module.exports = router;
