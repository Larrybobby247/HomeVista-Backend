/**
 * HomeVista - "New listings" digest
 *
 * Every few hours we look for buyers/renters who haven't heard from us in
 * DIGEST_MIN_GAP_HOURS and send them a notification (in-app + push + email) about
 * properties approved since their last digest, preferring ones near their location.
 * Runs inside the API process, so no extra infrastructure is needed.
 */

const User = require('../models/User');
const Property = require('../models/Property');
const { notify } = require('./notificationService');
const { haversineKm } = require('../utils/propertyHelpers');

const BUYER_ROLES = ['buyer', 'tenant'];
const MIN_GAP_HOURS = Number(process.env.DIGEST_MIN_GAP_HOURS || 48);
const CHECK_EVERY_MS = Number(process.env.DIGEST_CHECK_HOURS || 6) * 60 * 60 * 1000;

const runDigest = async () => {
  const now = Date.now();
  const gapCutoff = new Date(now - MIN_GAP_HOURS * 3600 * 1000);

  const users = await User.find({
    role: { $in: BUYER_ROLES },
    status: 'active',
    'notificationPreferences.newListingAlerts': { $ne: false },
    $or: [{ lastDigestAt: { $exists: false } }, { lastDigestAt: null }, { lastDigestAt: { $lt: gapCutoff } }],
  }).select('firstName city state lastLocation lastDigestAt createdAt').limit(500);

  let sent = 0;
  for (const user of users) {
    const since = user.lastDigestAt || user.createdAt || gapCutoff;
    const fresh = await Property.find({
      verificationStatus: 'verified',
      status: { $in: ['for_sale', 'for_rent', 'lease', 'shortlet'] },
      reviewedAt: { $gt: since },
    })
      .select('title city state price coordinates status')
      .sort({ reviewedAt: -1 })
      .limit(50)
      .lean();

    if (!fresh.length) continue;

    // Prefer listings close to the user (within 25km), else same city/state, else anything new
    const loc = user.lastLocation;
    let relevant = [];
    let where = '';
    if (loc?.latitude != null) {
      relevant = fresh.filter((p) => haversineKm(loc.latitude, loc.longitude, p.coordinates.latitude, p.coordinates.longitude) <= 25);
      where = ' near you';
    }
    if (!relevant.length && user.city) {
      relevant = fresh.filter((p) => (p.city || '').toLowerCase() === user.city.toLowerCase());
      where = ` in ${user.city}`;
    }
    if (!relevant.length) {
      relevant = fresh;
      where = '';
    }

    const top = relevant[0];
    await notify(user._id, {
      type: 'new_listings',
      title: `${relevant.length} new propert${relevant.length === 1 ? 'y' : 'ies'}${where}`,
      message:
        relevant.length === 1
          ? `"${top.title}" in ${top.city} just got listed. Take a look!`
          : `"${top.title}" and ${relevant.length - 1} more were just listed. Take a look!`,
      data: { propertyId: String(top._id), screen: 'property' },
    });
    await User.updateOne({ _id: user._id }, { lastDigestAt: new Date() });
    sent += 1;
  }
  if (sent) console.log(`[digest] sent ${sent} new-listing notifications`);
};

const startDigestScheduler = () => {
  if (process.env.DISABLE_DIGEST === 'true') return;
  const safeRun = () => runDigest().catch((e) => console.error('[digest] failed:', e.message));
  setTimeout(safeRun, 60 * 1000); // first run a minute after boot
  setInterval(safeRun, CHECK_EVERY_MS);
};

module.exports = { startDigestScheduler, runDigest };
