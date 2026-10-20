/**
 * HomeVista - Chat Routes
 */

const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const { Conversation, Message } = require('../models/Conversation');
const Property = require('../models/Property');
const { notify } = require('../services/notificationService');

const PARTICIPANT_FIELDS = 'firstName lastName email avatar companyName phoneNumber role';

// Loads a conversation only if the signed-in user is part of it
const getMyConversation = async (id, userId) => {
  const conv = await Conversation.findById(id);
  if (!conv) return null;
  return conv.participants.some((p) => String(p) === String(userId)) ? conv : null;
};

router.get('/conversations', protect, async (req, res, next) => {
  try {
    const conversations = await Conversation.find({ participants: req.user._id })
      .populate('participants', PARTICIPANT_FIELDS)
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
    const mine = await getMyConversation(req.params.id, req.user._id);
    if (!mine) return res.status(404).json({ success: false, message: 'Conversation not found' });
    const conversation = await Conversation.findById(req.params.id)
      .populate('participants', PARTICIPANT_FIELDS)
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
    if (!userId || String(userId) === String(req.user._id)) {
      return res.status(400).json({ success: false, message: 'A valid recipient is required' });
    }

    let conversation = await Conversation.findOne({
      participants: { $all: [req.user._id, userId] },
    });

    if (conversation && propertyId && String(conversation.propertyId || '') !== String(propertyId)) {
      conversation.propertyId = propertyId;
      await conversation.save();
    }

    if (!conversation) {
      conversation = await Conversation.create({
        participants: [req.user._id, userId],
        propertyId,
      });
    }

    await conversation.populate('participants', PARTICIPANT_FIELDS);
    res.status(200).json({ success: true, data: conversation });
  } catch (error) {
    next(error);
  }
});



router.get('/conversations/:id/messages', protect, async (req, res, next) => {
  try {
    if (!(await getMyConversation(req.params.id, req.user._id))) {
      return res.status(404).json({ success: false, message: 'Conversation not found' });
    }
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
    if (!content || !String(content).trim()) {
      return res.status(400).json({ success: false, message: 'Message cannot be empty' });
    }
    const conv = await getMyConversation(req.params.id, req.user._id);
    if (!conv) return res.status(404).json({ success: false, message: 'Conversation not found' });

    const isFirstMessage = (await Message.countDocuments({ conversationId: conv._id })) === 0;
    const message = await Message.create({
      conversationId: req.params.id,
      senderId: req.user._id,
      content,
    });

    await Conversation.findByIdAndUpdate(req.params.id, { lastMessage: message._id });
    await message.populate('senderId', 'firstName lastName avatar companyName');

    res.status(201).json({ success: true, data: message });

    // Notify the other participant (after responding so sending stays fast)
    const recipientId = conv.participants.find((p) => String(p) !== String(req.user._id));
    if (recipientId) {
      const senderName = (req.user.companyName && req.user.companyName.trim()) || `${req.user.firstName} ${req.user.lastName}`;
      const preview = String(content).trim().slice(0, 120);
      let property = null;
      if (conv.propertyId) property = await Property.findById(conv.propertyId).select('title listedBy').lean();
      const isInquiry = isFirstMessage && property && String(property.listedBy) === String(recipientId);

      notify(recipientId, {
        type: isInquiry ? 'new_inquiry' : 'new_message',
        title: isInquiry ? `New inquiry on ${property.title}` : `New message from ${senderName}`,
        message: isInquiry ? `${senderName}: ${preview}` : preview,
        data: { conversationId: String(conv._id), propertyId: conv.propertyId ? String(conv.propertyId) : undefined, screen: 'message' },
      });
    }
  } catch (error) {
    next(error);
  }
});

// Total unread messages (for the Messages tab badge)
router.get('/unread-count', protect, async (req, res, next) => {
  try {
    const convs = await Conversation.find({ participants: req.user._id }).select('_id').lean();
    const count = await Message.countDocuments({
      conversationId: { $in: convs.map((c) => c._id) },
      senderId: { $ne: req.user._id },
      isRead: false,
    });
    res.status(200).json({ success: true, data: { count } });
  } catch (error) {
    next(error);
  }
});

// MARK MESSAGES AS READ (the app calls POST /conversations/:id/read)
router.post('/conversations/:conversationId/read', protect, async (req, res, next) => {
  try {
    if (!(await getMyConversation(req.params.conversationId, req.user._id))) {
      return res.status(404).json({ success: false, message: 'Conversation not found' });
    }
    await Message.updateMany(
      { conversationId: req.params.conversationId, senderId: { $ne: req.user._id }, isRead: false },
      { $set: { isRead: true, readAt: new Date() } }
    );
    res.status(200).json({ success: true });
  } catch (error) {
    next(error);
  }
});

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
