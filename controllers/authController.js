const User = require("../models/User");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { sendOTP: sendEmailOTP } = require("../services/emailService");
const twilio = require("twilio");

// Sur Railway/Prod, dotenv est inutile (et parfois source de confusion).
// On ne le charge qu'en local.
if (process.env.NODE_ENV !== "production") {
  // eslint-disable-next-line global-require
  require("dotenv").config();
}

const isProd = process.env.NODE_ENV === "production";

// Secrets JWT
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret";
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || "dev-refresh-secret";

// --- Helpers ---
function normalizePhoneFR(input) {
  if (!input) return null;
  const raw = String(input).trim().replace(/\s+/g, "");

  // Déjà en E.164
  if (raw.startsWith("+")) return raw;

  // 00CC...
  if (raw.startsWith("00")) return `+${raw.slice(2)}`;

  // France : 0XXXXXXXXX -> +33XXXXXXXXX
  if (/^0\d{9}$/.test(raw)) return `+33${raw.slice(1)}`;

  // Sinon on renvoie tel quel (à améliorer si multi-pays)
  return raw;
}

function generateOtp() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

/**
 * Génère un access token (valable 15 minutes)
 */
const generateAccessToken = (userId) => jwt.sign({ userId }, JWT_SECRET, { expiresIn: "15m" });

/**
 * Génère un refresh token (valable 30 jours)
 */
const generateRefreshToken = (userId) =>
  jwt.sign({ userId }, JWT_REFRESH_SECRET, { expiresIn: "30d" });

// Client Twilio (SAFE)
let twilioClient = null;
try {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;

  if (sid && token && sid.startsWith("AC")) {
    twilioClient = twilio(sid, token);
  } else {
    console.log("⚠️ Twilio désactivé (TWILIO_ACCOUNT_SID invalide ou manquant).");
  }
} catch (e) {
  console.log("⚠️ Twilio désactivé (erreur init):", e?.message || e);
  twilioClient = null;
}

/**
 * Inscription email / téléphone + mot de passe
 */
