const express = require("express");
const router = express.Router();

const User = require("../models/User");
const Transaction = require("../models/transaction");
const auth = require("../middleware/auth");

const jsonError = (res, code, error) => res.status(code).json({ error });

async function getUserFromReq(req) {
  const user = await User.findById(req.userId);
  return user;
}

/**
 * Helpers recipient parsing
 */
const looksLikeEmail = (s) =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || "").trim());

const looksLikePhone = (s) => {
  const v = String(s || "").trim();
  if (!v) return false;

  if (v.startsWith("+")) {
    const digits = v.replace(/[^\d]/g, "");
    return digits.length >= 8;
  }
  if (v.startsWith("00")) return true;

  const digits = v.replace(/[^\d]/g, "");
  return digits.length >= 8;
};

// Backend normalizer: conservative (front should already send E.164)
// - cleans spaces/dashes
// - 00 -> +
// - if not + => digits only
const normalizePhoneBackend = (raw) => {
  let p = String(raw || "").trim();
  if (!p) return "";

  p = p.replace(/[\s\-().]/g, "");
  if (p.startsWith("00")) p = `+${p.slice(2)}`;

  if (p.startsWith("+")) return p;
  return p.replace(/[^\d]/g, "");
};

async function resolveRecipient(recipientRaw) {
  const r = String(recipientRaw || "").trim();
  if (!r) return { kind: "unknown", value: "" };

  // @username
  if (r.startsWith("@") && r.length > 1) {
    const username = r.slice(1).trim();
    if (!username) return { kind: "unknown", value: r };

    // ⚠️ adapte si ton champ s'appelle autrement
    const u = await User.findOne({ username }).lean();
    return { kind: "username", value: username, user: u || null };
  }

  // email
  if (looksLikeEmail(r)) {
    const em = r.toLowerCase();
    const u = await User.findOne({ email: em }).lean();
    return { kind: "email", value: em, user: u || null };
  }

  // phone
  if (looksLikePhone(r)) {
    const phone = normalizePhoneBackend(r);
    const u = await User.findOne({ phoneNumber: phone }).lean();
    return { kind: "phone", value: phone, user: u || null };
  }

  return { kind: "raw", value: r, user: null };
}

/**
 * ✅ Calcule le solde à partir des transactions (source de vérité)
 * credit -> +amount ; debit -> -amount
 */
async function computeBalance(userId) {
  const txs = await Transaction.find({ userId })
    .select("type amount")
    .lean();

  return txs.reduce((acc, t) => (t.type === "credit" ? acc + t.amount : acc - t.amount), 0);
}

/**
 * GET /api/account/summary
 */
router.get("/summary", auth, async (req, res) => {
  try {
    const user = await getUserFromReq(req);
    if (!user) return jsonError(res, 401, "Utilisateur introuvable.");

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
    return jsonError(res, 500, "Impossible de récupérer le résumé du compte.");
  }
});

/**
 * POST /api/account/deposit
 */
router.post("/deposit", auth, async (req, res) => {
  try {
    const { amount, currency = "EUR", method, option } = req.body;
    const val = Number(amount);

    if (!Number.isFinite(val) || val <= 0)
      return jsonError(res, 400, "Montant invalide.");

    const user = await getUserFromReq(req);
    if (!user) return jsonError(res, 401, "Utilisateur introuvable.");

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
 *
 * ✅ Vérifie le solde avant débit
 * ✅ Empêche transfert vers soi-même
 * ✅ Crédit destinataire si trouvé
 */
router.post("/transfer", auth, async (req, res) => {
  try {
    const { recipient, amount, currency = "EUR", label } = req.body;
    const val = Number(amount);

    if (!Number.isFinite(val) || val <= 0)
      return jsonError(res, 400, "Montant invalide.");
    if (!recipient || !String(recipient).trim())
      return jsonError(res, 400, "Destinataire requis.");

    const sender = await getUserFromReq(req);
    if (!sender) return jsonError(res, 401, "Utilisateur introuvable.");

    // ✅ solde (source de vérité)
    const balance = await computeBalance(sender._id);
    if (balance < val) {
      return jsonError(res, 400, "Solde insuffisant.");
    }

    const resolved = await resolveRecipient(recipient);

    // ✅ anti self-transfer si on résout vers un user
    if (resolved.user && String(resolved.user._id) === String(sender._id)) {
      return jsonError(res, 400, "Impossible d'effectuer un virement vers soi-même.");
    }

    // Si recipient est "identifiable" (email/phone/@user) mais introuvable -> 404
    if (
      !resolved.user &&
      (resolved.kind === "email" ||
        resolved.kind === "phone" ||
        resolved.kind === "username")
    ) {
      return jsonError(res, 404, "Destinataire introuvable.");
    }

    // ✅ Debit
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

    // ✅ Credit (si destinataire trouvé)
    if (resolved.user) {
      await Transaction.create({
        userId: resolved.user._id,
        type: "credit",
        amount: val,
        currency,
        label:
          label ||
          `Reçu de ${sender.email || sender.phoneNumber || "un utilisateur"}`,
        meta: {
          senderUserId: sender._id,
          senderEmail: sender.email || null,
          senderPhoneNumber: sender.phoneNumber || null,
        },
      });
    }

    return res.json({
      ok: true,
      senderBalanceBefore: balance,
      senderBalanceAfter: balance - val,
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
