const admin = require("firebase-admin");
const dotenv = require("dotenv");
dotenv.config();

try {
  const serviceAccount = require("../serviceAccountKey.json");

  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
    console.log("✅ Firebase Admin initialisé avec succès !");
  }
} catch (error) {
  console.error("❌ Erreur lors de l'initialisation de Firebase Admin :", error.message);
  process.exit(1);
}

const auth = admin.auth();
module.exports = { auth };
