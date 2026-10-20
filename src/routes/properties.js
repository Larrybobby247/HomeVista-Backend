/**
 * HomeVista - Property Routes
 */

const express = require('express');
const router = express.Router();
const multer = require('multer');
const cloudinary = require('../config/cloudinary');
const { protect, optionalAuth } = require('../middleware/auth');
const Property = require('../models/Property');
const Favorite = require('../models/Favorite');
const Inquiry = require('../models/Inquiry');
const User = require('../models/User');
const { notify } = require('../services/notificationService');

const { POSTER_FIELDS, UNAVAILABLE, decorate, toRad, haversineKm } = require('../utils/propertyHelpers');

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
router.get('/', optionalAuth, async (req, res, next) => {
  try {
    const { limit = 10, page = 1, sortBy = 'newest' } = req.query;
    const sortOptions = {
      newest: { createdAt: -1 },
      oldest: { createdAt: 1 },
      price_asc: { price: 1 },
      price_desc: { price: -1 },
      popular: { viewCount: -1 },
    };

    const [found, total] = await Promise.all([
      Property.find({ verificationStatus: 'verified' })
        .populate('listedBy', POSTER_FIELDS)
        .sort(sortOptions[sortBy] || sortOptions.newest)
        .skip((page - 1) * limit)
        .limit(parseInt(limit)),
      Property.countDocuments({ verificationStatus: 'verified' }),
    ]);
    const properties = await decorate(found, req.user);

    res.status(200).json({
      success: true,
      data: { properties, total, page: parseInt(page), totalPages: Math.ceil(total / limit) },
    });
  } catch (error) {
    next(error);
  }
});

// Get featured properties (sold / rented properties are never featured)
router.get('/featured', optionalAuth, async (req, res, next) => {
  try {
    // Safety net: anything featured that has since sold is un-featured on the fly
    await Property.updateMany({ isFeatured: true, status: { $in: UNAVAILABLE } }, { isFeatured: false });

    const found = await Property.find({
      isFeatured: true,
      verificationStatus: 'verified',
      status: { $nin: UNAVAILABLE },
    })
      .populate('listedBy', POSTER_FIELDS)
      .limit(10);

    res.status(200).json({ success: true, data: { properties: await decorate(found, req.user) } });
  } catch (error) {
    next(error);
  }
});

// Properties near a coordinate: GET /nearby?lat=..&lng=..&radius=10 (km)
router.get('/nearby', optionalAuth, async (req, res, next) => {
  try {
    const lat = parseFloat(req.query.lat);
    const lng = parseFloat(req.query.lng);
    const radius = Math.min(parseFloat(req.query.radius) || 10, 200);
    const limit = Math.min(parseInt(req.query.limit) || 20, 50);
    if (Number.isNaN(lat) || Number.isNaN(lng)) {
      return res.status(400).json({ success: false, message: 'lat and lng are required' });
    }

    // Cheap bounding-box pre-filter in Mongo, exact distance in code
    const dLat = radius / 111;
    const dLng = radius / (111 * Math.max(Math.cos(toRad(lat)), 0.01));
    const candidates = await Property.find({
      verificationStatus: 'verified',
      status: { $nin: UNAVAILABLE },
      'coordinates.latitude': { $gte: lat - dLat, $lte: lat + dLat },
      'coordinates.longitude': { $gte: lng - dLng, $lte: lng + dLng },
    })
      .populate('listedBy', POSTER_FIELDS)
      .limit(300);

    const withDistance = candidates
      .map((p) => ({ p, d: haversineKm(lat, lng, p.coordinates.latitude, p.coordinates.longitude) }))
      .filter((x) => x.d <= radius)
      .sort((a, b) => a.d - b.d)
      .slice(0, limit);

    const decorated = await decorate(withDistance.map((x) => x.p), req.user);
    const properties = decorated.map((p, i) => ({ ...p, distanceKm: Math.round(withDistance[i].d * 10) / 10 }));

    res.status(200).json({ success: true, data: { properties, radius } });
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
        // Listings always start pending: only an admin can verify
        verificationStatus: 'pending',
        coordinates,
        images: [...existingImages, ...uploadedImages],
        videos: [...existingVideos, ...uploadedVideos],
        listedBy: req.user._id,
      };

      const property = await Property.create(propertyData);
      res.status(201).json({ success: true, data: property });

      notify(req.user._id, {
        type: 'listing_submitted',
        title: 'Listing submitted for review',
        message: `"${property.title}" is being reviewed. We'll notify you as soon as it's approved.`,
        data: { propertyId: String(property._id), screen: 'property' },
        skipEmail: true,
      });
      User.find({ role: 'super_admin' }).select('_id').lean().then((admins) =>
        admins.forEach((a) =>
          notify(a._id, {
            type: 'listing_submitted',
            title: 'New listing awaiting review',
            message: `"${property.title}" in ${property.city} needs approval.`,
            data: { propertyId: String(property._id), screen: 'admin_listings' },
            skipEmail: true,
          })
        )
      ).catch(() => {});
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
        populate: { path: 'listedBy', select: POSTER_FIELDS },
      })
      .sort({ createdAt: -1 });

    // Drop favourites whose property has been deleted, and flag the rest as favourited
    const data = favorites
      .filter((f) => f.propertyId)
      .map((f) => {
        const obj = f.toObject({ virtuals: true });
        obj.propertyId.isFavorited = true;
        return obj;
      });

    res.status(200).json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

