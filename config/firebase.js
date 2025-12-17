const admin = require("firebase-admin");
const dotenv = require("dotenv");
dotenv.config();

if (!admin.apps.length) {
  try {
    const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;

    if (!serviceAccountJson) {
      console.warn(
        "⚠️ FIREBASE_SERVICE_ACCOUNT_JSON non défini. Firebase Admin ne sera pas initialisé."
      );
    } else {
      const serviceAccount = JSON.parse(serviceAccountJson);
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
      });
      console.log("✅ Firebase Admin initialisé via FIREBASE_SERVICE_ACCOUNT_JSON");
    }
  } catch (error) {
    console.error(
      "❌ Erreur lors de l'initialisation de Firebase Admin :",
      error.message
    );
  }
}

const auth = admin.apps.length ? admin.auth() : null;
module.exports = { auth };
