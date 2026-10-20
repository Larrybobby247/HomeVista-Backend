/**
 * Shared helpers for property responses
 */
const Favorite = require('../models/Favorite');

// What the app may see about the person who posted a property
const POSTER_FIELDS = 'firstName lastName email phoneNumber avatar companyName role isVerified';
const UNAVAILABLE = ['sold', 'rented', 'reserved'];

// Adds `isFavorited` (and posterName) to each property for the signed-in user
const decorate = async (properties, user) => {
  const list = properties.map((p) => (p.toObject ? p.toObject({ virtuals: true }) : p));
  let favSet = new Set();
  if (user && list.length) {
    const favs = await Favorite.find({ userId: user._id, propertyId: { $in: list.map((p) => p._id) } })
      .select('propertyId').lean();
    favSet = new Set(favs.map((f) => String(f.propertyId)));
  }
  return list.map((p) => {
    const poster = p.listedBy && typeof p.listedBy === 'object' ? p.listedBy : null;
    return {
      ...p,
      isFavorited: favSet.has(String(p._id)),
      posterName: poster
        ? (poster.companyName && poster.companyName.trim()) || `${poster.firstName || ''} ${poster.lastName || ''}`.trim()
        : undefined,
    };
  });
};

const toRad = (d) => (d * Math.PI) / 180;
const haversineKm = (lat1, lon1, lat2, lon2) => {
  const a =
    Math.sin(toRad(lat2 - lat1) / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(toRad(lon2 - lon1) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(a));
};


module.exports = { POSTER_FIELDS, UNAVAILABLE, decorate, toRad, haversineKm };
