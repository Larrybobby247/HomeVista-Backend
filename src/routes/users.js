/**
 * HomeVista - Public user (property poster) profile routes
 */

const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const { optionalAuth } = require('../middleware/auth');
const User = require('../models/User');
const Property = require('../models/Property');
const { decorate, POSTER_FIELDS } = require('../utils/propertyHelpers');

// GET /api/users/:id/profile - what a buyer sees when they open a poster's profile
router.get('/:id/profile', optionalAuth, async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(404).json({ success: false, message: 'Profile not found' });
    }
    const user = await User.findById(req.params.id).select(
      'firstName lastName email phoneNumber avatar bio companyName role isVerified city state yearsOfExperience licenseNumber createdAt'
    );
    if (!user || ['super_admin'].includes(user.role)) {
      return res.status(404).json({ success: false, message: 'Profile not found' });
    }

    const isOwner = req.user && String(req.user._id) === String(user._id);
    // The owner also sees their own pending/rejected listings; everyone else only verified ones
    const filter = { listedBy: user._id, ...(isOwner ? {} : { verificationStatus: 'verified' }) };

    const found = await Property.find(filter).populate('listedBy', POSTER_FIELDS).sort({ createdAt: -1 }).limit(100);
    const properties = (await decorate(found, req.user)).sort(
      (a, b) => Number(['sold', 'rented'].includes(a.status)) - Number(['sold', 'rented'].includes(b.status))
    );

    const active = properties.filter((p) => !['sold', 'rented'].includes(p.status) && p.verificationStatus === 'verified').length;
    const completed = properties.filter((p) => ['sold', 'rented'].includes(p.status)).length;

    res.status(200).json({
      success: true,
      data: {
        profile: {
          _id: user._id,
          displayName: user.displayName,
          businessName: user.companyName || null,
          firstName: user.firstName,
          lastName: user.lastName,
          avatar: user.avatar,
          bio: user.bio,
          role: user.role,
          isVerified: user.isVerified,
          location: [user.city, user.state].filter(Boolean).join(', '),
          yearsOfExperience: user.yearsOfExperience,
          licenseNumber: user.licenseNumber,
          memberSince: user.createdAt,
          // Contact details are shown on a poster's profile so buyers can reach them
          contact: { phone: user.phoneNumber, email: user.email },
          stats: { activeListings: active, completedDeals: completed, totalListings: properties.length },
          isOwner: !!isOwner,
        },
        properties,
      },
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
