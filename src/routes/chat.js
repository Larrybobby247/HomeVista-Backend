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
      .populate({
        path: 'lastMessage',
        populate: { path: 'senderId', select: 'firstName lastName' },
      })
      .sort({ updatedAt: -1 });

    res.status(200).json({ success: true, data: conversations });
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

module.exports = router;
