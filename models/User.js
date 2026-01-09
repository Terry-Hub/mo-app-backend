const mongoose = require("mongoose");

const UserSchema = new mongoose.Schema(
  {
    fullName: { type: String, trim: true },

    // uniques mais optionnels (sparse = autorise plusieurs null/undefined)
    email: {
      type: String,
      unique: true,
      sparse: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    phoneNumber: {
      type: String,
      unique: true,
      sparse: true,
      trim: true,
      index: true,
    },

    password: { type: String },

    // OTP (ancien champ, on le garde pour compatibilité / migration douce)
    otp: { type: String },

    // ✅ OTP sécurisé (celui qu'on utilise désormais)
    otpHash: { type: String },
    otpExpires: { type: Date },

    refreshToken: { type: String },

    // Balance (compte)
    balance: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  { timestamps: true }
);

// Index "propres" (optionnel mais utile)
UserSchema.index({ email: 1 }, { unique: true, sparse: true });
UserSchema.index({ phoneNumber: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model("User", UserSchema);
