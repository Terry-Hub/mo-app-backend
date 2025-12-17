const express = require("express");
const router = express.Router();

const stripeSecretKey = process.env.STRIPE_SECRET_KEY;

// Stripe devient optionnel
const stripe = stripeSecretKey ? require("stripe")(stripeSecretKey) : null;

// Si Stripe n'est pas configuré, on renvoie une erreur propre
router.post("/create-payment-intent", async (req, res) => {
  try {
    if (!stripe) {
      return res.status(503).json({
        error: "Stripe non configuré (STRIPE_SECRET_KEY manquante).",
      });
    }

    const { amount, currency = "eur" } = req.body;

    if (!amount || typeof amount !== "number") {
      return res.status(400).json({ error: "Montant invalide." });
    }

    const paymentIntent = await stripe.paymentIntents.create({
      amount,
      currency,
      automatic_payment_methods: { enabled: true },
    });

    return res.json({ clientSecret: paymentIntent.client_secret });
  } catch (err) {
    console.error("❌ Stripe error:", err);
    return res.status(500).json({ error: "Erreur Stripe." });
  }
});

module.exports = router;
