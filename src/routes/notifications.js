/**
 * HomeVista - Notification Routes
 */

const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const Notification = require('../models/Notification');
const { Conversation, Message } = require('../models/Conversation');
const User = require('../models/User');

// List the signed-in user's notifications (paginated)
router.get('/', protect, async (req, res, next) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 30, 100);
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const filter = { userId: req.user._id };
    if (req.query.unread === 'true') filter.isRead = false;

    const [notifications, total, unread] = await Promise.all([
      Notification.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      Notification.countDocuments(filter),
      Notification.countDocuments({ userId: req.user._id, isRead: false }),
    ]);
    res.status(200).json({ success: true, data: notifications, total, unread, page, hasMore: page * limit < total });
  } catch (error) {
    next(error);
  }
});

router.get('/unread-count', protect, async (req, res, next) => {
  try {
    const count = await Notification.countDocuments({ userId: req.user._id, isRead: false });
    res.status(200).json({ success: true, data: { count } });
  } catch (error) {
    next(error);
  }
});

// Both badge numbers in one cheap call (notifications tab + messages tab)
router.get('/counts', protect, async (req, res, next) => {
  try {
    const convs = await Conversation.find({ participants: req.user._id }).select('_id').lean();
    const [notifications, messages] = await Promise.all([
      Notification.countDocuments({ userId: req.user._id, isRead: false }),
      Message.countDocuments({
        conversationId: { $in: convs.map((c) => c._id) },
        senderId: { $ne: req.user._id },
        isRead: false,
      }),
    ]);
    res.status(200).json({ success: true, data: { notifications, messages } });
  } catch (error) {
    next(error);
  }
});

// Register this device for push notifications
router.post('/push-token', protect, async (req, res, next) => {
  try {
    const { token, platform } = req.body;
    if (!token) return res.status(400).json({ success: false, message: 'token is required' });

    // A device token belongs to one account at a time
    await User.updateMany({ 'pushTokens.token': token }, { $pull: { pushTokens: { token } } });
    await User.updateOne(
      { _id: req.user._id },
      { $push: { pushTokens: { token, platform, updatedAt: new Date() } } }
    );
    res.status(200).json({ success: true });
  } catch (error) {
    next(error);
  }
});

router.delete('/push-token', protect, async (req, res, next) => {
  try {
    const { token } = req.body || {};
    if (token) await User.updateOne({ _id: req.user._id }, { $pull: { pushTokens: { token } } });
    res.status(200).json({ success: true });
  } catch (error) {
    next(error);
  }
});

// Notification preferences (settings toggles)
router.put('/preferences', protect, async (req, res, next) => {
  try {
    const allowed = [
      'emailNotifications', 'pushNotifications', 'smsNotifications', 'marketingEmails',
      'newListingAlerts', 'priceDropAlerts', 'messageNotifications', 'paymentNotifications',
      'inspectionReminders',
    ];
    const $set = {};
    allowed.forEach((k) => {
      if (typeof req.body[k] === 'boolean') $set[`notificationPreferences.${k}`] = req.body[k];
    });
    const user = await User.findByIdAndUpdate(req.user._id, { $set }, { new: true });
    res.status(200).json({ success: true, data: user.notificationPreferences });
  } catch (error) {
    next(error);
  }
});

router.patch('/:id/read', protect, async (req, res, next) => {
  try {
    await Notification.updateOne({ _id: req.params.id, userId: req.user._id }, { isRead: true });
    res.status(200).json({ success: true });
  } catch (error) {
    next(error);
  }
});

router.post('/read-all', protect, async (req, res, next) => {
  try {
    await Notification.updateMany({ userId: req.user._id, isRead: false }, { isRead: true });
    res.status(200).json({ success: true });
  } catch (error) {
    next(error);
  }
});

router.delete('/:id', protect, async (req, res, next) => {
  try {
    await Notification.deleteOne({ _id: req.params.id, userId: req.user._id });
    res.status(200).json({ success: true });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
