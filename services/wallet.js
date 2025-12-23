const User = require("../models/User");
const Transaction = require("../models/transaction");

async function creditWalletFromStripe({ userId, amount, currency, paymentIntentId }) {
  // idempotence : si tx existe déjà, on ne recrédite pas
  const existing = await Transaction.findOne({ provider: "stripe", reference: paymentIntentId });
  if (existing) return { alreadyProcessed: true };

  // crée transaction + met à jour balance
  // IMPORTANT: amount ici en euros (ex: 10)
  await Transaction.create({
    userId,
    type: "deposit",
    label: "Dépôt Stripe",
    amount: amount,
    currency: currency,
    provider: "stripe",
    reference: paymentIntentId,
    status: "succeeded",
  });

  await User.updateOne({ _id: userId }, { $inc: { balance: amount } });

  return { ok: true };
}

module.exports = { creditWalletFromStripe };
