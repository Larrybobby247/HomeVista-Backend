const User = require('../models/User');

/**
 * Credit a user's wallet (for sales, refunds, wallet funding)
 */
const creditWallet = async (userId, amount) => {
  if (!userId || !amount || amount <= 0) return null;

  const updated = await User.findByIdAndUpdate(
    userId,
    { $inc: { walletBalance: amount } },
    { new: true }
  );
  console.log(`💰 CREDITED ${amount} to ${userId}. New balance: ${updated?.walletBalance}`);
  return updated;
};

/**
 * Debit a user's wallet (for payouts/withdrawals)
 */
const debitWallet = async (userId, amount) => {
  if (!userId || !amount || amount <= 0) return null;

  const user = await User.findById(userId);
  if (!user) throw new Error('User not found');

  const currentBalance = user.walletBalance || 0;
  if (currentBalance < amount) throw new Error('Insufficient wallet balance');

  const updated = await User.findByIdAndUpdate(
    userId,
    { $inc: { walletBalance: -amount } },
    { new: true }
  );
  console.log(`💸 DEBITED ${amount} from ${userId}. New balance: ${updated?.walletBalance}`);
  return updated;
};

module.exports = { creditWallet, debitWallet };