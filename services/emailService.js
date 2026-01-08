const nodemailer = require("nodemailer");

function assertEmailEnv() {
  const { EMAIL_USER, EMAIL_PASS } = process.env;
  if (!EMAIL_USER || !EMAIL_PASS) {
    throw new Error("Email not configured: missing EMAIL_USER or EMAIL_PASS");
  }
}

/**
 * Gmail NOTE:
 * - EMAIL_PASS doit être un "App Password" (pas le mdp normal)
 * - sinon Gmail bloque l'envoi.
 */
function createTransporter() {
  assertEmailEnv();

  return nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });
}

const sendOTP = async (email, otp) => {
  if (!email) throw new Error("Missing email");
  const transporter = createTransporter();

  const from = process.env.EMAIL_FROM || process.env.EMAIL_USER;

  const mailOptions = {
    from,
    to: email,
    subject: "Votre code OTP",
    text: `Votre code de vérification est : ${otp}`,
  };

  const info = await transporter.sendMail(mailOptions);
  return info; // utile pour debug logs
};

module.exports = { sendOTP };
