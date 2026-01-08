const User = require("../models/User");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { sendOTP: sendEmailOTP } = require("../services/emailService");
const twilio = require("twilio");

// Charger dotenv seulement en local
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

  if (raw.startsWith("+")) return raw;
  if (raw.startsWith("00")) return `+${raw.slice(2)}`;
  if (/^0\d{9}$/.test(raw)) return `+33${raw.slice(1)}`;
  return raw;
}

function generateOtp() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

const generateAccessToken = (userId) =>
  jwt.sign({ userId }, JWT_SECRET, { expiresIn: "15m" });

const generateRefreshToken = (userId) =>
  jwt.sign({ userId }, JWT_REFRESH_SECRET, { expiresIn: "30d" });

// --- Twilio init ---
let twilioClient = null;
function isTwilioConfigured() {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_PHONE_NUMBER;
  return Boolean(sid && token && from && sid.startsWith("AC"));
}

try {
  if (isTwilioConfigured()) {
    twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    console.log("✅ Twilio activé");
  } else {
    console.log("⚠️ Twilio désactivé (variables manquantes ou invalides).");
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

    // Chercher ou créer un utilisateur "light"
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
    if (user.otpExpires) {
      const msLeft = user.otpExpires.getTime() - Date.now();
      // otpExpires = now + 5min. Si on est encore à >4min, c'est qu'on l'a généré il y a <1min.
      if (msLeft > 4 * 60 * 1000) {
        return res.status(429).json({ error: "Veuillez attendre avant de redemander un code." });
      }
    }

    const otp = generateOtp();
    user.otp = otp;
    user.otpExpires = new Date(Date.now() + 5 * 60 * 1000);
    await user.save();

    // On tente l'envoi (et on TRACK si au moins 1 canal a réussi)
    let sentAtLeastOne = false;
    const delivery = { sms: false, email: false };

    // EMAIL
    if (email) {
      try {
        await sendEmailOTP(email, otp);
        sentAtLeastOne = true;
        delivery.email = true;
        console.log("✅ OTP email envoyé à", email);
      } catch (err) {
        console.error("❌ OTP email FAILED:", err?.message || err);
      }
    }

    // SMS
    if (finalPhone) {
      if (!twilioClient || !process.env.TWILIO_PHONE_NUMBER) {
        console.error(
          "❌ OTP SMS FAILED: Twilio non configuré (TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN/TWILIO_PHONE_NUMBER)"
        );
      } else {
        try {
          const msg = await twilioClient.messages.create({
            from: process.env.TWILIO_PHONE_NUMBER,
            to: finalPhone,
            body: `Votre code de vérification est : ${otp}`,
          });
          sentAtLeastOne = true;
          delivery.sms = true;
          console.log("✅ OTP SMS envoyé:", msg.sid, "->", finalPhone);
        } catch (err) {
          console.error("❌ OTP SMS FAILED:", err?.message || err);
        }
      }
    }

    // Si aucun canal n'a réussi => on le dit au front
    if (!sentAtLeastOne) {
      return res.status(502).json({
        error:
          "Impossible d’envoyer le code pour le moment. Vérifiez la configuration SMS/Email (provider) et réessayez.",
      });
    }

    // En prod: ne jamais renvoyer l'OTP
    if (isProd) return res.json({ ok: true });

    // En dev seulement: utile pour debug
    return res.json({ ok: true, otp, delivery });
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
