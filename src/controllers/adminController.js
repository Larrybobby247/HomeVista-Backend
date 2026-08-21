/**
 * HomeVista - Admin Controller
 * Super admin operations: manage users, listings, payments, transactions
 */

const User = require('../models/User');
const Property = require('../models/Property');
const Payment = require('../models/Payment');

/**
 * @desc    Get dashboard statistics
 * @route   GET /api/admin/dashboard/stats
 * @access  Private (Super Admin)
 */
exports.getDashboardStats = async (req, res, next) => {
  try {
    // Count users by role
    const usersByRole = await User.aggregate([
      { $group: { _id: '$role', count: { $sum: 1 } } },
    ]);
    const usersByRoleObj = {};
    usersByRole.forEach(item => { usersByRoleObj[item._id] = item.count; });

    // Count properties by status
    const propertiesByStatus = await Property.aggregate([
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]);
    const propertiesByStatusObj = {};
    propertiesByStatus.forEach(item => { propertiesByStatusObj[item._id] = item.count; });

    // Count properties by verification status
    const propertiesByVerification = await Property.aggregate([
      { $group: { _id: '$verificationStatus', count: { $sum: 1 } } },
    ]);
    const propertiesByVerificationObj = {};
    propertiesByVerification.forEach(item => { propertiesByVerificationObj[item._id] = item.count; });

        // Get total revenue (EXCLUDE payouts — money leaving platform)
    const revenueResult = await Payment.aggregate([
      { $match: { status: 'completed', type: { $ne: 'payout' } } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]);
    const totalRevenue = revenueResult[0]?.total || 0;

    // Get revenue by month
    const revenueByMonth = await Payment.aggregate([
      { $match: { status: 'completed', type: { $ne: 'payout' } } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m', date: '$createdAt' } },
          amount: { $sum: '$amount' },
        },
      },
      { $sort: { _id: 1 } },
      { $limit: 12 },
    ]);

    // Count new users this month
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);
    const newUsersThisMonth = await User.countDocuments({ createdAt: { $gte: startOfMonth } });

    // Count new listings this month
    const newListingsThisMonth = await Property.countDocuments({ createdAt: { $gte: startOfMonth } });

    // Pending verifications
    const pendingVerifications = await Property.countDocuments({ verificationStatus: 'pending' });

    // Pending payments
    const pendingPayments = await Payment.countDocuments({ status: 'pending' });

    res.status(200).json({
      success: true,
      data: {
        totalUsers: await User.countDocuments(),
        usersByRole: usersByRoleObj,
        totalProperties: await Property.countDocuments(),
        propertiesByStatus: propertiesByStatusObj,
        propertiesByVerification: propertiesByVerificationObj,
        totalTransactions: await Payment.countDocuments(),
        totalRevenue,
        revenueByMonth: revenueByMonth.map(r => ({ month: r._id, amount: r.amount })),
        pendingVerifications,
        pendingPayments,
        newUsersThisMonth,
        newListingsThisMonth,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get all users
 * @route   GET /api/admin/users
 * @access  Private (Super Admin)
 */
exports.getUsers = async (req, res, next) => {
  try {
    const { search, role, status, page = 1, limit = 50 } = req.query;

    const query = {};
    if (role) query.role = role;
    if (status) query.status = status;
    if (search) {
      query.$or = [
        { firstName: { $regex: search, $options: 'i' } },
        { lastName: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
      ];
    }

    const users = await User.find(query)
      .select('-password')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    const total = await User.countDocuments(query);

    res.status(200).json({
      success: true,
      data: { users, total, page: parseInt(page), totalPages: Math.ceil(total / limit) },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get single user
 * @route   GET /api/admin/users/:id
 * @access  Private (Super Admin)
 */
exports.getUserById = async (req, res, next) => {
  try {
    const user = await User.findById(req.params.id).select('-password');
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    res.status(200).json({ success: true, data: user });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Update user status
 * @route   PATCH /api/admin/users/:id/status
 * @access  Private (Super Admin)
 */
exports.updateUserStatus = async (req, res, next) => {
  try {
    const { status } = req.body;
    const user = await User.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true, runValidators: true }
    ).select('-password');

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    res.status(200).json({
      success: true,
      message: `User status updated to ${status}`,
      data: user,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Verify user
 * @route   PATCH /api/admin/users/:id/verify
 * @access  Private (Super Admin)
 */
exports.verifyUser = async (req, res, next) => {
  try {
    const user = await User.findByIdAndUpdate(
      req.params.id,
      { isVerified: true, status: 'active' },
      { new: true }
    ).select('-password');

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    res.status(200).json({
      success: true,
      message: 'User verified successfully',
      data: user,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Delete user
 * @route   DELETE /api/admin/users/:id
 * @access  Private (Super Admin)
 */
exports.deleteUser = async (req, res, next) => {
  try {
    const user = await User.findByIdAndDelete(req.params.id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    res.status(200).json({ success: true, message: 'User deleted successfully' });
  } catch (error) {
    next(error);
  }
};

// ============================================
// LISTING MANAGEMENT
// ============================================

/**
 * @desc    Get all listings
 * @route   GET /api/admin/listings
 * @access  Private (Super Admin)
 */
exports.getAllListings = async (req, res, next) => {
  try {
    const { search, verificationStatus, propertyType, page = 1, limit = 50 } = req.query;

    const query = {};
    if (verificationStatus) query.verificationStatus = verificationStatus;
    if (propertyType) query.propertyType = propertyType;
    if (search) {
      query.$or = [
        { title: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
        { city: { $regex: search, $options: 'i' } },
      ];
    }

    const properties = await Property.find(query)
      .populate('listedBy', 'firstName lastName email')
      .populate('agent', 'firstName lastName email')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    const total = await Property.countDocuments(query);

    res.status(200).json({
      success: true,
      data: { properties, total, page: parseInt(page), totalPages: Math.ceil(total / limit) },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get pending listings
 * @route   GET /api/admin/listings/pending
 * @access  Private (Super Admin)
 */
exports.getPendingListings = async (req, res, next) => {
  try {
    const properties = await Property.find({ verificationStatus: 'pending' })
      .populate('listedBy', 'firstName lastName email phoneNumber')
      .sort({ createdAt: -1 });

    res.status(200).json({ success: true, data: { properties } });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Approve listing
 * @route   PATCH /api/admin/listings/:id/approve
 * @access  Private (Super Admin)
 */
exports.approveListing = async (req, res, next) => {
  try {
    const property = await Property.findByIdAndUpdate(
      req.params.id,
      {
        verificationStatus: 'verified',
        reviewedBy: req.user._id,
        reviewedAt: new Date(),
        $unset: { rejectionReason: 1 },
      },
      { new: true }
    );

    if (!property) {
      return res.status(404).json({ success: false, message: 'Listing not found' });
    }

    res.status(200).json({
      success: true,
      message: 'Listing approved successfully',
      data: property,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Reject listing
 * @route   PATCH /api/admin/listings/:id/reject
 * @access  Private (Super Admin)
 */
exports.rejectListing = async (req, res, next) => {
  try {
    const { reason } = req.body;
    const property = await Property.findByIdAndUpdate(
      req.params.id,
      {
        verificationStatus: 'rejected',
        rejectionReason: reason,
        reviewedBy: req.user._id,
        reviewedAt: new Date(),
      },
      { new: true }
    );

    if (!property) {
      return res.status(404).json({ success: false, message: 'Listing not found' });
    }

    res.status(200).json({
      success: true,
      message: 'Listing rejected',
      data: property,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Toggle featured status
 * @route   PATCH /api/admin/listings/:id/featured
 * @access  Private (Super Admin)
 */
exports.setFeatured = async (req, res, next) => {
  try {
    const { featured } = req.body;
    const property = await Property.findByIdAndUpdate(
      req.params.id,
      { isFeatured: featured },
      { new: true }
    );

    if (!property) {
      return res.status(404).json({ success: false, message: 'Listing not found' });
    }

    res.status(200).json({
      success: true,
      message: `Listing ${featured ? 'featured' : 'unfeatured'}`,
      data: property,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Delete listing
 * @route   DELETE /api/admin/listings/:id
 * @access  Private (Super Admin)
 */
exports.deleteListing = async (req, res, next) => {
  try {
    const property = await Property.findByIdAndDelete(req.params.id);
    if (!property) {
      return res.status(404).json({ success: false, message: 'Listing not found' });
    }
    res.status(200).json({ success: true, message: 'Listing deleted successfully' });
  } catch (error) {
    next(error);
  }
};

// ============================================
// PAYMENT MANAGEMENT
// ============================================

/**
 * @desc    Get all payments
 * @route   GET /api/admin/payments
 * @access  Private (Super Admin)
 */
exports.getAllPayments = async (req, res, next) => {
  try {
    const { status, type, method, page = 1, limit = 50 } = req.query;

    const query = {};
    if (status) query.status = status;
    if (type) query.type = type;
    if (method) query.method = method;

    const payments = await Payment.find(query)
       .populate('userId', 'firstName lastName email phoneNumber')
      .populate('propertyId', 'title address city images')
      .populate('recipientId', 'firstName lastName email phoneNumber bankDetails')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    const total = await Payment.countDocuments(query);

    res.status(200).json({
      success: true,
      data: { payments, total, page: parseInt(page), totalPages: Math.ceil(total / limit) },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get pending payments
 * @route   GET /api/admin/payments/pending
 * @access  Private (Super Admin)
 */
exports.getPendingPayments = async (req, res, next) => {
  try {
    const payments = await Payment.find({ status: 'pending' })
      .populate('userId', 'firstName lastName email')
      .populate('propertyId', 'title')
      .sort({ createdAt: -1 });

    res.status(200).json({ success: true, data: { payments } });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Confirm payment
 * @route   PATCH /api/admin/payments/:id/confirm
 * @access  Private (Super Admin)
 */
exports.confirmPayment = async (req, res, next) => {
  try {
    const payment = await Payment.findById(req.params.id);

    if (!payment) {
      return res.status(404).json({ success: false, message: 'Payment not found' });
    }

    if (payment.status === 'completed') {
      return res.status(200).json({
        success: true,
        message: 'Payment already confirmed',
        data: payment,
      });
    }

    // PAYOUTS: Only change status
    if (payment.type === 'payout') {
      payment.status = 'completed';
      payment.completedAt = new Date();
      await payment.save();
      return res.status(200).json({ success: true, message: 'Payout confirmed', data: payment });
    }

    // REGULAR PAYMENTS: Confirm and credit seller
    payment.status = 'completed';
    payment.completedAt = new Date();
    await payment.save();

    // Determine who gets credited.
    // Prefer an explicit recipientId (e.g. admin-initiated payouts),
    // but fall back to the property owner for purchase/sale-type payments.
    let creditRecipientId = payment.recipientId;

    if (!creditRecipientId && payment.propertyId) {
  const property = await Property.findById(payment.propertyId).select('listedBy listedByType');
  if (property?.listedBy) {
    creditRecipientId = property.listedBy;
  }
}

    if (creditRecipientId) {
      const netAmount = payment.amount - (payment.platformFee || 0) - (payment.commissionAmount || 0);
      const credit = Math.max(0, netAmount);

      console.log('Crediting wallet:', {
        recipientId: creditRecipientId,
        credit,
        paymentId: payment._id,
        source: payment.recipientId ? 'recipientId' : 'propertyOwner',
      });

      const updatedUser = await User.findByIdAndUpdate(
        creditRecipientId,
        { $inc: { walletBalance: credit } },
        { new: true }
      );

      console.log('Updated user wallet:', updatedUser?.walletBalance);
    } else {
      console.log('No recipient resolved (no recipientId, no property owner) — wallet not credited');
    }

    res.status(200).json({ success: true, message: 'Payment confirmed', data: payment });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Reject payment
 * @route   PATCH /api/admin/payments/:id/reject
 * @access  Private (Super Admin)
 */
exports.rejectPayment = async (req, res, next) => {
  try {
    const { reason } = req.body;
    const payment = await Payment.findByIdAndUpdate(
      req.params.id,
      { status: 'failed', description: reason },
      { new: true }
    );

    if (!payment) {
      return res.status(404).json({ success: false, message: 'Payment not found' });
    }

    res.status(200).json({
      success: true,
      message: 'Payment rejected',
      data: payment,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Send payment to seller
 * @route   POST /api/admin/payments/send-to-seller
 * @access  Private (Super Admin)
 */
exports.sendPaymentToSeller = async (req, res, next) => {
  try {
    const { paymentId, recipientId, amount } = req.body;

    const payment = await Payment.findById(paymentId);
    if (!payment) {
      return res.status(404).json({ success: false, message: 'Payment not found' });
    }

    // Guard: Send-to-seller is for regular payments only, not payouts
    if (payment.type === 'payout') {
      return res.status(400).json({
        success: false,
        message: 'Payouts must be confirmed using Confirm, not Send to Seller',
      });
    }

        payment.recipientId = recipientId || payment.recipientId;
    payment.status = 'completed';
    payment.completedAt = new Date();
    payment.description = `Payment sent to seller: ${amount}`;
    await payment.save();

    res.status(200).json({
      success: true,
      message: 'Payment sent to seller successfully',
      data: payment,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Process refund
 * @route   POST /api/admin/payments/refund
 * @access  Private (Super Admin)
 */
exports.processRefund = async (req, res, next) => {
  try {
    const { paymentId, amount, reason } = req.body;

    const payment = await Payment.findById(paymentId);
    if (!payment) {
      return res.status(404).json({ success: false, message: 'Payment not found' });
    }

    const refundAmount = amount || payment.amount;

    const updatedPayment = await Payment.findByIdAndUpdate(
      paymentId,
      {
        status: 'refunded',
        description: `Refunded: ${reason || 'Admin initiated'}`,
        commissionAmount: refundAmount,
      },
      { new: true }
    );

    res.status(200).json({
      success: true,
      message: 'Refund processed successfully',
      data: updatedPayment,
    });
  } catch (error) {
    next(error);
  }
};

// ============================================
// TRANSACTIONS
// ============================================

/**
 * @desc    Get all transactions
 * @route   GET /api/admin/transactions
 * @access  Private (Super Admin)
 */
exports.getAllTransactions = async (req, res, next) => {
  try {
    const { page = 1, limit = 100 } = req.query;

    const transactions = await Payment.find()
      .populate('userId', 'firstName lastName email')
      .populate('propertyId', 'title')
      .populate('recipientId', 'firstName lastName email')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    const total = await Payment.countDocuments();

    res.status(200).json({
      success: true,
      data: { transactions, total },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get transaction summary
 * @route   GET /api/admin/transactions/summary
 * @access  Private (Super Admin)
 */
exports.getTransactionSummary = async (req, res, next) => {
  try {
    const { period = 'monthly' } = req.query;

    // Total revenue
    const revenueResult = await Payment.aggregate([
      { $match: { status: 'completed', type: { $ne: 'payout' } } },
      { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } },
    ]);

    // Pending
    const pendingResult = await Payment.aggregate([
      { $match: { status: 'pending', type: { $ne: 'payout' } } },
      { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } },
    ]);

    // Refunded
    const refundedResult = await Payment.aggregate([
      { $match: { status: 'refunded', type: { $ne: 'payout' } } },
      { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } },
    ]);

    // Platform fees
    const feesResult = await Payment.aggregate([
      { $match: { status: 'completed' } },
      { $group: { _id: null, total: { $sum: '$platformFee' } } },
    ]);

    res.status(200).json({
      success: true,
      data: {
        totalRevenue: revenueResult[0]?.total || 0,
        totalCount: revenueResult[0]?.count || 0,
        pendingAmount: pendingResult[0]?.total || 0,
        pendingCount: pendingResult[0]?.count || 0,
        refundedAmount: refundedResult[0]?.total || 0,
        refundedCount: refundedResult[0]?.count || 0,
        platformFees: feesResult[0]?.total || 0,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get revenue analytics
 * @route   GET /api/admin/dashboard/revenue
 * @access  Private (Super Admin)
 */
exports.getRevenueAnalytics = async (req, res, next) => {
  try {
    const { period = 'monthly' } = req.query;

    let groupFormat;
    switch (period) {
      case 'daily':
        groupFormat = '%Y-%m-%d';
        break;
      case 'weekly':
        groupFormat = '%Y-W%U';
        break;
      case 'yearly':
        groupFormat = '%Y';
        break;
      default:
        groupFormat = '%Y-%m';
    }

    const revenue = await Payment.aggregate([
      { $match: { status: 'completed' } },
      {
        $group: {
          _id: { $dateToString: { format: groupFormat, date: '$createdAt' } },
          amount: { $sum: '$amount' },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    res.status(200).json({
      success: true,
      data: { revenue },
    });
  } catch (error) {
    next(error);
  }
}
