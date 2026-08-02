// config/cloudinary.js
require('dotenv').config(); // Ensure env is loaded no matter what

const cloudinary = require('cloudinary').v2;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Debug: confirm it's configured
console.log('Cloudinary configured for:', process.env.CLOUDINARY_CLOUD_NAME);

module.exports = cloudinary;