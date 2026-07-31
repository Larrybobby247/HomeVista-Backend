/**
 * HomeVista Backend - Payment Controller
 * Handles payments, wallet, and subscriptions
 */

const Payment = require('../models/Payment');
const User = require('../models/User');
const Property = require('../models/Property');

/**
 * @desc    Initialize payment
 * @route   POST /api/payments/initialize
 * @access  Private
 */
const initializePayment = async (req, res, next) => {
  try {
    const { type, amount, propertyId, method, description } = req.body;

    const payment = await Payment.create({
      userId: req.user._id,
      propertyId,
      type,
      amount,
      method,
      description,
      status: 'pending',
    });

    res.status(201).json({
      success: true,
      message: 'Payment initialized',
      data: payment,
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
    const payment = await Payment.findOne({
      providerReference: req.params.reference,
      userId: req.user._id,
    });

    if (!payment) {
      return res.status(404).json({
        success: false,
        message: 'Payment not found',
      });
    }

    // Update payment status (in production, verify with Paystack)
    payment.status = 'completed';
    payment.completedAt = new Date();
    await payment.save();

    res.status(200).json({
      success: true,
      message: 'Payment verified',
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
      .populate('propertyId', 'title')
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      data: payments,
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
    // Calculate wallet balance from completed payments
    const completed = await Payment.aggregate([
      { $match: { userId: req.user._id, status: 'completed' } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]);

    const balance = completed.length > 0 ? completed[0].total : 0;

    res.status(200).json({
      success: true,
      data: { balance },
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  initializePayment,
  verifyPayment,
  getPaymentHistory,
  getWalletBalance,
};
