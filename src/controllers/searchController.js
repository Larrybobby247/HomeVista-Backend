/**
 * HomeVista Backend - Search Controller (FIXED)
 * Advanced property search with robust filter handling
 */

const Property = require('../models/Property');

/**
 * Helper: Parse arrays from various input formats
 * Handles: ["a","b"], "a,b", "a", undefined
 */
const parseArrayParam = (param) => {
  if (!param) return [];
  if (Array.isArray(param)) return param.filter(Boolean);
  if (typeof param === 'string') {
    // Handle comma-separated strings: "apartment,house" or single value
    return param.split(',').map(s => s.trim()).filter(Boolean);
  }
  return [];
};

/**
 * Helper: Parse number from various input formats
 * Handles: 5000000, "5000000", "5,000,000", undefined
 */
const parseNumberParam = (param) => {
  if (param === undefined || param === null || param === '') return undefined;
  if (typeof param === 'number') return param;
  if (typeof param === 'string') {
    // Remove commas and spaces, then parse
    const cleaned = param.replace(/[,\s]/g, '');
    const num = Number(cleaned);
    return isNaN(num) ? undefined : num;
  }
  return undefined;
};

/**
 * Helper: Parse boolean from various input formats
 */
const parseBooleanParam = (param) => {
  if (param === undefined || param === null) return undefined;
  if (typeof param === 'boolean') return param;
  if (typeof param === 'string') {
    const lower = param.toLowerCase().trim();
    if (lower === 'true' || lower === '1') return true;
    if (lower === 'false' || lower === '0') return false;
  }
  if (typeof param === 'number') return param === 1;
  return undefined;
};

/**
 * @desc    Search properties with advanced filters
 * @route   POST /api/search  OR  GET /api/search
 * @access  Public
 */
