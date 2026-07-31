/**
 * HomeVista - User Model
 * Mongoose schema for user accounts with all required fields
 */

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

// Notification Preferences Sub-Schema
const notificationPreferencesSchema = new mongoose.Schema({
  emailNotifications: { type: Boolean, default: true },
  pushNotifications: { type: Boolean, default: true },
  smsNotifications: { type: Boolean, default: false },
  marketingEmails: { type: Boolean, default: false },
  newListingAlerts: { type: Boolean, default: true },
  priceDropAlerts: { type: Boolean, default: true },
  messageNotifications: { type: Boolean, default: true },
  paymentNotifications: { type: Boolean, default: true },
  inspectionReminders: { type: Boolean, default: true },
}, { _id: false });

// Privacy Settings Sub-Schema
const privacySettingsSchema = new mongoose.Schema({
  showPhoneNumber: { type: Boolean, default: false },
  showEmail: { type: Boolean, default: false },
  showLocation: { type: Boolean, default: false },
  allowSearchIndexing: { type: Boolean, default: true },
  profileVisibility: { type: String, enum: ['public', 'registered_only', 'private'], default: 'registered_only' },
}, { _id: false });

// Main User Schema
const userSchema = new mongoose.Schema({
  // Basic Info
  email: {
    type: String,
    required: [true, 'Email is required'],
    unique: true,
    lowercase: true,
    trim: true,
  },
  password: {
    type: String,
    required: [true, 'Password is required'],
    minlength: [8, 'Password must be at least 8 characters'],
    select: false, // Don't include password in queries by default
  },
  firstName: {
    type: String,
    required: [true, 'First name is required'],
    trim: true,
    minlength: [2, 'First name must be at least 2 characters'],
    maxlength: [50, 'First name cannot exceed 50 characters'],
  },
  lastName: {
    type: String,
    required: [true, 'Last name is required'],
    trim: true,
    minlength: [2, 'Last name must be at least 2 characters'],
    maxlength: [50, 'Last name cannot exceed 50 characters'],
  },
  phoneNumber: {
    type: String,
    required: [true, 'Phone number is required'],
    trim: true,
  },

  // Role & Status
  role: {
    type: String,
    enum: ['buyer', 'seller', 'tenant', 'landlord', 'agent', 'developer', 'property_manager', 'super_admin'],
    default: 'buyer',
  },
  status: {
    type: String,
    enum: ['active', 'inactive', 'suspended', 'pending_verification'],
    default: 'pending_verification',
  },

  // Profile
  avatar: {
    type: String,
    default: null,
  },
  bio: {
    type: String,
    maxlength: [500, 'Bio cannot exceed 500 characters'],
  },

  // Personal Details
  dateOfBirth: { type: Date },
  gender: { type: String, enum: ['male', 'female', 'other', 'prefer_not_to_say'] },
  nationality: { type: String, trim: true },
  stateOfOrigin: { type: String, trim: true },
  lga: { type: String, trim: true }, // Local Government Area

  // Address
  address: {
    type: String,
    required: [true, 'Address is required'],
    trim: true,
  },
  city: {
    type: String,
    required: [true, 'City is required'],
    trim: true,
  },
  state: {
    type: String,
    required: [true, 'State is required'],
    trim: true,
  },
  country: {
    type: String,
    required: [true, 'Country is required'],
    default: 'Nigeria',
    trim: true,
  },
  zipCode: { type: String, trim: true },

  // Identification
  idType: { type: String, enum: ['nin', 'passport', 'drivers_license', 'voters_card'] },
  idNumber: { type: String, trim: true },
  idDocumentUrl: { type: String },

  // Emergency Contact
  emergencyContactName: { type: String, trim: true },
  emergencyContactPhone: { type: String, trim: true },
  emergencyContactRelationship: { type: String, trim: true },

  // Professional Info
  companyName: { type: String, trim: true },
  companyRegistrationNumber: { type: String, trim: true },
  licenseNumber: { type: String, trim: true },
  yearsOfExperience: { type: Number, min: 0 },

  // Verification
  isVerified: { type: Boolean, default: false },
  isEmailVerified: { type: Boolean, default: false },
  isPhoneVerified: { type: Boolean, default: false },
  emailVerificationToken: { type: String, select: false },
  emailVerificationExpire: { type: Date, select: false },
  passwordResetToken: { type: String, select: false },
  passwordResetExpire: { type: Date, select: false },

  // Preferences
  notificationPreferences: {
    type: notificationPreferencesSchema,
    default: () => ({}),
  },
  privacySettings: {
    type: privacySettingsSchema,
    default: () => ({}),
  },

  // Bank Details (for payments)
  bankName: { type: String, trim: true },
  accountNumber: { type: String, trim: true },
  accountName: { type: String, trim: true },
  bvn: { type: String, trim: true }, // Bank Verification Number

  // Wallet
  walletBalance: { type: Number, default: 0, min: 0 },

  // Timestamps
  lastLoginAt: { type: Date },
}, {
  timestamps: true, // Adds createdAt and updatedAt
  toJSON: { virtuals: true },
  toObject: { virtuals: true },
});

// Virtual for full name
userSchema.virtual('fullName').get(function() {
  return `${this.firstName} ${this.lastName}`;
});

// Index for search
userSchema.index({ role: 1 });
userSchema.index({ status: 1 });
userSchema.index({ firstName: 'text', lastName: 'text', email: 'text' });

// Hash password before saving
userSchema.pre('save', async function(next) {
  // Only hash if password is modified
  if (!this.isModified('password')) return next();

  try {
    const salt = await bcrypt.genSalt(12);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

// Compare password method
userSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

// Check if user has specific role
userSchema.methods.hasRole = function(...roles) {
  return roles.includes(this.role);
};

// Check if user is admin
userSchema.methods.isAdmin = function() {
  return this.role === 'super_admin' || this.role === 'property_manager';
};

module.exports = mongoose.model('User', userSchema);
