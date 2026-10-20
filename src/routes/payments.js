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
  getBanks,
  verifyBankAccount,
  getPayoutAccount,
  setupPayoutAccount,
  getReceipt,
} = require('../controllers/paymentController');

router.post('/initialize', protect, initializePayment);
router.get('/verify/:reference', protect, verifyPayment);
router.get('/history', protect, getPaymentHistory);
router.get('/banks', protect, getBanks);
router.get('/bank', protect, getPayoutAccount);
router.post('/bank/verify', protect, verifyBankAccount);
router.post('/bank/setup', protect, setupPayoutAccount);
router.get('/:id/receipt', protect, getReceipt);
router.get('/:id', protect, getPaymentById);
router.get('/wallet/balance', protect, getWalletBalance);
router.get('/wallet/transactions', protect, getWalletTransactions);
router.post('/payouts', protect, requestPayout);
router.post('/webhook', paystackWebhook); // No protect — raw body handled in server.js

module.exports = router;