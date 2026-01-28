const mongoose = require("mongoose");

/**
 * Normalisation backend téléphone (E.164-like)
 * - supprime espaces / tirets / parenthèses
 * - 00xxxx -> +xxxx
 * - garde +xxxx tel quel
 * ⚠️ ne DEVINE PAS le pays ici (le front doit déjà envoyer +52 / +33)
 */
function normalizePhoneBackend(raw) {
  if (!raw) return raw;

  let p = String(raw).trim();
  p = p.replace(/[\s\-().]/g, "");

  if (p.startsWith("00")) p = `+${p.slice(2)}`;

  return p;
}

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

/**
 * ✅ Normalisation téléphone AVANT save
 * Garantit que phoneNumber est toujours stocké proprement
 */
UserSchema.pre("save", function (next) {
  if (this.isModified("phoneNumber") && this.phoneNumber) {
    this.phoneNumber = normalizePhoneBackend(this.phoneNumber);
  }
  next();
});

// ✅ Index uniques propres
UserSchema.index({ email: 1 }, { unique: true, sparse: true });
UserSchema.index({ phoneNumber: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model("User", UserSchema);