// Just the ids the user has favourited (cheap; lets every screen show the right heart)
router.get('/favorites/ids', protect, async (req, res, next) => {
  try {
    const favs = await Favorite.find({ userId: req.user._id }).select('propertyId').lean();
    res.status(200).json({ success: true, data: favs.map((f) => String(f.propertyId)) });
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
        ...(body.verificationStatus !== undefined && req.user.role === 'super_admin' && { verificationStatus: body.verificationStatus }),
        amenities,
        features,
        images: [...existingImages, ...uploadedImages],
        videos: [...existingVideos, ...uploadedVideos],
      };

      // A property that is no longer available can't stay featured
      if (updates.status && UNAVAILABLE.includes(updates.status)) {
        updates.isFeatured = false;
        if (updates.status !== 'reserved') updates.soldAt = new Date();
      }

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
router.get('/:id', optionalAuth, async (req, res, next) => {
  try {
    const property = await Property.findByIdAndUpdate(req.params.id, { $inc: { viewCount: 1 } }, { new: true })
      .populate('listedBy', POSTER_FIELDS)
      .populate('agent', POSTER_FIELDS);

    if (!property) {
      return res.status(404).json({ success: false, message: 'Property not found' });
    }

    const [data] = await decorate([property], req.user);
    res.status(200).json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

// Toggle favorite
router.post('/:id/favorite', protect, async (req, res, next) => {
  try {
    const exists = await Property.exists({ _id: req.params.id });
    if (!exists) return res.status(404).json({ success: false, message: 'Property not found' });

    const existing = await Favorite.findOne({ userId: req.user._id, propertyId: req.params.id });

    if (existing) {
      await Favorite.deleteOne({ _id: existing._id });
      await Property.updateOne({ _id: req.params.id, favoriteCount: { $gt: 0 } }, { $inc: { favoriteCount: -1 } });
      return res.status(200).json({ success: true, message: 'Removed from favorites', data: { isFavorited: false } });
    }

    await Favorite.create({ userId: req.user._id, propertyId: req.params.id });
    await Property.updateOne({ _id: req.params.id }, { $inc: { favoriteCount: 1 } });
    res.status(200).json({ success: true, message: 'Added to favorites', data: { isFavorited: true } });
  } catch (error) {
    next(error);
  }
});

// ── Inquiry, inspection request, offer: stored and sent to the poster as a notification ──
const makeInquiryHandler = (kind) => async (req, res, next) => {
  try {
    const property = await Property.findById(req.params.id).select('title listedBy');
    if (!property) return res.status(404).json({ success: false, message: 'Property not found' });
    if (String(property.listedBy) === String(req.user._id)) {
      return res.status(400).json({ success: false, message: 'You cannot send this to your own listing' });
    }

    const { message, date, notes, amount } = req.body;
    if (kind === 'offer' && !(Number(amount) > 0)) {
      return res.status(400).json({ success: false, message: 'A valid offer amount is required' });
    }
    if (kind === 'inspection_request' && !date) {
      return res.status(400).json({ success: false, message: 'An inspection date is required' });
    }

    const inquiry = await Inquiry.create({
      propertyId: property._id,
      senderId: req.user._id,
      receiverId: property.listedBy,
      type: kind,
      message: message || notes || (kind === 'offer' ? 'New offer' : kind === 'inspection_request' ? 'Inspection request' : 'Inquiry'),
      inspectionDate: kind === 'inspection_request' ? new Date(date) : undefined,
      offerAmount: kind === 'offer' ? Number(amount) : undefined,
    });
    await Property.updateOne({ _id: property._id }, { $inc: { inquiryCount: 1 } });

    res.status(201).json({ success: true, data: inquiry });

    const sender = (req.user.companyName && req.user.companyName.trim()) || `${req.user.firstName} ${req.user.lastName}`;
    const copy = {
      inquiry: { type: 'new_inquiry', title: `New inquiry on ${property.title}`, message: `${sender}: ${inquiry.message}` },
      inspection_request: {
        type: 'inspection_scheduled',
        title: `Inspection requested for ${property.title}`,
        message: `${sender} would like to inspect on ${new Date(date).toDateString()}.`,
      },
      offer: {
        type: 'offer_received',
        title: `New offer on ${property.title}`,
        message: `${sender} offered ₦${Number(amount).toLocaleString('en-NG')}.`,
      },
    }[kind];
    notify(property.listedBy, { ...copy, data: { propertyId: String(property._id), inquiryId: String(inquiry._id), screen: 'inquiry' } });
  } catch (error) {
    next(error);
  }
};
router.post('/:id/inquiry', protect, makeInquiryHandler('inquiry'));
router.post('/:id/inspection', protect, makeInquiryHandler('inspection_request'));
router.post('/:id/offer', protect, makeInquiryHandler('offer'));

module.exports = router;