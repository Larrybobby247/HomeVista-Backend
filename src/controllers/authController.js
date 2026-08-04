/**
 * HomeVista - Auth Controller
 * Handles authentication: register, login, logout, profile management,
 * and password reset with email verification codes
 */

const User = require('../models/User');
const bcrypt = require('bcryptjs');
const { generateAccessToken, generateRefreshToken, verifyRefreshToken } = require('../utils/jwt');
const { validationResult } = require('express-validator');
const { sendPasswordResetCode } = require('../utils/email');

// ============================================
// PASSWORD RESET CODE STORAGE
// ============================================
// In production, replace this with Redis!
// Format: Map<email, { code, expiresAt, attempts, createdAt }>
const resetCodes = new Map();
const MAX_ATTEMPTS = 5;
const CODE_EXPIRY_MS = 15 * 60 * 1000; // 15 minutes
const RESEND_COOLDOWN_MS = 60 * 1000;  // 60 seconds

const generateSixDigitCode = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

const cleanupExpiredCodes = () => {
  const now = Date.now();
  for (const [email, data] of resetCodes.entries()) {
    if (data.expiresAt < now) {
      resetCodes.delete(email);
    }
  }
};

// ============================================
// EXISTING FUNCTIONS (UNCHANGED)
// ============================================

/**
 * @desc    Register new user
 * @route   POST /api/auth/register
 * @access  Public
 */
