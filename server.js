require("dotenv").config();

const express = require("express");
const cors = require("cors");
const connectDB = require("./config/database");

const authRoutes = require("./routes/authRoutes");
const paymentRoutes = require("./routes/paymentRoutes");
const accountRoutes = require("./routes/accountRoutes");

// ✅ Stripe webhook
const Stripe = require("stripe");
const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
const stripe = stripeSecretKey ? new Stripe(stripeSecretKey) : null;

// ✅ Ton modèle (fichier = models/transactions.js)
const Transaction = require("./models/transaction");

// Connexion à MongoDB
connectDB();

const app = express();

// CORS
const allowedOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(",").map((s) => s.trim()).filter(Boolean)
  : ["*"];

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes("*") || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
  })
);

/**
 * ✅ WEBHOOK STRIPE — DOIT ÊTRE AVANT express.json()
 * Endpoint : POST /api/webhooks/stripe
 * Variables Railway obligatoires : STRIPE_SECRET_KEY + STRIPE_WEBHOOK_SECRET
 */
app.post(
  "/api/webhooks/stripe",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    try {
      if (!stripe) {
        return res.status(503).send("Stripe non configuré.");
      }

      const sig = req.headers["stripe-signature"];
      const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

      if (!webhookSecret) {
        return res.status(500).send("STRIPE_WEBHOOK_SECRET manquante.");
      }

      const event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);

      if (event.type === "payment_intent.succeeded") {
        const pi = event.data.object;

        const userId = pi.metadata?.userId;
        if (userId) {
          // centimes -> euros
          const amountEUR = (pi.amount_received ?? pi.amount) / 100;
          const currency = (pi.currency || "eur").toUpperCase();

          // ✅ idempotence: unique index provider+reference
          try {
            await Transaction.create({
              userId,
              type: "credit",
              amount: amountEUR, // toujours positif dans ta DB
              currency,
              label: "Dépôt Stripe",
              provider: "stripe",
              reference: pi.id,
              status: "succeeded",
            });
          } catch (e) {
            // duplicate key => déjà traité, on ignore
            if (e?.code !== 11000) throw e;
          }
        }
      }

      return res.json({ received: true });
    } catch (err) {
      console.error("❌ Stripe webhook error:", err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }
  }
);

// ✅ Body parser JSON pour toutes les autres routes
app.use(express.json());

// Petit log des requêtes
app.use((req, _res, next) => {
  console.log(`${req.method} ${req.url}`);
  next();
});

// Routes simples de test
app.get("/", (_req, res) => {
  res.json({ ok: true, message: "Mo-app-expo API" });
});

app.get("/health", (_req, res) => {
  res.json({ ok: true, uptime: process.uptime() });
});

// Routes principales de l’API
app.use("/api/auth", authRoutes);
app.use("/api/payment", paymentRoutes);
app.use("/api/account", accountRoutes);

// 404
app.use((req, res) => {
  res.status(404).json({ error: "Route introuvable." });
});

// Middleware de gestion d'erreurs (fallback)
app.use((err, _req, res, _next) => {
  console.error("❌ Erreur serveur non gérée :", err);
  res.status(500).json({ error: "Erreur serveur." });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, "0.0.0.0", () => console.log(`✅ API sur ${PORT}`));
