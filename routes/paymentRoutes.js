const express = require('express');
const router = express.Router();
const Stripe = require('stripe');
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

router.post('/create-payment-intent', async (req, res) => {
  const { amount, currency = 'eur' } = req.body;

  try {
    const paymentIntent = await stripe.paymentIntents.create({
      amount, // en centimes ! (ex: 1000 = 10€)
      currency,
    });
    
    res.send({
      clientSecret: paymentIntent.client_secret,
    });
  } catch (err) {
    console.error('Stripe error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
