const express = require("express");
const router = express.Router();

const User = require("../models/User");
const Transaction = require("../models/transaction");
const auth = require("../middleware/auth");

// Réponse erreur JSON cohérente
const jsonError = (res, code, error) => res.status(code).json({ error });

async function getUserFromReq(req) {
  const user = await User.findById(req.userId);
  return user;
}

/**
 * GET /api/account/summary
 * Retourne le solde + liste des transactions (utilisateur connecté)
 */
router.get("/summary", auth, async (req, res) => {
  try {
    const user = await getUserFromReq(req);
    if (!user) return jsonError(res, 401, "Utilisateur introuvable.");

    const transactions = await Transaction.find({ userId: user._id })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    // Dans ta DB: type=credit/debit, amount stocké en positif.
    const balance = transactions.reduce((acc, t) => {
      return t.type === "credit" ? acc + t.amount : acc - t.amount;
    }, 0);

    const formatted = transactions.map((t) => ({
      id: t._id,
      label: t.label,
      amount: t.type === "credit" ? t.amount : -t.amount,
      currency: t.currency,
      createdAt: t.createdAt,
    }));

    return res.json({ balance, transactions: formatted });
  } catch (e) {
    console.error("❌ summary error:", e);
    return jsonError(res, 500, "Impossible de récupérer le résumé du compte.");
  }
});

/**
 * POST /api/account/deposit
 * Body : { amount, currency?, method?, option? }
 * Crée un crédit pour l'utilisateur connecté
 */
router.post("/deposit", auth, async (req, res) => {
  try {
    const { amount, currency = "EUR", method, option } = req.body;
    const val = Number(amount);

    if (!val || val <= 0) return jsonError(res, 400, "Montant invalide.");

    const user = await getUserFromReq(req);
    if (!user) return jsonError(res, 401, "Utilisateur introuvable.");

    await Transaction.create({
      userId: user._id,
      type: "credit",
      amount: val,
      currency,
      label: method ? `Dépôt via ${method}${option ? ` (${option})` : ""}` : "Dépôt",
    });

    // Optionnel: renvoyer le nouvel état
    // const summary = await ... (mais on reste simple)
    return res.json({ ok: true });
  } catch (e) {
    console.error("❌ deposit error:", e);
    return jsonError(res, 500, "Impossible d'enregistrer le dépôt.");
  }
});

/**
 * POST /api/account/transfer
 * Body : { recipient, amount, currency?, label? }
 * Crée un débit pour l'utilisateur connecté
 */
router.post("/transfer", auth, async (req, res) => {
  try {
    const { recipient, amount, currency = "EUR", label } = req.body;
    const val = Number(amount);

    if (!val || val <= 0) return jsonError(res, 400, "Montant invalide.");
    if (!recipient) return jsonError(res, 400, "Destinataire requis.");

    const user = await getUserFromReq(req);
    if (!user) return jsonError(res, 401, "Utilisateur introuvable.");

    await Transaction.create({
      userId: user._id,
      type: "debit",
      amount: val,
      currency,
      label: label || `Virement vers ${recipient}`,
    });

    return res.json({ ok: true });
  } catch (e) {
    console.error("❌ transfer error:", e);
    return jsonError(res, 500, "Impossible d'effectuer le transfert.");
  }
});

module.exports = router;
