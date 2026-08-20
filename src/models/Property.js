/**
 * HomeVista - Property Model (Updated)
 */

const mongoose = require('mongoose');

// Property Image Sub-Schema
const propertyImageSchema = new mongoose.Schema({
  url: { type: String, required: true },
  thumbnailUrl: { type: String },
  caption: { type: String, trim: true },
  isPrimary: { type: Boolean, default: false },
  order: { type: Number, default: 0 },
}, { _id: true });

// Coordinates Sub-Schema
const coordinatesSchema = new mongoose.Schema({
  latitude: { type: Number, required: true },
  longitude: { type: Number, required: true },
}, { _id: false });

// Main Property Schema
const propertySchema = new mongoose.Schema({
  title: {
    type: String,
    required: [true, 'Property title is required'],
    trim: true,
    maxlength: [200, 'Title cannot exceed 200 characters'],
  },
  description: {
    type: String,
    required: [true, 'Property description is required'],
    trim: true,
    maxlength: [5000, 'Description cannot exceed 5000 characters'],
  },
  price: {
    type: Number,
    required: [true, 'Price is required'],
    min: [0, 'Price cannot be negative'],
  },
  pricePerUnit: { type: Number },
  currency: { type: String, default: 'NGN' },

  // Property Details
  propertyType: {
    type: String,
    required: [true, 'Property type is required'],
    enum: ['apartment', 'house', 'villa', 'duplex', 'bungalow', 'mansion', 'penthouse', 'studio', 'condo', 'townhouse', 'commercial', 'land', 'office_space', 'warehouse', 'shop'],
  },

  // ─── UPDATED: status now includes sold/rented ───
  status: {
    type: String,
    required: [true, 'Property status is required'],
    enum: ['for_sale', 'for_rent', 'lease', 'shortlet', 'sold', 'rented', 'reserved'],
    default: 'for_sale',
  },

  bedrooms: { type: Number, min: 0 },
  bathrooms: { type: Number, min: 0 },
  toilets: { type: Number, min: 0 },
  parkingSpaces: { type: Number, min: 0 },
  totalRooms: { type: Number, min: 0 },
  floorArea: {
    type: Number,
    required: [true, 'Floor area is required'],
    min: [1, 'Floor area must be at least 1 sqm'],
  },
  lotSize: { type: Number, min: 0 },
  yearBuilt: { type: Number, min: 1800, max: new Date().getFullYear() + 5 },
  floors: { type: Number, min: 0 },
  furnished: { type: Boolean, default: false },

  // Location
  address: { type: String, required: [true, 'Address is required'], trim: true },
  city: { type: String, required: [true, 'City is required'], trim: true },
  state: { type: String, required: [true, 'State is required'], trim: true },
  country: { type: String, default: 'Nigeria', trim: true },
  zipCode: { type: String, trim: true },
  coordinates: { type: coordinatesSchema, required: true },
  neighborhood: { type: String, trim: true },
  landmarks: [{ type: String, trim: true }],

  // Media
  images: [propertyImageSchema],
  videos: [{ url: String, thumbnailUrl: String, caption: String, duration: Number }],
  virtualTourUrl: { type: String },
  floorPlanUrl: { type: String },

  // Features & Amenities
  amenities: [{ type: String, trim: true }],
  features: [{ type: String, trim: true }],

  // Listing Info
  listedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  listedByType: {
    type: String,
    enum: ['seller', 'agent', 'landlord'],
    required: true,
  },
  agent: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },

  // ─── NEW: Buyer/Tenant tracking ───
  buyer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
  },
  soldAt: { type: Date },

  // Verification & Status
  verificationStatus: {
    type: String,
    enum: ['pending', 'under_review', 'verified', 'rejected'],
    default: 'pending',
  },
  isFeatured: { type: Boolean, default: false },
  isPremium: { type: Boolean, default: false },

  // Analytics
  viewCount: { type: Number, default: 0 },
  favoriteCount: { type: Number, default: 0 },
  inquiryCount: { type: Number, default: 0 },

  // Pricing Details
  serviceCharge: { type: Number, min: 0 },
  cautionFee: { type: Number, min: 0 },
  legalFee: { type: Number, min: 0 },
  agencyFee: { type: Number, min: 0 },

  // Availability
  availableFrom: { type: Date },
  minimumLeasePeriod: { type: Number, min: 1 },

  // Admin Review
  adminNotes: { type: String, trim: true },
  reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  reviewedAt: { type: Date },
  rejectionReason: { type: String, trim: true },
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true },
});

// ─── Virtual: Check if property is unavailable ───
propertySchema.virtual('isUnavailable').get(function() {
  return ['sold', 'rented', 'reserved'].includes(this.status);
});

// Indexes
propertySchema.index({ title: 'text', description: 'text', address: 'text', city: 'text' });
propertySchema.index({ status: 1, verificationStatus: 1 });
propertySchema.index({ propertyType: 1 });
propertySchema.index({ price: 1 });
propertySchema.index({ city: 1, state: 1 });
propertySchema.index({ coordinates: '2dsphere' });
propertySchema.index({ isFeatured: 1 });
propertySchema.index({ listedBy: 1 });
propertySchema.index({ createdAt: -1 });
propertySchema.index({ buyer: 1 });

module.exports = mongoose.model('Property', propertySchema);