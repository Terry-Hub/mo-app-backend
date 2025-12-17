const mongoose = require('mongoose');

const TransactionSchema = new mongoose.Schema({
  userId: { type: mongoose.Types.ObjectId, required: true, index: true },
  type: { type: String, enum: ['credit', 'debit'], required: true },
  label: { type: String, default: 'Movimiento' },
  amount: { type: Number, required: true }, // toujours positif; signe dérivé du type
  currency: { type: String, default: 'EUR' },
}, { timestamps: true });

module.exports = mongoose.model('Transaction', TransactionSchema);