exports.register = async (req, res) => {
  try {
    const { fullName, email, phoneNumber, password } = req.body;

    const normalizedPhone = normalizePhoneFR(phoneNumber);

    if (!email && !normalizedPhone) {
      return res.status(400).json({ error: "Email ou numéro de téléphone requis." });
    }
    if (!password) {
      return res.status(400).json({ error: "Mot de passe requis." });
    }

    const existing = await User.findOne({
      $or: [{ email }, { phoneNumber: normalizedPhone }],
    });

    if (existing && existing.password) {
      return res.status(409).json({
        error: "Un utilisateur existe déjà avec cet email ou téléphone.",
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    let user;
    if (existing) {
      existing.fullName = fullName || existing.fullName;
      existing.email = email || existing.email;
      existing.phoneNumber = normalizedPhone || existing.phoneNumber;
      existing.password = hashedPassword;
      user = await existing.save();
    } else {
      user = await User.create({
        fullName,
        email,
        phoneNumber: normalizedPhone,
        password: hashedPassword,
      });
    }

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
  } catch (error) {
    console.error("❌ Erreur inscription :", error);
    return res.status(500).json({ error: "Erreur serveur lors de l'inscription." });
  }
};

/**
 * Login email / téléphone + mot de passe
 */
exports.login = async (req, res) => {
  try {
    const { email, phoneNumber, password } = req.body;
    const normalizedPhone = normalizePhoneFR(phoneNumber);

    if (!password) return res.status(400).json({ error: "Mot de passe requis." });
    if (!email && !normalizedPhone) {
      return res.status(400).json({ error: "Email ou numéro de téléphone requis." });
    }

    const user = await User.findOne({
      $or: [{ email }, { phoneNumber: normalizedPhone }],
    });

    if (!user || !user.password) return res.status(400).json({ error: "Identifiants invalides." });

    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(400).json({ error: "Identifiants invalides." });

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
  } catch (error) {
    console.error("❌ Erreur login :", error);
    return res.status(500).json({ error: "Erreur serveur lors de la connexion." });
  }
};

/**
 * Envoi OTP (email + SMS possible)
 * Body attendu : { email?, phoneNumber? ou phone? }
 */
exports.sendOTP = async (req, res) => {
  try {
    const { email, phoneNumber, phone } = req.body;
    const finalPhone = normalizePhoneFR(phoneNumber || phone);

    if (!email && !finalPhone) {
      return res.status(400).json({ error: "Email ou téléphone requis pour envoyer un OTP." });
    }

    let user = await User.findOne({
      $or: [{ email }, { phoneNumber: finalPhone }],
    });

    if (!user) {
      user = await User.create({
        email: email || undefined,
        phoneNumber: finalPhone || undefined,
      });
    }

    // Anti-spam simple: 1 OTP par minute
    if (user.otpExpires && user.otpExpires.getTime() > Date.now() + 4 * 60 * 1000) {
      // Si on avait mis 5 minutes, et qu'il reste >4 min, c'est qu'on vient d'en envoyer un
      return res.status(429).json({ error: "Veuillez attendre avant de redemander un code." });
    }

    const otp = generateOtp();

    user.otp = otp;
    user.otpExpires = new Date(Date.now() + 5 * 60 * 1000);
    await user.save();

    // Envoi email
    if (email) {
      try {
        await sendEmailOTP(email, otp);
      } catch (err) {
        console.error("⚠️ Erreur envoi OTP email :", err);
      }
    }

    // Envoi SMS via Twilio si configuré
    if (finalPhone && twilioClient && process.env.TWILIO_PHONE_NUMBER) {
      try {
        await twilioClient.messages.create({
          from: process.env.TWILIO_PHONE_NUMBER,
          to: finalPhone,
          body: `Votre code de vérification est : ${otp}`,
        });
      } catch (err) {
        console.error("⚠️ Erreur envoi OTP SMS :", err);
      }
    } else if (finalPhone) {
      console.log(`📱 OTP ${otp} pour ${finalPhone} (Twilio non configuré)`);
    }

    // En prod: ne jamais renvoyer l'OTP
    if (isProd) return res.json({ ok: true });

    // En dev seulement
    return res.json({ ok: true, otp });
  } catch (error) {
    console.error("❌ Erreur envoi OTP :", error);
    return res.status(500).json({ error: "Erreur serveur lors de l'envoi de l'OTP." });
  }
};

/**
 * Vérification OTP
 * Body attendu : { email?, phoneNumber? ou phone?, otp }
 */
exports.verifyOTP = async (req, res) => {
  try {
    const { email, phoneNumber, phone, otp } = req.body;
    const finalPhone = normalizePhoneFR(phoneNumber || phone);

    if (!otp) return res.status(400).json({ error: "Code OTP requis." });
    if (!email && !finalPhone) {
      return res.status(400).json({ error: "Email ou téléphone requis pour vérifier l'OTP." });
    }

    const user = await User.findOne({
      $or: [{ email }, { phoneNumber: finalPhone }],
    });

    if (!user || !user.otp || !user.otpExpires) {
      return res.status(400).json({ error: "Aucun OTP en attente pour cet utilisateur." });
    }

    if (user.otp !== otp) return res.status(400).json({ error: "Code OTP invalide." });
    if (user.otpExpires.getTime() < Date.now()) return res.status(400).json({ error: "Code OTP expiré." });

    // OTP consommé
    user.otp = undefined;
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
  } catch (error) {
    console.error("❌ Erreur vérification OTP :", error);
    return res.status(500).json({ error: "Erreur serveur lors de la vérification de l'OTP." });
  }
};

/**
 * Refresh token → nouveau access token
 * Body : { refreshToken }
 */
exports.refreshToken = async (req, res) => {
  try {
    const { refreshToken: token } = req.body;

    if (!token) return res.status(401).json({ error: "Refresh token manquant." });

    let payload;
    try {
      payload = jwt.verify(token, JWT_REFRESH_SECRET);
    } catch (err) {
      return res.status(403).json({ error: "Refresh token invalide ou expiré." });
    }

    const user = await User.findById(payload.userId);
    if (!user || user.refreshToken !== token) {
      return res.status(403).json({ error: "Refresh token invalide." });
    }

    const newAccessToken = generateAccessToken(user._id);
    return res.json({ accessToken: newAccessToken });
  } catch (error) {
    console.error("❌ Erreur lors du rafraîchissement du token :", error);
    return res.status(500).json({ error: "Erreur serveur lors du rafraîchissement du token." });
  }
};
