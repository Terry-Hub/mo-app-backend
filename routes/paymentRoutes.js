const express = require("express");
const router = express.Router();

const auth = require("../middleware/auth");

const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
const stripe = stripeSecretKey ? require("stripe")(stripeSecretKey) : null;

router.post("/create-payment-intent", auth, async (req, res) => {
  try {
    if (!stripe) {
      return res.status(503).json({ error: "Stripe non configuré (STRIPE_SECRET_KEY manquante)." });
    }

    const { amount, currency = "eur" } = req.body;

    if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ error: "Montant invalide." });
    }

    // euros -> centimes
    const amountInCents = Math.round(amount * 100);
    if (amountInCents < 50) {
      return res.status(400).json({ error: "Montant minimum 0,50 €." });
    }

    const pi = await stripe.paymentIntents.create({
      amount: amountInCents,
      currency,
      automatic_payment_methods: { enabled: true },
      metadata: { userId: String(req.userId) },
    });

    return res.json({ clientSecret: pi.client_secret, paymentIntentId: pi.id });
  } catch (err) {
    console.error("❌ Stripe error:", err);
    return res.status(500).json({ error: "Erreur Stripe.", details: err.message });
  }
});

module.exports = router;
