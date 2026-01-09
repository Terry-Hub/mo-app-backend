const mongoose = require("mongoose");

const UserSchema = new mongoose.Schema(
  {
    fullName: { type: String, trim: true },

    email: {
      type: String,
      unique: true,
      sparse: true,
      lowercase: true,
      trim: true,
    },

    phoneNumber: {
      type: String,
      unique: true,
      sparse: true,
      trim: true,
    },

    password: { type: String },

    // Ancien OTP (optionnel, migration douce)
    otp: { type: String },

    // OTP sécurisé
    otpHash: { type: String },
    otpExpires: { type: Date },

    refreshToken: { type: String },

    balance: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  { timestamps: true }
);

// ✅ Index uniques propres (UNE SEULE FOIS)
UserSchema.index({ email: 1 }, { unique: true, sparse: true });
UserSchema.index({ phoneNumber: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model("User", UserSchema);
