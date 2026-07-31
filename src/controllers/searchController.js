/**
 * HomeVista Backend - Search Controller
 * Advanced property search with filters
 */

const Property = require('../models/Property');

/**
 * @desc    Search properties with advanced filters
 * @route   POST /api/search
 * @access  Public
 */
const searchProperties = async (req, res, next) => {
  try {
    const {
      query,
      location,
      city,
      state,
      propertyType,
      status,
      minPrice,
      maxPrice,
      minBedrooms,
      maxBedrooms,
      minBathrooms,
      minFloorArea,
      maxFloorArea,
      furnished,
      amenities,
      features,
      yearBuiltMin,
      yearBuiltMax,
      listedByType,
      verificationStatus,
      isFeatured,
      sortBy = 'relevance',
      page = 1,
      limit = 20,
    } = req.body;

    // Build search filter
    const filter = {};

    // Only show verified properties in search
    filter.verificationStatus = 'verified';

    // Text search
    if (query) {
      filter.$text = { $search: query };
    }

    // Location filters
    if (location) {
      filter.$or = [
        { city: { $regex: location, $options: 'i' } },
        { state: { $regex: location, $options: 'i' } },
        { address: { $regex: location, $options: 'i' } },
      ];
    }
    if (city) filter.city = { $regex: city, $options: 'i' };
    if (state) filter.state = { $regex: state, $options: 'i' };

    // Property type
    if (propertyType && propertyType.length > 0) {
      filter.propertyType = { $in: propertyType };
    }

    // Status
    if (status && status.length > 0) {
      filter.status = { $in: status };
    }

    // Price range
    if (minPrice !== undefined || maxPrice !== undefined) {
      filter.price = {};
      if (minPrice !== undefined) filter.price.$gte = minPrice;
      if (maxPrice !== undefined) filter.price.$lte = maxPrice;
    }

    // Bedrooms
    if (minBedrooms !== undefined || maxBedrooms !== undefined) {
      filter.bedrooms = {};
      if (minBedrooms !== undefined) filter.bedrooms.$gte = minBedrooms;
      if (maxBedrooms !== undefined) filter.bedrooms.$lte = maxBedrooms;
    }

    // Bathrooms
    if (minBathrooms !== undefined) {
      filter.bathrooms = { $gte: minBathrooms };
    }

    // Floor area
    if (minFloorArea !== undefined || maxFloorArea !== undefined) {
      filter.floorArea = {};
      if (minFloorArea !== undefined) filter.floorArea.$gte = minFloorArea;
      if (maxFloorArea !== undefined) filter.floorArea.$lte = maxFloorArea;
    }

    // Furnished
    if (furnished !== undefined) {
      filter.furnished = furnished;
    }

    // Amenities
    if (amenities && amenities.length > 0) {
      filter.amenities = { $all: amenities };
    }

    // Features
    if (features && features.length > 0) {
      filter.features = { $all: features };
    }

    // Year built
    if (yearBuiltMin !== undefined || yearBuiltMax !== undefined) {
      filter.yearBuilt = {};
      if (yearBuiltMin !== undefined) filter.yearBuilt.$gte = yearBuiltMin;
      if (yearBuiltMax !== undefined) filter.yearBuilt.$lte = yearBuiltMax;
    }

    // Listed by type
    if (listedByType && listedByType.length > 0) {
      filter.listedByType = { $in: listedByType };
    }

    // Featured
    if (isFeatured !== undefined) {
      filter.isFeatured = isFeatured;
    }

    // Sort options
    const sortOptions = {};
    if (sortBy === 'price_asc') sortOptions.price = 1;
    else if (sortBy === 'price_desc') sortOptions.price = -1;
    else if (sortBy === 'newest') sortOptions.createdAt = -1;
    else if (sortBy === 'oldest') sortOptions.createdAt = 1;
    else if (sortBy === 'popular') sortOptions.viewCount = -1;
    else if (query) sortOptions.score = { $meta: 'textScore' };
    else sortOptions.createdAt = -1;

    // Pagination
    const skip = (Number(page) - 1) * Number(limit);

    const properties = await Property.find(filter)
      .populate('listedBy', 'firstName lastName email phoneNumber')
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
        filters: req.body,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get search suggestions
 * @route   GET /api/search/suggestions
 * @access  Public
 */
const getSuggestions = async (req, res, next) => {
  try {
    const { q } = req.query;

    if (!q || q.length < 2) {
      return res.status(200).json({
        success: true,
        data: [],
      });
    }

    // Search in cities, states, and property titles
    const cities = await Property.distinct('city', {
      city: { $regex: q, $options: 'i' },
      verificationStatus: 'verified',
    });

    const states = await Property.distinct('state', {
      state: { $regex: q, $options: 'i' },
      verificationStatus: 'verified',
    });

    const titles = await Property.distinct('title', {
      title: { $regex: q, $options: 'i' },
      verificationStatus: 'verified',
    }).limit(5);

    const suggestions = [
      ...cities.map((c) => `${c} properties`),
      ...states.map((s) => `${s} properties`),
      ...titles,
    ].slice(0, 10);

    res.status(200).json({
      success: true,
      data: suggestions,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get popular locations
 * @route   GET /api/search/popular-locations
 * @access  Public
 */
const getPopularLocations = async (req, res, next) => {
  try {
    const locations = await Property.aggregate([
      { $match: { verificationStatus: 'verified' } },
      {
        $group: {
          _id: { city: '$city', state: '$state' },
          count: { $sum: 1 },
        },
      },
      { $sort: { count: -1 } },
      { $limit: 10 },
    ]);

    res.status(200).json({
      success: true,
      data: locations.map((l) => ({
        city: l._id.city,
        state: l._id.state,
        count: l.count,
      })),
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  searchProperties,
  getSuggestions,
  getPopularLocations,
};
