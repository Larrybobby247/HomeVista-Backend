/**
 * HomeVista - Payment Routes
 */

const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const Payment = require('../models/Payment');

router.post('/initialize', protect, async (req, res, next) => {
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

    res.status(201).json({ success: true, data: payment });
  } catch (error) {
    next(error);
  }
});

router.get('/verify/:reference', protect, async (req, res, next) => {
  try {
    const payment = await Payment.findOne({ providerReference: req.params.reference });
    if (!payment) {
      return res.status(404).json({ success: false, message: 'Payment not found' });
    }
    res.status(200).json({ success: true, data: payment });
  } catch (error) {
    next(error);
  }
});

router.get('/history', protect, async (req, res, next) => {
  try {
    const payments = await Payment.find({ userId: req.user._id }).sort({ createdAt: -1 });
    res.status(200).json({ success: true, data: payments });
  } catch (error) {
    next(error);
  }
});

router.get('/wallet/balance', protect, async (req, res, next) => {
  try {
    const user = await require('../models/User').findById(req.user._id);
    res.status(200).json({ success: true, data: { balance: user.walletBalance || 0 } });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
