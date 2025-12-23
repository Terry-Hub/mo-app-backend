const mongoose = require("mongoose");

const UserSchema = new mongoose.Schema(
  {
    fullName: { type: String },
    email: { type: String, unique: true, sparse: true },
    phoneNumber: { type: String, unique: true, sparse: true },
    password: { type: String },

    otp: { type: String },
    otpExpires: { type: Date },

    refreshToken: { type: String },

    // ✅ AJOUT OBLIGATOIRE
    balance: {
      type: Number,
      default: 0, // en euros
      min: 0,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("User", UserSchema);
