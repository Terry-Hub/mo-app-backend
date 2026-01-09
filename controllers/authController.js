const User = require("../models/User");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { sendOTP: sendEmailOTP } = require("../services/emailService");
const twilio = require("twilio");

// Charger dotenv seulement en local
if (process.env.NODE_ENV !== "production") {
  require("dotenv").config();
}

const isProd = process.env.NODE_ENV === "production";

// JWT
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret";
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || "dev-refresh-secret";

// ======================
// HELPERS
// ======================
function normalizePhone(input) {
  if (!input) return null;

  const raw = String(input).trim().replace(/[\s\-().]/g, "");

  if (raw.startsWith("+")) return raw;
  if (raw.startsWith("00")) return `+${raw.slice(2)}`;

  // France
  if (/^0\d{9}$/.test(raw)) return `+33${raw.slice(1)}`;
  if (/^33\d{8,}$/.test(raw)) return `+${raw}`;

  return raw;
}

function generateOtp() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

const generateAccessToken = (userId) =>
  jwt.sign({ userId }, JWT_SECRET, { expiresIn: "15m" });

const generateRefreshToken = (userId) =>
  jwt.sign({ userId }, JWT_REFRESH_SECRET, { expiresIn: "30d" });

// ======================
// TWILIO INIT
// ======================
let twilioClient = null;

function isTwilioConfigured() {
  return (
    process.env.TWILIO_ACCOUNT_SID &&
    process.env.TWILIO_AUTH_TOKEN &&
    process.env.TWILIO_PHONE_NUMBER &&
    process.env.TWILIO_ACCOUNT_SID.startsWith("AC")
  );
}

try {
  if (isTwilioConfigured()) {
    twilioClient = twilio(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_AUTH_TOKEN
    );
    console.log("✅ Twilio activé - from:", process.env.TWILIO_PHONE_NUMBER);
  } else {
    console.log("⚠️ Twilio désactivé (variables manquantes)");
  }
} catch (e) {
  console.error("❌ Erreur init Twilio:", e);
  twilioClient = null;
}

