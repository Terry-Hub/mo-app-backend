const express = require("express");
const router = express.Router();

const User = require("../models/User");
const Transaction = require("../models/transaction"); // ✅ FIX ICI
const auth = require("../middleware/auth");

// Réponse erreur JSON cohérente
const jsonError = (res, code, error) => res.status(code).json({ error });

async function getUserFromReq(req) {
  const user = await User.findById(req.userId);
  return user;
}

/**
 * Helpers recipient parsing
 */
const looksLikeEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || "").trim());

const looksLikePhone = (s) => {
  const v = String(s || "").trim();
  if (!v) return false;
  if (v.startsWith("+")) {
    const digits = v.replace(/[^\d]/g, "");
    return digits.length >= 8;
  }
  // tolerate "00..." because some users paste it
  if (v.startsWith("00")) return true;
  // if contains many digits and starts with digit/0
  const digits = v.replace(/[^\d]/g, "");
  return digits.length >= 8;
};

// Backend normalizer: conservative (assumes already E.164 from front)
// - cleans spaces/dashes
// - 00 -> +
// - if not + => returns digits only (will fail matching unless stored similarly)
const normalizePhoneBackend = (raw) => {
  let p = String(raw || "").trim();
  if (!p) return "";

  p = p.replace(/[\s\-().]/g, "");
  if (p.startsWith("00")) p = `+${p.slice(2)}`;

  // Keep + if present
  if (p.startsWith("+")) return p;

  // If no +, keep digits only (safer: avoid guessing country on backend)
  return p.replace(/[^\d]/g, "");
};

async function resolveRecipient(recipientRaw) {
  const r = String(recipientRaw || "").trim();
  if (!r) return { kind: "unknown", value: "" };

  // @username style
  if (r.startsWith("@") && r.length > 1) {
    const username = r.slice(1).trim();
    if (!username) return { kind: "unknown", value: r };

    // NOTE: adapte ici si ton modèle User a "username" ou "handle"
    const u = await User.findOne({ username }).lean();
    return { kind: "username", value: username, user: u || null };
  }

  // email
  if (looksLikeEmail(r)) {
    const u = await User.findOne({ email: r.toLowerCase() }).lean();
    return { kind: "email", value: r.toLowerCase(), user: u || null };
  }

  // phone
  if (looksLikePhone(r)) {
    const phone = normalizePhoneBackend(r);
    // NOTE: il faut que User.phoneNumber soit stocké en E.164 (+52..., +33...)
    const u = await User.findOne({ phoneNumber: phone }).lean();
    return { kind: "phone", value: phone, user: u || null };
  }

  // fallback: raw
  return { kind: "raw", value: r, user: null };
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

    // type=credit/debit, amount stocké en positif.
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
 *
 * ⚠️ Pour Stripe en prod: ne pas appeler cette route depuis le front.
 * Le crédit Stripe doit venir du webhook.
 */
router.post("/deposit", auth, async (req, res) => {
  try {
    const { amount, currency = "EUR", method, option } = req.body;
    const val = Number(amount);

    if (!Number.isFinite(val) || val <= 0) return jsonError(res, 400, "Montant invalide.");

    const user = await getUserFromReq(req);
    if (!user) return jsonError(res, 401, "Utilisateur introuvable.");

    await Transaction.create({
      userId: user._id,
      type: "credit",
      amount: val,
      currency,
      label: method ? `Dépôt via ${method}${option ? ` (${option})` : ""}` : "Dépôt",
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
 *
 * ✅ Nouveau comportement:
 * - Crée un débit pour l'utilisateur connecté
 * - Si recipient correspond à un user existant (email / phone / @username):
 *    -> crée aussi un crédit pour le destinataire
 *
 * NOTE: pour un vrai produit, on vérifierait solde, idempotency, fees, etc.
 */
router.post("/transfer", auth, async (req, res) => {
  try {
    const { recipient, amount, currency = "EUR", label } = req.body;
    const val = Number(amount);

    if (!Number.isFinite(val) || val <= 0) return jsonError(res, 400, "Montant invalide.");
    if (!recipient || !String(recipient).trim()) return jsonError(res, 400, "Destinataire requis.");

    const sender = await getUserFromReq(req);
    if (!sender) return jsonError(res, 401, "Utilisateur introuvable.");

    const resolved = await resolveRecipient(recipient);

    // ✅ Debit (toujours)
    await Transaction.create({
      userId: sender._id,
      type: "debit",
      amount: val,
      currency,
      label: label || `Virement vers ${String(recipient).trim()}`,
      meta: {
        recipientKind: resolved.kind,
        recipientValue: resolved.value,
        recipientUserId: resolved.user?._id || null,
      },
    });

    // ✅ Credit (si destinataire trouvé et différent de l'expéditeur)
    if (resolved.user && String(resolved.user._id) !== String(sender._id)) {
      await Transaction.create({
        userId: resolved.user._id,
        type: "credit",
        amount: val,
        currency,
        label: label || `Reçu de ${sender.email || sender.phoneNumber || "un utilisateur"}`,
        meta: {
          senderUserId: sender._id,
          senderEmail: sender.email || null,
          senderPhoneNumber: sender.phoneNumber || null,
        },
      });
    } else if (resolved.kind === "email" || resolved.kind === "phone" || resolved.kind === "username") {
      // Si on essaye un mode "identifiable" mais user introuvable -> erreur claire
      return jsonError(res, 404, "Destinataire introuvable.");
    }

    return res.json({
      ok: true,
      recipientKind: resolved.kind,
      recipientValue: resolved.value,
      recipientUserId: resolved.user?._id || null,
    });
  } catch (e) {
    console.error("❌ transfer error:", e);
    return jsonError(res, 500, "Impossible d'effectuer le transfert.");
  }
});

module.exports = router;
