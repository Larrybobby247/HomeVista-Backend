/**
 * HomeVista - Notification Service
 *
 * One entry point for every notification in the app:
 *   notify(userId, { type, title, message, data })
 *
 * It (1) stores an in-app notification, (2) sends a push notification to the
 * user's phone (shows in the phone's notification tray), and (3) sends an email.
 * Channels respect the user's notification settings.
 * It never throws - a failing channel must not break the request that triggered it.
 */

const fetch = require('node-fetch');
const User = require('../models/User');
const Notification = require('../models/Notification');
const { sendNotificationEmail } = require('../utils/email');

const EXPO_PUSH_URL = 'https://exp.host/api/v2/push/send';
const APP_URL = process.env.APP_URL || process.env.FRONTEND_URL || '';

// Which user preference gates which notification type
const PREF_BY_TYPE = {
  new_message: 'messageNotifications',
  new_inquiry: 'messageNotifications',
  offer_received: 'messageNotifications',
  inspection_scheduled: 'inspectionReminders',
  payment_received: 'paymentNotifications',
  payment_sent: 'paymentNotifications',
  property_sold: 'paymentNotifications',
  new_listings: 'newListingAlerts',
};

// Chatty types are not emailed one-by-one (they'd flood an inbox); they still get push + in-app
const EMAIL_SKIP = new Set(['new_message']);

const sendExpoPush = async (tokens, { title, body, data }) => {
  const valid = tokens.filter((t) => /^Expo(nent)?PushToken\[.+\]$/.test(t));
  if (!valid.length) return { sent: false, invalid: [] };

  const messages = valid.map((to) => ({
    to,
    title,
    body,
    data: data || {},
    sound: 'default',
    priority: 'high',
    channelId: 'default',
  }));

  const res = await fetch(EXPO_PUSH_URL, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(messages),
  });
  const json = await res.json();
  const invalid = [];
  (json.data || []).forEach((ticket, i) => {
    if (ticket.status === 'error' && ticket.details?.error === 'DeviceNotRegistered') invalid.push(valid[i]);
  });
  return { sent: true, invalid };
};

const notify = async (userId, { type, title, message, data = {}, skipEmail = false, skipPush = false }) => {
  try {
    if (!userId) return null;
    const user = await User.findById(userId).select('+pushTokens email firstName notificationPreferences');
    if (!user) return null;

    const prefs = user.notificationPreferences || {};
    const gate = PREF_BY_TYPE[type];
    const allowedByCategory = !gate || prefs[gate] !== false;

    // The in-app record is always stored, so the Notifications tab is a full history
    const notification = await Notification.create({ userId, type, title, message, data });

    if (!allowedByCategory) return notification;

    // ── Push ──
    if (!skipPush && prefs.pushNotifications !== false && user.pushTokens?.length) {
      try {
        const { sent, invalid } = await sendExpoPush(
          user.pushTokens.map((t) => t.token),
          { title, body: message, data: { ...data, type, notificationId: String(notification._id) } }
        );
        if (sent) notification.pushSent = true;
        if (invalid.length) {
          await User.updateOne({ _id: userId }, { $pull: { pushTokens: { token: { $in: invalid } } } });
        }
      } catch (err) {
        console.error('[notify] push failed:', err.message);
      }
    }

    // ── Email ──
    if (!skipEmail && !EMAIL_SKIP.has(type) && prefs.emailNotifications !== false && user.email) {
      const result = await sendNotificationEmail({
        email: user.email,
        firstName: user.firstName,
        title,
        message,
        ctaLabel: 'Open HomeVista',
        ctaUrl: APP_URL || undefined,
      });
      if (result.success) notification.emailSent = true;
    }

    if (notification.pushSent || notification.emailSent) await notification.save();
    return notification;
  } catch (err) {
    console.error('[notify] failed:', err.message);
    return null;
  }
};

module.exports = { notify };
