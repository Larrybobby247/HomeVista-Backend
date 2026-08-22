/**
 * HomeVista - Chat Routes
 */

const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const { Conversation, Message } = require('../models/Conversation');

router.get('/conversations', protect, async (req, res, next) => {
  try {
    const conversations = await Conversation.find({ participants: req.user._id })
      .populate('participants', 'firstName lastName email avatar')
      .populate('propertyId', 'title images')
      .sort({ updatedAt: -1 })
      .lean();

    const convIds = conversations.map((c) => c._id);

    // latest message per conversation, computed live from the messages collection
    const lastMessages = await Message.aggregate([
      { $match: { conversationId: { $in: convIds } } },
      { $sort: { createdAt: -1 } },
      { $group: { _id: '$conversationId', doc: { $first: '$$ROOT' } } },
    ]);
    const lastMessageMap = Object.fromEntries(
      lastMessages.map((m) => [String(m._id), m.doc])
    );

    // unread count per conversation
    const unreadCounts = await Message.aggregate([
      {
        $match: {
          conversationId: { $in: convIds },
          senderId: { $ne: req.user._id },
          isRead: false,
        },
      },
      { $group: { _id: '$conversationId', count: { $sum: 1 } } },
    ]);
    const unreadMap = Object.fromEntries(
      unreadCounts.map((u) => [String(u._id), u.count])
    );

    const enriched = conversations.map((c) => ({
      ...c,
      lastMessage: lastMessageMap[String(c._id)] || null,
      unreadCount: unreadMap[String(c._id)] || 0,
    }));

    res.status(200).json({ success: true, data: enriched });
  } catch (error) {
    next(error);
  }
});

router.get('/conversations/:id', protect, async (req, res, next) => {
  try {
    const conversation = await Conversation.findById(req.params.id)
      .populate('participants', 'firstName lastName email avatar')
      .populate('propertyId', 'title images price listedBy')
      .populate({
        path: 'lastMessage',
        populate: { path: 'senderId', select: 'firstName lastName' },
      });

    if (!conversation) {
      return res.status(404).json({ success: false, message: 'Conversation not found' });
    }

    res.status(200).json({ success: true, data: conversation });
  } catch (error) {
    next(error);
  }
});

router.post('/conversations', protect, async (req, res, next) => {
  try {
    const { userId, propertyId } = req.body;

    let conversation = await Conversation.findOne({
      participants: { $all: [req.user._id, userId] },
    });

    if (!conversation) {
      conversation = await Conversation.create({
        participants: [req.user._id, userId],
        propertyId,
      });
    }

    await conversation.populate('participants', 'firstName lastName email avatar');
    res.status(200).json({ success: true, data: conversation });
  } catch (error) {
    next(error);
  }
});



router.get('/conversations/:id/messages', protect, async (req, res, next) => {
  try {
    const messages = await Message.find({ conversationId: req.params.id })
      .populate('senderId', 'firstName lastName avatar')
      .sort({ createdAt: -1 })
      .limit(50);

    res.status(200).json({ success: true, data: messages.reverse() });
  } catch (error) {
    next(error);
  }
});

router.post('/conversations/:id/messages', protect, async (req, res, next) => {
  try {
    const { content } = req.body;
    const message = await Message.create({
      conversationId: req.params.id,
      senderId: req.user._id,
      content,
    });

    await Conversation.findByIdAndUpdate(req.params.id, { lastMessage: message._id });
    await message.populate('senderId', 'firstName lastName avatar');

    res.status(201).json({ success: true, data: message });
  } catch (error) {
    next(error);
  }
});

// MARK MESSAGES AS READ
router.patch('/messages/:conversationId/read', protect, async (req, res, next) => {
  try {
    const { conversationId } = req.params;
    const userId = req.user._id;

    const result = await Message.updateMany(
      {
        conversationId,
        senderId: { $ne: userId },
        isRead: false,
      },
      { $set: { isRead: true } }
    );

    res.status(200).json({
      success: true,
      modifiedCount: result.modifiedCount,
    });
  } catch (error) {
    next(error);
  }
});



module.exports = router;
