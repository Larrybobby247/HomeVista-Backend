/**
 * HomeVista - Search Routes (FIXED)
 */

const express = require('express');
const router = express.Router();
const Property = require('../models/Property');

// Helper: safely parse numbers
const toNum = (val) => {
  if (val === undefined || val === null || val === '') return undefined;
  const n = Number(val);
  return isNaN(n) ? undefined : n;
};

router.post('/', async (req, res, next) => {
  try {
    const {
      query,
      propertyType,
      status,
      minPrice,
      maxPrice,
      minBedrooms,
      maxBedrooms,
      city,
      state,
      amenities,
      furnished,
      sortBy = 'relevance',
      page = 1,
      limit = 20,
    } = req.body;

    const searchQuery = { verificationStatus: 'verified' };

    // Text search
    if (query && String(query).trim()) {
      searchQuery.$text = { $search: String(query).trim() };
    }

    // ====== FIX #1: Case-insensitive property type ======
    if (propertyType && propertyType.length > 0) {
      const types = Array.isArray(propertyType) ? propertyType : [propertyType];
      // Use $regex with case-insensitive flag instead of exact $in
      searchQuery.$and = searchQuery.$and || [];
      searchQuery.$and.push({
        $or: types.map(t => ({
          propertyType: { $regex: `^${t}$`, $options: 'i' }
        }))
      });
    }

    // ====== FIX #2: Case-insensitive status ======
    if (status && status.length > 0) {
      const statuses = Array.isArray(status) ? status : [status];
      searchQuery.$and = searchQuery.$and || [];
      searchQuery.$and.push({
        $or: statuses.map(s => ({
          status: { $regex: `^${s}$`, $options: 'i' }
        }))
      });
    }

    // ====== FIX #3: Parse numbers safely ======
    const parsedMinPrice = toNum(minPrice);
    const parsedMaxPrice = toNum(maxPrice);
    const parsedMinBedrooms = toNum(minBedrooms);
    const parsedMaxBedrooms = toNum(maxBedrooms);

    if (parsedMinPrice !== undefined || parsedMaxPrice !== undefined) {
      searchQuery.price = {};
      if (parsedMinPrice !== undefined) searchQuery.price.$gte = parsedMinPrice;
      if (parsedMaxPrice !== undefined) searchQuery.price.$lte = parsedMaxPrice;
    }

    // ====== FIX #4: Support maxBedrooms ======
    if (parsedMinBedrooms !== undefined || parsedMaxBedrooms !== undefined) {
      searchQuery.bedrooms = {};
      if (parsedMinBedrooms !== undefined) searchQuery.bedrooms.$gte = parsedMinBedrooms;
      if (parsedMaxBedrooms !== undefined) searchQuery.bedrooms.$lte = parsedMaxBedrooms;
    }

    if (city) searchQuery.city = { $regex: city, $options: 'i' };
    if (state) searchQuery.state = { $regex: state, $options: 'i' };

    if (amenities && amenities.length > 0) {
      const ams = Array.isArray(amenities) ? amenities : [amenities];
      searchQuery.amenities = { $all: ams };
    }

    if (furnished !== undefined) {
      searchQuery.furnished = furnished === true || furnished === 'true' || furnished === 1;
    }

    // ====== FIX #5: Debug log so you can see the actual query ======
    console.log('\n[SEARCH] Filters received:', { propertyType, status, minPrice, maxPrice });
    console.log('[SEARCH] MongoDB query:', JSON.stringify(searchQuery, null, 2));

    const sortOptions = {
      relevance: query ? { score: { $meta: 'textScore' } } : { createdAt: -1 },
      newest: { createdAt: -1 },
      oldest: { createdAt: 1 },
      price_asc: { price: 1 },
      price_desc: { price: -1 },
      popular: { viewCount: -1 },
    };

    const properties = await Property.find(searchQuery)
      .populate('listedBy', 'firstName lastName email phoneNumber')
      .sort(sortOptions[sortBy] || sortOptions.relevance)
      .skip((parseInt(page) - 1) * parseInt(limit))
      .limit(parseInt(limit));

    const total = await Property.countDocuments(searchQuery);

    console.log(`[SEARCH] Found ${total} total properties\n`);

    res.status(200).json({
      success: true,
      data: {
        properties,
        total,
        page: parseInt(page),
        totalPages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error('[SEARCH ERROR]', error.message);
    next(error);
  }
});

router.get('/suggestions', async (req, res, next) => {
  try {
    const { q } = req.query;
    if (!q || String(q).length < 2) {
      return res.status(200).json({ success: true, data: [] });
    }

    const properties = await Property.find(
      { $text: { $search: String(q) }, verificationStatus: 'verified' },
      { score: { $meta: 'textScore' } }
    )
      .sort({ score: { $meta: 'textScore' } })
      .limit(5)
      .select('title city state');

    const suggestions = properties.map(p => `${p.title} - ${p.city}, ${p.state}`);
    res.status(200).json({ success: true, data: suggestions });
  } catch (error) {
    next(error);
  }
});

module.exports = router;