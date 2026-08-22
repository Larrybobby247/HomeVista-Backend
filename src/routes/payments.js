const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const {
  initializePayment,
  verifyPayment,
  getPaymentHistory,
  getPaymentById,
  getWalletBalance,
  getWalletTransactions,
  requestPayout,
  paystackWebhook,
} = require('../controllers/paymentController');

router.post('/initialize', protect, initializePayment);
router.get('/verify/:reference', protect, verifyPayment);
router.get('/history', protect, getPaymentHistory);
router.get('/:id', protect, getPaymentById);
router.get('/wallet/balance', protect, getWalletBalance);
router.get('/wallet/transactions', protect, getWalletTransactions);
router.post('/payouts', protect, requestPayout);
router.post('/webhook', paystackWebhook); // No protect — raw body handled in server.js

module.exports = router;