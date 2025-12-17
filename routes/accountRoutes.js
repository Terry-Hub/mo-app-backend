const express = require("express");
const router = express.Router();
const User = require("../models/User");
const Transaction = require("../models/transaction");

// Réponse erreur JSON cohérente
const jsonError = (res, code, error) => res.status(code).json({ error });

// ⚠️ En prod, récupère le user via JWT. Ici: user démo.
async function getDemoUser() {
  let user = await User.findOne();
  if (!user) {
    user = await User.create({ fullName: "Demo", email: "demo@example.com" });
  }
  return user;
}

/**
 * GET /api/account/summary
 * Retourne le solde + liste des transactions
 */
router.get("/summary", async (_req, res) => {
  try {
    const user = await getDemoUser();

    const transactions = await Transaction.find({ userId: user._id })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

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
    return jsonError(
      res,
      500,
      "Impossible de récupérer le résumé du compte."
    );
  }
});

/**
 * POST /api/account/deposit
 * Body : { amount, currency?, method?, option? }
 */
router.post("/deposit", async (req, res) => {
  try {
    const { amount, currency = "EUR", method, option } = req.body;
    const val = Number(amount);
    if (!val || val <= 0) {
      return jsonError(res, 400, "Montant invalide.");
    }

    const user = await getDemoUser();

    await Transaction.create({
      userId: user._id,
      type: "credit",
      amount: val,
      currency,
      label: method
        ? `Dépôt via ${method}${option ? ` (${option})` : ""}`
        : "Dépôt",
    });

    return res.json({ ok: true });
  } catch (e) {
    console.error("❌ deposit error:", e);
    return jsonError(res, 500, "Impossible d'enregistrer le dépôt.");
  }
});

/**
 * POST /api/account/transfer
 * Body : { recipient, amount, currency?, label? }
 */
router.post("/transfer", async (req, res) => {
  try {
    const { recipient, amount, currency = "EUR", label } = req.body;
    const val = Number(amount);

    if (!val || val <= 0) {
      return jsonError(res, 400, "Montant invalide.");
    }
    if (!recipient) {
      return jsonError(res, 400, "Destinataire requis.");
    }

    const user = await getDemoUser();

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
    return jsonError(
      res,
      500,
      "Impossible d'effectuer la transfert."
    );
  }
});

module.exports = router;
