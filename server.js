require("dotenv").config();

const express = require("express");
const cors = require("cors");
const connectDB = require("./config/database");

const authRoutes = require("./routes/authRoutes");
const paymentRoutes = require("./routes/paymentRoutes");
const accountRoutes = require("./routes/accountRoutes");

// Connexion à MongoDB
connectDB();

const app = express();

// CORS (autorise tout par défaut, ou bien ce qui est dans CORS_ORIGIN)
const allowedOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(",")
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

// Body parser JSON
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
