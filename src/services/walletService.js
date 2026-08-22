const User = require('../models/User');

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

const debitWallet = async (userId, amount) => {
  if (!userId || !amount || amount <= 0) return null;
  const user = await User.findById(userId);
  if (!user) throw new Error('User not found');
  const current = user.walletBalance || 0;
  if (current < amount) throw new Error(`Insufficient balance. Has ${current}, needs ${amount}`);
  const updated = await User.findByIdAndUpdate(
    userId,
    { $inc: { walletBalance: -amount } },
    { new: true }
  );
  console.log(`💸 DEBITED ${amount} from ${userId}. New balance: ${updated?.walletBalance}`);
  return updated;
};

module.exports = { creditWallet, debitWallet };