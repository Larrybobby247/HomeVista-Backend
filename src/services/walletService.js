const creditWallet = async (userId, amount) => {
  if (!userId || !amount || amount <= 0) {
    throw new Error(`Invalid wallet credit: userId=${userId}, amount=${amount}`);
  }

  const updated = await User.findByIdAndUpdate(
    userId,
    {
      $inc: {
        walletBalance: amount,
      },
    },
    {
      new: true,
      runValidators: true,
    }
  );

  if (!updated) {
    throw new Error(`Cannot credit wallet: User ${userId} not found`);
  }

  console.log('💰 WALLET CREDIT SUCCESS');
  console.log('User:', updated._id.toString());
  console.log('Amount:', amount);
  console.log('New balance:', updated.walletBalance);

  return updated;
};