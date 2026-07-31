/**
 * HomeVista - Search Routes
 */

const express = require('express');
const router = express.Router();
const Property = require('../models/Property');

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

    if (query) {
      searchQuery.$text = { $search: query };
    }
    if (propertyType && propertyType.length > 0) {
      searchQuery.propertyType = { $in: propertyType };
    }
    if (status && status.length > 0) {
      searchQuery.status = { $in: status };
    }
    if (minPrice !== undefined || maxPrice !== undefined) {
      searchQuery.price = {};
      if (minPrice !== undefined) searchQuery.price.$gte = minPrice;
      if (maxPrice !== undefined) searchQuery.price.$lte = maxPrice;
    }
    if (minBedrooms !== undefined) {
      searchQuery.bedrooms = { $gte: minBedrooms };
    }
    if (city) searchQuery.city = { $regex: city, $options: 'i' };
    if (state) searchQuery.state = { $regex: state, $options: 'i' };
    if (amenities && amenities.length > 0) {
      searchQuery.amenities = { $all: amenities };
    }
    if (furnished !== undefined) searchQuery.furnished = furnished;

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
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    const total = await Property.countDocuments(searchQuery);

    res.status(200).json({
      success: true,
      data: {
        properties,
        total,
        page: parseInt(page),
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    next(error);
  }
});

router.get('/suggestions', async (req, res, next) => {
  try {
    const { q } = req.query;
    if (!q || q.length < 2) {
      return res.status(200).json({ success: true, data: [] });
    }

    const properties = await Property.find(
      { $text: { $search: q }, verificationStatus: 'verified' },
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
