/**
 * HomeVista - Property Routes
 */

const express = require('express');
const router = express.Router();
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const { protect } = require('../middleware/auth');
const Property = require('../models/Property');
const Favorite = require('../models/Favorite');

// Multer stores files in memory so we can stream them to Cloudinary
const upload = multer({ storage: multer.memoryStorage() });

// Helper: upload a file buffer to Cloudinary
const uploadToCloudinary = (buffer, resourceType = 'image') => {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: resourceType === 'video' ? 'homevista/properties/videos' : 'homevista/properties',
        resource_type: resourceType,
      },
      (error, result) => {
        if (error) return reject(error);
        resolve({ url: result.secure_url, publicId: result.public_id });
      }
    );
    stream.end(buffer);
  });
};

// Parse helper for JSON string fields coming from FormData
const parseJSONField = (value, fallback = []) => {
  if (!value) return fallback;
  try { return JSON.parse(value); } catch (e) { return fallback; }
};

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

// Create property (protected) — now accepts multipart form-data
router.post(
  '/',
  protect,
  upload.fields([
    { name: 'images', maxCount: 10 },
    { name: 'videos', maxCount: 3 },
  ]),
  async (req, res, next) => {
    try {
      // 1. Parse text fields
      const body = req.body;

      // 2. Parse JSON string arrays
      const amenities = parseJSONField(body.amenities);
      const features = parseJSONField(body.features);
      const existingImages = parseJSONField(body.existingImages);
      const existingVideos = parseJSONField(body.existingVideos);

      // 3. Upload NEW files to Cloudinary
      const newImageFiles = req.files?.images || [];
      const newVideoFiles = req.files?.videos || [];

      const uploadedImages = await Promise.all(
        newImageFiles.map((file) => uploadToCloudinary(file.buffer, 'image'))
      );
      const uploadedVideos = await Promise.all(
        newVideoFiles.map((file) => uploadToCloudinary(file.buffer, 'video'))
      );

      // 4. Build coordinates
      const coordinates =
        body.longitude && body.latitude
          ? { longitude: parseFloat(body.longitude), latitude: parseFloat(body.latitude) }
          : { longitude: 3.3792, latitude: 6.5244 };

      // 5. Build property data
      const propertyData = {
        title: body.title,
        description: body.description,
        price: Number(body.price),
        currency: body.currency || 'NGN',
        propertyType: body.propertyType,
        status: body.status,
        bedrooms: Number(body.bedrooms || 0),
        bathrooms: Number(body.bathrooms || 0),
        floorArea: Number(body.floorArea || 0),
        address: body.address,
        city: body.city,
        state: body.state,
        country: body.country || 'Nigeria',
        furnished: body.furnished === 'true' || body.furnished === true,
        amenities,
        features,
        listedByType: body.listedByType,
        verificationStatus: body.verificationStatus || 'pending',
        coordinates,
        images: [...existingImages, ...uploadedImages],
        videos: [...existingVideos, ...uploadedVideos],
        listedBy: req.user._id,
      };

      const property = await Property.create(propertyData);
      res.status(201).json({ success: true, data: property });
    } catch (error) {
      next(error);
    }
  }
);

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

// Update property (protected) — now accepts multipart form-data
router.put(
  '/:id',
  protect,
  upload.fields([
    { name: 'images', maxCount: 10 },
    { name: 'videos', maxCount: 3 },
  ]),
  async (req, res, next) => {
    try {
      let property = await Property.findById(req.params.id);
      if (!property) {
        return res.status(404).json({ success: false, message: 'Property not found' });
      }

      // Check ownership
      if (property.listedBy.toString() !== req.user._id.toString() && req.user.role !== 'super_admin') {
        return res.status(403).json({ success: false, message: 'Not authorized' });
      }

      const body = req.body;

      // Parse JSON string arrays (fallback to current DB values)
      const amenities = parseJSONField(body.amenities, property.amenities);
      const features = parseJSONField(body.features, property.features);
      const existingImages = parseJSONField(body.existingImages, property.images || []);
      const existingVideos = parseJSONField(body.existingVideos, property.videos || []);

      // Upload NEW files to Cloudinary
      const newImageFiles = req.files?.images || [];
      const newVideoFiles = req.files?.videos || [];

      const uploadedImages = await Promise.all(
        newImageFiles.map((file) => uploadToCloudinary(file.buffer, 'image'))
      );
      const uploadedVideos = await Promise.all(
        newVideoFiles.map((file) => uploadToCloudinary(file.buffer, 'video'))
      );

      // Build update object
      const updates = {
        ...(body.title !== undefined && { title: body.title }),
        ...(body.description !== undefined && { description: body.description }),
        ...(body.price !== undefined && { price: Number(body.price) }),
        ...(body.propertyType !== undefined && { propertyType: body.propertyType }),
        ...(body.status !== undefined && { status: body.status }),
        ...(body.bedrooms !== undefined && { bedrooms: Number(body.bedrooms) }),
        ...(body.bathrooms !== undefined && { bathrooms: Number(body.bathrooms) }),
        ...(body.floorArea !== undefined && { floorArea: Number(body.floorArea) }),
        ...(body.address !== undefined && { address: body.address }),
        ...(body.city !== undefined && { city: body.city }),
        ...(body.state !== undefined && { state: body.state }),
        ...(body.country !== undefined && { country: body.country }),
        ...(body.listedByType !== undefined && { listedByType: body.listedByType }),
        ...(body.verificationStatus !== undefined && { verificationStatus: body.verificationStatus }),
        amenities,
        features,
        images: [...existingImages, ...uploadedImages],
        videos: [...existingVideos, ...uploadedVideos],
      };

      if (body.longitude !== undefined && body.latitude !== undefined) {
        updates.coordinates = {
          longitude: parseFloat(body.longitude),
          latitude: parseFloat(body.latitude),
        };
      }

      property = await Property.findByIdAndUpdate(req.params.id, updates, {
        new: true,
        runValidators: true,
      });
      res.status(200).json({ success: true, data: property });
    } catch (error) {
      next(error);
    }
  }
);

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

module.exports = router;