exports.register = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array(),
      });
    }

    const {
      email,
      password,
      confirmPassword,
      firstName,
      lastName,
      phoneNumber,
      role,
      address,
      city,
      state,
      country,
    } = req.body;

    if (password !== confirmPassword) {
      return res.status(400).json({
        success: false,
        message: 'Passwords do not match',
      });
    }

    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'User with this email already exists',
      });
    }

    const existingPhone = await User.findOne({ phoneNumber });
    if (existingPhone) {
      return res.status(400).json({
        success: false,
        message: 'Phone number already registered',
      });
    }

    const user = await User.create({
      email: email.toLowerCase(),
      password,
      firstName,
      lastName,
      phoneNumber,
      role: role || 'buyer',
      address,
      city,
      state,
      country: country || 'Nigeria',
      status: 'pending_verification',
    });

    const accessToken = generateAccessToken(user._id, user.email, user.role);
    const refreshToken = generateRefreshToken(user._id);

    user.password = undefined;

    res.status(201).json({
      success: true,
      message: 'Account created successfully',
      data: {
        user,
        accessToken,
        refreshToken,
        expiresIn: 604800,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Login user
 * @route   POST /api/auth/login
 * @access  Public
 */
exports.login = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array(),
      });
    }

    const { email, password } = req.body;

    const user = await User.findOne({ email: email.toLowerCase() }).select('+password');
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password',
      });
    }

    if (user.status === 'suspended') {
      return res.status(403).json({
        success: false,
        message: 'Your account has been suspended. Please contact support.',
      });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password',
      });
    }

    user.lastLoginAt = new Date();
    await user.save();

    const accessToken = generateAccessToken(user._id, user.email, user.role);
    const refreshToken = generateRefreshToken(user._id);

    user.password = undefined;

    res.status(200).json({
      success: true,
      message: 'Login successful',
      data: {
        user,
        accessToken,
        refreshToken,
        expiresIn: 604800,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Logout user
 * @route   POST /api/auth/logout
 * @access  Private
 */
exports.logout = async (req, res, next) => {
  try {
    res.status(200).json({
      success: true,
      message: 'Logged out successfully',
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get current user
 * @route   GET /api/auth/me
 * @access  Private
 */
exports.getMe = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id);
    res.status(200).json({
      success: true,
      data: user,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Update user profile
 * @route   PUT /api/auth/profile
 * @access  Private
 */
exports.updateProfile = async (req, res, next) => {
  try {
    const fieldsToUpdate = {
      firstName: req.body.firstName,
      lastName: req.body.lastName,
      phoneNumber: req.body.phoneNumber,
      bio: req.body.bio,
      companyName: req.body.companyName,
      licenseNumber: req.body.licenseNumber,
      yearsOfExperience: req.body.yearsOfExperience,
      address: req.body.address,
      city: req.body.city,
      state: req.body.state,
      country: req.body.country,
      zipCode: req.body.zipCode,
      bankName: req.body.bankName,
      accountNumber: req.body.accountNumber,
      accountName: req.body.accountName,
      bvn: req.body.bvn,
      emergencyContactName: req.body.emergencyContactName,
      emergencyContactPhone: req.body.emergencyContactPhone,
      emergencyContactRelationship: req.body.emergencyContactRelationship,
      notificationPreferences: req.body.notificationPreferences,
      privacySettings: req.body.privacySettings,
    };

    Object.keys(fieldsToUpdate).forEach(key => {
      if (fieldsToUpdate[key] === undefined) delete fieldsToUpdate[key];
    });

    const user = await User.findByIdAndUpdate(
      req.user._id,
      fieldsToUpdate,
      { new: true, runValidators: true }
    );

    res.status(200).json({
      success: true,
      message: 'Profile updated successfully',
      data: user,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Change password
 * @route   POST /api/auth/change-password
 * @access  Private
 */
exports.changePassword = async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;

    const user = await User.findById(req.user._id).select('+password');

    const isMatch = await user.comparePassword(currentPassword);
    if (!isMatch) {
      return res.status(400).json({
        success: false,
        message: 'Current password is incorrect',
      });
    }

    user.password = newPassword;
    await user.save();

    res.status(200).json({
      success: true,
      message: 'Password changed successfully',
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Refresh access token
 * @route   POST /api/auth/refresh
 * @access  Public (with refresh token)
 */
exports.refreshToken = async (req, res, next) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(401).json({
        success: false,
        message: 'Refresh token is required',
      });
    }

    const decoded = verifyRefreshToken(refreshToken);

    const user = await User.findById(decoded.userId);
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid refresh token',
      });
    }

    const newAccessToken = generateAccessToken(user._id, user.email, user.role);
    const newRefreshToken = generateRefreshToken(user._id);

    res.status(200).json({
      success: true,
      data: {
        accessToken: newAccessToken,
        refreshToken: newRefreshToken,
        expiresIn: 604800,
      },
    });
  } catch (error) {
    next(error);
  }
};

// ============================================
// PASSWORD RESET WITH VERIFICATION CODE
// ============================================

/**
 * @desc    Send password reset code to email
 * @route   POST /api/auth/forgot-password
 * @access  Public
 */
exports.forgotPassword = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array(),
      });
    }

    const { email } = req.body;
    const normalizedEmail = email.toLowerCase().trim();

    // Find user
    const user = await User.findOne({ email: normalizedEmail });

    if (!user) {
      // Don't reveal if email exists (security best practice)
      return res.status(200).json({
        success: true,
        message: 'If an account exists with this email, a reset code has been sent.',
      });
    }

    // Rate limiting: check if code was sent recently
    const existing = resetCodes.get(normalizedEmail);
    if (existing && Date.now() - existing.createdAt < RESEND_COOLDOWN_MS) {
      const retryAfter = Math.ceil((RESEND_COOLDOWN_MS - (Date.now() - existing.createdAt)) / 1000);
      return res.status(429).json({
        success: false,
        message: `Please wait ${retryAfter} seconds before requesting a new code.`,
        retryAfter,
      });
    }

    // Generate 6-digit code
    const code = generateSixDigitCode();
    const expiresAt = Date.now() + CODE_EXPIRY_MS;

    // Save code
    resetCodes.set(normalizedEmail, {
      code,
      expiresAt,
      attempts: 0,
      createdAt: Date.now(),
    });

    // Send email
    await sendPasswordResetCode(user.email, code, user.firstName);

    res.status(200).json({
      success: true,
      message: 'If an account exists with this email, a reset code has been sent.',
    });
  } catch (error) {
    console.error('Forgot password error:', error);
    next(error);
  }
};

/**
 * @desc    Resend password reset code
 * @route   POST /api/auth/forgot-password/resend
 * @access  Public
 */
exports.resendResetCode = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array(),
      });
    }

    const { email } = req.body;
    const normalizedEmail = email.toLowerCase().trim();

    const user = await User.findOne({ email: normalizedEmail });

    if (!user) {
      return res.status(200).json({
        success: true,
        message: 'If an account exists with this email, a reset code has been sent.',
      });
    }

    // Rate limiting
    const existing = resetCodes.get(normalizedEmail);
    if (existing && Date.now() - existing.createdAt < RESEND_COOLDOWN_MS) {
      const retryAfter = Math.ceil((RESEND_COOLDOWN_MS - (Date.now() - existing.createdAt)) / 1000);
      return res.status(429).json({
        success: false,
        message: `Please wait ${retryAfter} seconds before requesting a new code.`,
        retryAfter,
      });
    }

    // Generate new code
    const code = generateSixDigitCode();
    const expiresAt = Date.now() + CODE_EXPIRY_MS;

    resetCodes.set(normalizedEmail, {
      code,
      expiresAt,
      attempts: 0,
      createdAt: Date.now(),
    });

    await sendPasswordResetCode(user.email, code, user.firstName);

    res.status(200).json({
      success: true,
      message: 'A new reset code has been sent to your email.',
    });
  } catch (error) {
    console.error('Resend code error:', error);
    next(error);
  }
};

