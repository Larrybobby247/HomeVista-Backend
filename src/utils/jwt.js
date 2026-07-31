/**
 * HomeVista - JWT Utilities
 * Helper functions for JWT token generation and verification
 */

const jwt = require('jsonwebtoken');

const getAccessSecret = () => process.env.JWT_SECRET || process.env.JWT_ACCESS_SECRET || 'dev-access-secret';
const getRefreshSecret = () => process.env.JWT_REFRESH_SECRET || process.env.JWT_ACCESS_SECRET || 'dev-refresh-secret';
const getAccessExpiresIn = () => process.env.JWT_ACCESS_EXPIRES_IN || process.env.JWT_EXPIRE || '15m';
const getRefreshExpiresIn = () => process.env.JWT_REFRESH_EXPIRES_IN || process.env.JWT_REFRESH_EXPIRE || '7d';

/**
 * Generate access token
 * @param {string} userId - User ID
 * @param {string} email - User email
 * @param {string} role - User role
 * @returns {string} JWT token
 */
exports.generateAccessToken = (userId, email, role) => {
  return jwt.sign(
    { userId, email, role },
    getAccessSecret(),
    { expiresIn: getAccessExpiresIn() }
  );
};

/**
 * Generate refresh token
 * @param {string} userId - User ID
 * @returns {string} JWT refresh token
 */
exports.generateRefreshToken = (userId) => {
  return jwt.sign(
    { userId },
    getRefreshSecret(),
    { expiresIn: getRefreshExpiresIn() }
  );
};

/**
 * Verify access token
 * @param {string} token - JWT token
 * @returns {object} Decoded token payload
 */
exports.verifyAccessToken = (token) => {
  return jwt.verify(token, getAccessSecret());
};

/**
 * Verify refresh token
 * @param {string} token - JWT refresh token
 * @returns {object} Decoded token payload
 */
exports.verifyRefreshToken = (token) => {
  return jwt.verify(token, getRefreshSecret());
};