// ======================
// REGISTER
// ======================
exports.register = async (req, res) => {
  try {
    const { fullName, email, phoneNumber, password } = req.body;
    const phone = normalizePhone(phoneNumber);

    if (!email && !phone)
      return res.status(400).json({ error: "Email ou téléphone requis." });
    if (!password)
      return res.status(400).json({ error: "Mot de passe requis." });

    const existing = await User.findOne({
      $or: [{ email }, { phoneNumber: phone }],
    });

    if (existing && existing.password) {
      return res.status(409).json({ error: "Utilisateur déjà existant." });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = existing
      ? Object.assign(existing, {
          fullName: fullName || existing.fullName,
          email: email || existing.email,
          phoneNumber: phone || existing.phoneNumber,
          password: hashedPassword,
        })
      : await User.create({
          fullName,
          email,
          phoneNumber: phone,
          password: hashedPassword,
        });

    const accessToken = generateAccessToken(user._id);
    const refreshToken = generateRefreshToken(user._id);
    user.refreshToken = refreshToken;
    await user.save();

    return res.status(201).json({
      user: {
        id: user._id,
        fullName: user.fullName,
        email: user.email,
        phoneNumber: user.phoneNumber,
      },
      accessToken,
      refreshToken,
    });
  } catch (e) {
    console.error("❌ Register error:", e);
    return res.status(500).json({ error: "Erreur serveur." });
  }
};

// ======================
// LOGIN
// ======================
exports.login = async (req, res) => {
  try {
    const { email, phoneNumber, password } = req.body;
    const phone = normalizePhone(phoneNumber);

    if (!password)
      return res.status(400).json({ error: "Mot de passe requis." });

    const user = await User.findOne({
      $or: [{ email }, { phoneNumber: phone }],
    });

    if (!user || !user.password)
      return res.status(400).json({ error: "Identifiants invalides." });

    const ok = await bcrypt.compare(password, user.password);
    if (!ok)
      return res.status(400).json({ error: "Identifiants invalides." });

    const accessToken = generateAccessToken(user._id);
    const refreshToken = generateRefreshToken(user._id);
    user.refreshToken = refreshToken;
    await user.save();

    return res.json({
      user: {
        id: user._id,
        fullName: user.fullName,
        email: user.email,
        phoneNumber: user.phoneNumber,
      },
      accessToken,
      refreshToken,
    });
  } catch (e) {
    console.error("❌ Login error:", e);
    return res.status(500).json({ error: "Erreur serveur." });
  }
};

// ======================
// SEND OTP
// ======================
exports.sendOTP = async (req, res) => {
  try {
    const { email, phoneNumber, phone } = req.body;
    const finalPhone = normalizePhone(phoneNumber || phone);

    if (!email && !finalPhone)
      return res.status(400).json({ error: "Email ou téléphone requis." });

    let user = await User.findOne({
      $or: [{ email }, { phoneNumber: finalPhone }],
    });

    if (!user) {
      user = await User.create({
        email: email || undefined,
        phoneNumber: finalPhone || undefined,
      });
    }

    // Rate limit 1/min
    if (user.otpExpires) {
      const msLeft = user.otpExpires.getTime() - Date.now();
      if (msLeft > 4 * 60 * 1000)
        return res.status(429).json({ error: "Veuillez patienter." });
    }

    const otp = generateOtp();
    user.otpHash = await bcrypt.hash(otp, 10);
    user.otpExpires = new Date(Date.now() + 5 * 60 * 1000);
    await user.save();

    let sent = false;

    if (email) {
      try {
        await sendEmailOTP(email, otp);
        sent = true;
      } catch (e) {
        console.error("❌ Email OTP error:", e);
      }
    }

    if (finalPhone && twilioClient) {
      try {
        await twilioClient.messages.create({
          from: process.env.TWILIO_PHONE_NUMBER,
          to: finalPhone,
          body: `Votre code de vérification est : ${otp}`,
        });
        sent = true;
      } catch (e) {
        console.error("❌ SMS OTP error:", {
          message: e.message,
          code: e.code,
          status: e.status,
        });
      }
    }

    if (!sent) {
      user.otpHash = undefined;
      user.otpExpires = undefined;
      await user.save();
      return res.status(502).json({ error: "Impossible d’envoyer le code." });
    }

    return res.json({ ok: true });
  } catch (e) {
    console.error("❌ sendOTP error:", e);
    return res.status(500).json({ error: "Erreur serveur." });
  }
};

// ======================
// VERIFY OTP
// ======================
exports.verifyOTP = async (req, res) => {
  try {
    const { email, phoneNumber, phone, otp } = req.body;
    const finalPhone = normalizePhone(phoneNumber || phone);

    if (!otp)
      return res.status(400).json({ error: "OTP requis." });

    const user = await User.findOne({
      $or: [{ email }, { phoneNumber: finalPhone }],
    });

    if (!user || !user.otpHash || !user.otpExpires)
      return res.status(400).json({ error: "Aucun OTP en attente." });

    if (user.otpExpires < Date.now()) {
      user.otpHash = undefined;
      user.otpExpires = undefined;
      await user.save();
      return res.status(400).json({ error: "OTP expiré." });
    }

    const valid = await bcrypt.compare(otp, user.otpHash);
    if (!valid)
      return res.status(400).json({ error: "OTP invalide." });

    user.otpHash = undefined;
    user.otpExpires = undefined;

    const accessToken = generateAccessToken(user._id);
    const refreshToken = generateRefreshToken(user._id);
    user.refreshToken = refreshToken;
    await user.save();

    return res.json({
      user: {
        id: user._id,
        fullName: user.fullName,
        email: user.email,
        phoneNumber: user.phoneNumber,
      },
      accessToken,
      refreshToken,
    });
  } catch (e) {
    console.error("❌ verifyOTP error:", e);
    return res.status(500).json({ error: "Erreur serveur." });
  }
};

// ======================
// REFRESH TOKEN
// ======================
exports.refreshToken = async (req, res) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken)
      return res.status(401).json({ error: "Refresh token manquant." });

    const payload = jwt.verify(refreshToken, JWT_REFRESH_SECRET);
    const user = await User.findById(payload.userId);

    if (!user || user.refreshToken !== refreshToken)
      return res.status(403).json({ error: "Token invalide." });

    const newAccessToken = generateAccessToken(user._id);
    return res.json({ accessToken: newAccessToken });
  } catch (e) {
    return res.status(403).json({ error: "Refresh token invalide." });
  }
};
