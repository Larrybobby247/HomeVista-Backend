/**
 * HomeVista - Property Routes
 */

const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const Property = require('../models/Property');
const Favorite = require('../models/Favorite');

// Get all properties
router.get('/', async (req, res, next) => {
  try {
    const { limit = 10, page = 1, sortBy = 'newest' } = req.query;
    const sortOptions = {
      newest: { createdAt: -1 },
      oldest: { createdAt: 1 },
      price_asc: { price: 1 },
      price_desc: { price: -1 },
      popular: { viewCount: -1 },
    };

    const properties = await Property.find({ verificationStatus: 'verified' })
      .populate('listedBy', 'firstName lastName email phoneNumber')
      .sort(sortOptions[sortBy] || sortOptions.newest)
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    const total = await Property.countDocuments({ verificationStatus: 'verified' });

    res.status(200).json({
      success: true,
      data: { properties, total, page: parseInt(page), totalPages: Math.ceil(total / limit) },
    });
  } catch (error) {
    next(error);
  }
});

// Get featured properties
router.get('/featured', async (req, res, next) => {
  try {
    const properties = await Property.find({ isFeatured: true, verificationStatus: 'verified' })
      .populate('listedBy', 'firstName lastName')
      .limit(10);

    res.status(200).json({
      success: true,
      data: { properties },
    });
  } catch (error) {
    next(error);
  }
});

// Get single property
router.get('/:id', async (req, res, next) => {
  try {
    const property = await Property.findById(req.params.id)
      .populate('listedBy', 'firstName lastName email phoneNumber')
      .populate('agent', 'firstName lastName email phoneNumber');

    if (!property) {
      return res.status(404).json({ success: false, message: 'Property not found' });
    }

    // Increment view count
    property.viewCount += 1;
    await property.save();

    res.status(200).json({ success: true, data: property });
  } catch (error) {
    next(error);
  }
});

// Create property (protected)
router.post('/', protect, async (req, res, next) => {
  try {
    req.body.listedBy = req.user._id;
    req.body.verificationStatus = 'pending';

    const property = await Property.create(req.body);
    res.status(201).json({ success: true, data: property });
  } catch (error) {
    next(error);
  }
});

// Update property (protected)
router.put('/:id', protect, async (req, res, next) => {
  try {
    let property = await Property.findById(req.params.id);
    if (!property) {
      return res.status(404).json({ success: false, message: 'Property not found' });
    }

    // Check ownership
    if (property.listedBy.toString() !== req.user._id.toString() && req.user.role !== 'super_admin') {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }

    property = await Property.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    res.status(200).json({ success: true, data: property });
  } catch (error) {
    next(error);
  }
});

// Delete property (protected)
router.delete('/:id', protect, async (req, res, next) => {
  try {
    const property = await Property.findById(req.params.id);
    if (!property) {
      return res.status(404).json({ success: false, message: 'Property not found' });
    }

    if (property.listedBy.toString() !== req.user._id.toString() && req.user.role !== 'super_admin') {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }

    await property.deleteOne();
    res.status(200).json({ success: true, message: 'Property deleted' });
  } catch (error) {
    next(error);
  }
});

// Toggle favorite
router.post('/:id/favorite', protect, async (req, res, next) => {
  try {
    const existing = await Favorite.findOne({ userId: req.user._id, propertyId: req.params.id });

    if (existing) {
      await Favorite.deleteOne({ _id: existing._id });
      await Property.findByIdAndUpdate(req.params.id, { $inc: { favoriteCount: -1 } });
      return res.status(200).json({ success: true, message: 'Removed from favorites' });
    }

    await Favorite.create({ userId: req.user._id, propertyId: req.params.id });
    await Property.findByIdAndUpdate(req.params.id, { $inc: { favoriteCount: 1 } });
    res.status(200).json({ success: true, message: 'Added to favorites' });
  } catch (error) {
    next(error);
  }
});

// Get user's favorites
router.get('/favorites', protect, async (req, res, next) => {
  try {
    const favorites = await Favorite.find({ userId: req.user._id })
      .populate({
        path: 'propertyId',
        populate: { path: 'listedBy', select: 'firstName lastName' },
      })
      .sort({ createdAt: -1 });

    res.status(200).json({ success: true, data: favorites });
  } catch (error) {
    next(error);
  }
});

// Get my listings
router.get('/my-listings', protect, async (req, res, next) => {
  try {
    const properties = await Property.find({ listedBy: req.user._id }).sort({ createdAt: -1 });
    res.status(200).json({ success: true, data: properties });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
