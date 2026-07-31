/**
 * HomeVista - Admin Routes
 * Super admin management routes
 */

const express = require('express');
const router = express.Router();
const { protect, adminOnly } = require('../middleware/auth');

// Import controllers
const {
  getDashboardStats,
  getUsers,
  getUserById,
  updateUserStatus,
  verifyUser,
  deleteUser,
  getAllListings,
  getPendingListings,
  approveListing,
  rejectListing,
  setFeatured,
  deleteListing,
  getAllPayments,
  getPendingPayments,
  confirmPayment,
  rejectPayment,
  sendPaymentToSeller,
  processRefund,
  getAllTransactions,
  getTransactionSummary,
  getRevenueAnalytics,
} = require('../controllers/adminController');

// All routes require authentication and super admin role
router.use(protect, adminOnly);

// Dashboard
router.get('/dashboard/stats', getDashboardStats);
router.get('/dashboard/revenue', getRevenueAnalytics);

// Users
router.get('/users', getUsers);
router.get('/users/:id', getUserById);
router.patch('/users/:id/status', updateUserStatus);
router.patch('/users/:id/verify', verifyUser);
router.delete('/users/:id', deleteUser);

// Listings
router.get('/listings', getAllListings);
router.get('/listings/pending', getPendingListings);
router.patch('/listings/:id/approve', approveListing);
router.patch('/listings/:id/reject', rejectListing);
router.patch('/listings/:id/featured', setFeatured);
router.delete('/listings/:id', deleteListing);

// Payments
router.get('/payments', getAllPayments);
router.get('/payments/pending', getPendingPayments);
router.patch('/payments/:id/confirm', confirmPayment);
router.patch('/payments/:id/reject', rejectPayment);
router.post('/payments/send-to-seller', sendPaymentToSeller);
router.post('/payments/refund', processRefund);

// Transactions
router.get('/transactions', getAllTransactions);
router.get('/transactions/summary', getTransactionSummary);

module.exports = router;
