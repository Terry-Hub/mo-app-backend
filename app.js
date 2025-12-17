// app.js
const express = require('express');
const dotenv = require('dotenv');
const mongoose = require('mongoose');
const cors = require('cors');
const authRoutes = require('./routes/authRoutes');
const paymentRoutes = require('./routes/paymentRoutes');

// Charger les variables d'environnement
dotenv.config();

// Initialisation de l'application
const app = express();

// Middleware pour gérer CORS
app.use(cors());

// Connexion à MongoDB
const mongoUri = process.env.DB_URI; // Assurez-vous que la variable dans le .env est bien "DB_URI"
if (!mongoUri) {
  console.error('Erreur : La variable d’environnement DB_URI est manquante');
  process.exit(1); // Arrêter l'application si la connexion échoue
}

mongoose
  .connect(mongoUri, { useNewUrlParser: true, useUnifiedTopology: true, useFindAndModify: false })
  .then(() => console.log('✅ MongoDB connecté'))
  .catch((err) => {
    console.error('❌ Erreur MongoDB:', err);
    process.exit(1); // Arrêter le serveur en cas d'échec de connexion
  });

// Middleware pour analyser les corps des requêtes au format JSON
app.use(express.json());

// Définition des routes
app.use('/api/auth', authRoutes);
app.use('/api/payment', paymentRoutes);

// Retourner l'instance de l'application pour que `server.js` puisse l'utiliser
module.exports = app;
