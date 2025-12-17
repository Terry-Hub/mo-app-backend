const express = require("express");
const router = express.Router();
const authController = require("../controllers/authController");

// Inscription email / téléphone + mot de passe
router.post("/register", authController.register);

// Connexion email / téléphone + mot de passe
router.post("/login", authController.login);

// Envoi d'un OTP (email ou téléphone)
router.post("/send-otp", authController.sendOTP);

// Vérification OTP
router.post("/verify-otp", authController.verifyOTP);

// Rafraîchir le token d'accès
router.post("/refresh-token", authController.refreshToken);

module.exports = router;
