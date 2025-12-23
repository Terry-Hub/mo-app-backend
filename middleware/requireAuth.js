const jwt = require("jsonwebtoken");
const User = require("../models/User");

module.exports = async function requireAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Token manquant." });
    }

    const token = authHeader.split(" ")[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const userId = decoded?.userId;
    if (!userId) {
      return res.status(401).json({ error: "Token invalide." });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(401).json({ error: "Utilisateur introuvable." });
    }

    req.user = { id: user._id };
    next();
  } catch (err) {
    return res.status(401).json({ error: "Authentification invalide." });
  }
};
