/**
 * HomeVista - Auth Routes
 */

const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const {
  register,
  login,
  logout,
  getMe,
  updateProfile,
  changePassword,
  refreshToken,
  forgotPassword,
  resendResetCode,
  verifyResetCode,
  resetPassword,
} = require('../controllers/authController');
const { protect } = require('../middleware/auth');

const registerValidation = [
  body('email').isEmail().normalizeEmail().withMessage('Please provide a valid email'),
  body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
  body('firstName').trim().isLength({ min: 2 }).withMessage('First name is required'),
  body('lastName').trim().isLength({ min: 2 }).withMessage('Last name is required'),
  body('phoneNumber').trim().notEmpty().withMessage('Phone number is required'),
  body('role').isIn(['buyer', 'seller', 'tenant', 'landlord', 'agent', 'developer', 'property_manager']).withMessage('Invalid role'),
  body('address').trim().notEmpty().withMessage('Address is required'),
  body('city').trim().notEmpty().withMessage('City is required'),
  body('state').trim().notEmpty().withMessage('State is required'),
];

const loginValidation = [
  body('email').isEmail().normalizeEmail().withMessage('Please provide a valid email'),
  body('password').notEmpty().withMessage('Password is required'),
];

router.post('/register', registerValidation, register);
router.post('/login', loginValidation, login);
router.post('/logout', protect, logout);
router.get('/me', protect, getMe);
router.put('/profile', protect, updateProfile);
router.post('/change-password', protect, changePassword);
router.post('/refresh', refreshToken);

// Password Reset Routes
router.post('/forgot-password', body('email').isEmail().normalizeEmail(), forgotPassword);
router.post('/forgot-password/resend', body('email').isEmail().normalizeEmail(), resendResetCode);
router.post('/forgot-password/verify', [
  body('email').isEmail().normalizeEmail(),
  body('code').isLength({ min: 6, max: 6 }).isNumeric(),
], verifyResetCode);
router.post('/reset-password', [
  body('email').isEmail().normalizeEmail(),
  body('code').isLength({ min: 6, max: 6 }).isNumeric(),
  body('newPassword').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
], resetPassword);

module.exports = router;