/**
 * @desc    Verify reset code (optional - frontend can call this)
 * @route   POST /api/auth/forgot-password/verify
 * @access  Public
 */
exports.verifyResetCode = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array(),
      });
    }

    const { email, code } = req.body;
    const normalizedEmail = email.toLowerCase().trim();

    const resetData = resetCodes.get(normalizedEmail);

    if (!resetData) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired code. Please request a new one.',
      });
    }

    if (Date.now() > resetData.expiresAt) {
      resetCodes.delete(normalizedEmail);
      return res.status(400).json({
        success: false,
        message: 'Code has expired. Please request a new one.',
      });
    }

    if (resetData.attempts >= MAX_ATTEMPTS) {
      resetCodes.delete(normalizedEmail);
      return res.status(400).json({
        success: false,
        message: 'Too many failed attempts. Please request a new code.',
      });
    }

    if (resetData.code !== code.trim()) {
      resetData.attempts += 1;
      return res.status(400).json({
        success: false,
        message: `Invalid code. ${MAX_ATTEMPTS - resetData.attempts} attempts remaining.`,
      });
    }

    res.status(200).json({
      success: true,
      message: 'Code verified successfully.',
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Reset password using verification code
 * @route   POST /api/auth/reset-password
 * @access  Public
 */
exports.resetPassword = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array(),
      });
    }

    const { email, code, newPassword } = req.body;
    const normalizedEmail = email.toLowerCase().trim();

    const resetData = resetCodes.get(normalizedEmail);

    if (!resetData) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired code. Please request a new one.',
      });
    }

    if (Date.now() > resetData.expiresAt) {
      resetCodes.delete(normalizedEmail);
      return res.status(400).json({
        success: false,
        message: 'Code has expired. Please request a new one.',
      });
    }

    if (resetData.code !== code.trim()) {
      resetData.attempts = (resetData.attempts || 0) + 1;
      if (resetData.attempts >= MAX_ATTEMPTS) {
        resetCodes.delete(normalizedEmail);
      }
      return res.status(400).json({
        success: false,
        message: 'Invalid code.',
      });
    }

    // Find user
    const user = await User.findOne({ email: normalizedEmail }).select('+password');
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found.',
      });
    }

    // Hash and save new password
    const salt = await bcrypt.genSalt(12);
    user.password = await bcrypt.hash(newPassword, salt);
    await user.save();

    // Delete used code
    resetCodes.delete(normalizedEmail);

    res.status(200).json({
      success: true,
      message: 'Password reset successfully. Please log in with your new password.',
    });
  } catch (error) {
    console.error('Reset password error:', error);
    next(error);
  }
};