const searchProperties = async (req, res, next) => {
  try {
    // ====== FIX #1: Accept data from BOTH req.body (POST) and req.query (GET) ======
    const source = req.method === 'GET' ? req.query : req.body;

    console.log('\n[SEARCH DEBUG] Method:', req.method);
    console.log('[SEARCH DEBUG] Raw input:', JSON.stringify(source, null, 2));

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
    } = source;

    // ====== FIX #2: Parse and normalize all parameters ======
    const parsedPropertyType = parseArrayParam(propertyType);
    const parsedStatus = parseArrayParam(status);
    const parsedMinPrice = parseNumberParam(minPrice);
    const parsedMaxPrice = parseNumberParam(maxPrice);
    const parsedMinBedrooms = parseNumberParam(minBedrooms);
    const parsedMaxBedrooms = parseNumberParam(maxBedrooms);
    const parsedMinBathrooms = parseNumberParam(minBathrooms);
    const parsedMinFloorArea = parseNumberParam(minFloorArea);
    const parsedMaxFloorArea = parseNumberParam(maxFloorArea);
    const parsedFurnished = parseBooleanParam(furnished);
    const parsedAmenities = parseArrayParam(amenities);
    const parsedFeatures = parseArrayParam(features);
    const parsedYearBuiltMin = parseNumberParam(yearBuiltMin);
    const parsedYearBuiltMax = parseNumberParam(yearBuiltMax);
    const parsedListedByType = parseArrayParam(listedByType);
    const parsedIsFeatured = parseBooleanParam(isFeatured);
    const parsedPage = Math.max(1, parseNumberParam(page) || 1);
    const parsedLimit = Math.min(100, Math.max(1, parseNumberParam(limit) || 20));

    console.log('[SEARCH DEBUG] Parsed filters:', {
      propertyType: parsedPropertyType,
      status: parsedStatus,
      minPrice: parsedMinPrice,
      maxPrice: parsedMaxPrice,
      minBedrooms: parsedMinBedrooms,
      maxBedrooms: parsedMaxBedrooms,
      furnished: parsedFurnished,
      amenities: parsedAmenities,
    });

    // Build search filter
    const filter = {};

    // Only show verified properties in search (unless explicitly overridden)
    filter.verificationStatus = verificationStatus || 'verified';

    // Text search
    if (query && String(query).trim()) {
      const cleanQuery = String(query).trim();
      // Check if text index exists, if not fall back to regex
      try {
        filter.$text = { $search: cleanQuery };
      } catch (e) {
        // Fallback: search in title, description, city, state
        filter.$or = [
          { title: { $regex: cleanQuery, $options: 'i' } },
          { description: { $regex: cleanQuery, $options: 'i' } },
          { city: { $regex: cleanQuery, $options: 'i' } },
          { state: { $regex: cleanQuery, $options: 'i' } },
        ];
      }
    }

    // Location filters
    if (location && String(location).trim()) {
      const cleanLocation = String(location).trim();
      filter.$or = [
        { city: { $regex: cleanLocation, $options: 'i' } },
        { state: { $regex: cleanLocation, $options: 'i' } },
        { address: { $regex: cleanLocation, $options: 'i' } },
      ];
    }
    if (city && String(city).trim()) {
      filter.city = { $regex: String(city).trim(), $options: 'i' };
    }
    if (state && String(state).trim()) {
      filter.state = { $regex: String(state).trim(), $options: 'i' };
    }

    // ====== FIX #3: Case-insensitive property type matching ======
    if (parsedPropertyType.length > 0) {
      // Use $in with case-insensitive regex for each value
      filter.$and = filter.$and || [];
      filter.$and.push({
        $or: parsedPropertyType.map(pt => ({
          propertyType: { $regex: `^${pt}$`, $options: 'i' }
        }))
      });
    }

    // ====== FIX #4: Case-insensitive status matching ======
    if (parsedStatus.length > 0) {
      filter.$and = filter.$and || [];
      filter.$and.push({
        $or: parsedStatus.map(st => ({
          status: { $regex: `^${st}$`, $options: 'i' }
        }))
      });
    }

    // ====== FIX #5: Proper numeric price range ======
    if (parsedMinPrice !== undefined || parsedMaxPrice !== undefined) {
      filter.price = {};
      if (parsedMinPrice !== undefined) filter.price.$gte = parsedMinPrice;
      if (parsedMaxPrice !== undefined) filter.price.$lte = parsedMaxPrice;
    }

    // Bedrooms
    if (parsedMinBedrooms !== undefined || parsedMaxBedrooms !== undefined) {
      filter.bedrooms = {};
      if (parsedMinBedrooms !== undefined) filter.bedrooms.$gte = parsedMinBedrooms;
      if (parsedMaxBedrooms !== undefined) filter.bedrooms.$lte = parsedMaxBedrooms;
    }

    // Bathrooms
    if (parsedMinBathrooms !== undefined) {
      filter.bathrooms = { $gte: parsedMinBathrooms };
    }

    // Floor area
    if (parsedMinFloorArea !== undefined || parsedMaxFloorArea !== undefined) {
      filter.floorArea = {};
      if (parsedMinFloorArea !== undefined) filter.floorArea.$gte = parsedMinFloorArea;
      if (parsedMaxFloorArea !== undefined) filter.floorArea.$lte = parsedMaxFloorArea;
    }

    // Furnished
    if (parsedFurnished !== undefined) {
      filter.furnished = parsedFurnished;
    }

    // Amenities
    if (parsedAmenities.length > 0) {
      filter.amenities = { $all: parsedAmenities };
    }

    // Features
    if (parsedFeatures.length > 0) {
      filter.features = { $all: parsedFeatures };
    }

    // Year built
    if (parsedYearBuiltMin !== undefined || parsedYearBuiltMax !== undefined) {
      filter.yearBuilt = {};
      if (parsedYearBuiltMin !== undefined) filter.yearBuilt.$gte = parsedYearBuiltMin;
      if (parsedYearBuiltMax !== undefined) filter.yearBuilt.$lte = parsedYearBuiltMax;
    }

    // Listed by type
    if (parsedListedByType.length > 0) {
      filter.listedByType = { $in: parsedListedByType };
    }

    // Featured
    if (parsedIsFeatured !== undefined) {
      filter.isFeatured = parsedIsFeatured;
    }

    console.log('[SEARCH DEBUG] MongoDB filter:', JSON.stringify(filter, null, 2));

    // Sort options
    const sortOptions = {};
    if (sortBy === 'price_asc') sortOptions.price = 1;
    else if (sortBy === 'price_desc') sortOptions.price = -1;
    else if (sortBy === 'newest') sortOptions.createdAt = -1;
    else if (sortBy === 'oldest') sortOptions.createdAt = 1;
    else if (sortBy === 'popular') sortOptions.viewCount = -1;
    else if (query && filter.$text) sortOptions.score = { $meta: 'textScore' };
    else sortOptions.createdAt = -1;

    // Pagination
    const skip = (parsedPage - 1) * parsedLimit;

    const properties = await Property.find(filter)
      .populate('listedBy', 'firstName lastName email phoneNumber')
      .sort(sortOptions)
      .skip(skip)
      .limit(parsedLimit);

    const total = await Property.countDocuments(filter);

    console.log(`[SEARCH DEBUG] Found ${total} total, returning ${properties.length} properties\n`);

    res.status(200).json({
      success: true,
      data: {
        properties,
        total,
        page: parsedPage,
        totalPages: Math.ceil(total / parsedLimit),
        hasNextPage: skip + properties.length < total,
        hasPrevPage: parsedPage > 1,
        filters: {
          propertyType: parsedPropertyType,
          status: parsedStatus,
          minPrice: parsedMinPrice,
          maxPrice: parsedMaxPrice,
          minBedrooms: parsedMinBedrooms,
          maxBedrooms: parsedMaxBedrooms,
          furnished: parsedFurnished,
          amenities: parsedAmenities,
        },
      },
    });
  } catch (error) {
    console.error('[SEARCH ERROR]', error);
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

    if (!q || String(q).length < 2) {
      return res.status(200).json({
        success: true,
        data: [],
      });
    }

    const cleanQ = String(q).trim();

    // Search in cities, states, and property titles
    const cities = await Property.distinct('city', {
      city: { $regex: cleanQ, $options: 'i' },
      verificationStatus: 'verified',
    });

    const states = await Property.distinct('state', {
      state: { $regex: cleanQ, $options: 'i' },
      verificationStatus: 'verified',
    });

    const titles = await Property.distinct('title', {
      title: { $regex: cleanQ, $options: 'i' },
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