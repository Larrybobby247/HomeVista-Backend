/**
 * HomeVista Backend - Property Controller
 * Handles property listings CRUD, search, favorites
 */

const Property = require('../models/Property');
const User = require('../models/User');
const Favorite = require('../models/Favorite');

/**
 * @desc    Get all properties with filters
 * @route   GET /api/properties
 * @access  Public
 */
const getProperties = async (req, res, next) => {
  try {
    const {
      status,
      propertyType,
      city,
      state,
      minPrice,
      maxPrice,
      minBedrooms,
      sortBy = 'createdAt',
      page = 1,
      limit = 10,
    } = req.query;

    // Build filter object
    const filter = { verificationStatus: 'verified' };

    if (status) filter.status = status;
    if (propertyType) filter.propertyType = propertyType;
    if (city) filter.city = { $regex: city, $options: 'i' };
    if (state) filter.state = { $regex: state, $options: 'i' };
    if (minPrice || maxPrice) {
      filter.price = {};
      if (minPrice) filter.price.$gte = Number(minPrice);
      if (maxPrice) filter.price.$lte = Number(maxPrice);
    }
    if (minBedrooms) filter.bedrooms = { $gte: Number(minBedrooms) };

    // Sort options
    const sortOptions = {};
    if (sortBy === 'price_asc') sortOptions.price = 1;
    else if (sortBy === 'price_desc') sortOptions.price = -1;
    else if (sortBy === 'newest') sortOptions.createdAt = -1;
    else if (sortBy === 'oldest') sortOptions.createdAt = 1;
    else if (sortBy === 'popular') sortOptions.viewCount = -1;
    else sortOptions.createdAt = -1;

    // Pagination
    const skip = (Number(page) - 1) * Number(limit);

    const properties = await Property.find(filter)
      .populate('listedBy', 'firstName lastName email phoneNumber')
      .populate('agent', 'firstName lastName email phoneNumber')
      .sort(sortOptions)
      .skip(skip)
      .limit(Number(limit));

    const total = await Property.countDocuments(filter);

    res.status(200).json({
      success: true,
      data: {
        properties,
        total,
        page: Number(page),
        totalPages: Math.ceil(total / Number(limit)),
        hasNextPage: skip + properties.length < total,
        hasPrevPage: Number(page) > 1,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get single property by ID
 * @route   GET /api/properties/:id
 * @access  Public
 */
const getPropertyById = async (req, res, next) => {
  try {
    const property = await Property.findById(req.params.id)
      .populate('listedBy', 'firstName lastName email phoneNumber avatar')
      .populate('agent', 'firstName lastName email phoneNumber avatar');

    if (!property) {
      return res.status(404).json({
        success: false,
        message: 'Property not found',
      });
    }

    // Increment view count
    property.viewCount += 1;
    await property.save();

    res.status(200).json({
      success: true,
      data: property,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Create new property listing
 * @route   POST /api/properties
 * @access  Private
 */
const createProperty = async (req, res, next) => {
  try {
    const propertyData = {
      ...req.body,
      listedBy: req.user._id,
      listedByType: req.user.role === 'agent' ? 'agent' : req.user.role === 'seller' ? 'seller' : req.user.role === 'landlord' ? 'landlord' : 'owner',
    };

    const property = await Property.create(propertyData);

    res.status(201).json({
      success: true,
      message: 'Property listed successfully. Awaiting verification.',
      data: property,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Update property
 * @route   PUT /api/properties/:id
 * @access  Private
 */
const updateProperty = async (req, res, next) => {
  try {
    let property = await Property.findById(req.params.id);

    if (!property) {
      return res.status(404).json({
        success: false,
        message: 'Property not found',
      });
    }

    // Check ownership
    if (property.listedBy.toString() !== req.user._id.toString() && req.user.role !== 'super_admin') {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to update this property',
      });
    }

    property = await Property.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    );

    res.status(200).json({
      success: true,
      message: 'Property updated successfully',
      data: property,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Delete property
 * @route   DELETE /api/properties/:id
 * @access  Private
 */
const deleteProperty = async (req, res, next) => {
  try {
    const property = await Property.findById(req.params.id);

    if (!property) {
      return res.status(404).json({
        success: false,
        message: 'Property not found',
      });
    }

    // Check ownership
    if (property.listedBy.toString() !== req.user._id.toString() && req.user.role !== 'super_admin') {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to delete this property',
      });
    }

    await property.deleteOne();

    res.status(200).json({
      success: true,
      message: 'Property deleted successfully',
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get featured properties
 * @route   GET /api/properties/featured
 * @access  Public
 */
const getFeaturedProperties = async (req, res, next) => {
  try {
    const properties = await Property.find({
      isFeatured: true,
      verificationStatus: 'verified',
    })
      .populate('listedBy', 'firstName lastName')
      .sort({ createdAt: -1 })
      .limit(10);

    res.status(200).json({
      success: true,
      data: { properties },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get my listings
 * @route   GET /api/properties/my-listings
 * @access  Private
 */
const getMyListings = async (req, res, next) => {
  try {
    const properties = await Property.find({ listedBy: req.user._id })
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      data: { properties },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Toggle favorite
 * @route   POST /api/properties/:id/favorite
 * @access  Private
 */
const toggleFavorite = async (req, res, next) => {
  try {
    const propertyId = req.params.id;
    const userId = req.user._id;

    const existing = await Favorite.findOne({ userId, propertyId });

    if (existing) {
      await existing.deleteOne();
      await Property.findByIdAndUpdate(propertyId, { $inc: { favoriteCount: -1 } });
      return res.status(200).json({
        success: true,
        message: 'Removed from favorites',
        data: { isFavorite: false },
      });
    }

    await Favorite.create({ userId, propertyId });
    await Property.findByIdAndUpdate(propertyId, { $inc: { favoriteCount: 1 } });

    res.status(200).json({
      success: true,
      message: 'Added to favorites',
      data: { isFavorite: true },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get user favorites
 * @route   GET /api/properties/favorites
 * @access  Private
 */
const getFavorites = async (req, res, next) => {
  try {
    const favorites = await Favorite.find({ userId: req.user._id })
      .populate({
        path: 'propertyId',
        model: 'Property',
        populate: {
          path: 'listedBy',
          select: 'firstName lastName email phoneNumber',
        },
      })
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      data: favorites,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getProperties,
  getPropertyById,
  createProperty,
  updateProperty,
  deleteProperty,
  getFeaturedProperties,
  getMyListings,
  toggleFavorite,
  getFavorites,
};
