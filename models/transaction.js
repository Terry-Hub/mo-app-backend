const mongoose = require("mongoose");

const TransactionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    // credit = + , debit = -
    type: {
      type: String,
      enum: ["credit", "debit"],
      required: true,
    },

    amount: {
      type: Number,
      required: true, // TOUJOURS positif
    },

    currency: {
      type: String,
      default: "EUR",
    },

    label: {
      type: String,
      default: "",
    },

    // Stripe (important pour éviter les doublons)
    provider: {
      type: String,
      default: "", // "stripe"
    },

    reference: {
      type: String,
      default: "", // paymentIntentId
    },

    status: {
      type: String,
      enum: ["pending", "succeeded", "failed"],
      default: "succeeded",
    },
  },
  { timestamps: true }
);

// ✅ Idempotence Stripe : empêche double crédit
TransactionSchema.index(
  { provider: 1, reference: 1 },
  {
    unique: true,
    partialFilterExpression: { reference: { $type: "string" } },
  }
);

module.exports = mongoose.model("Transaction", TransactionSchema);
