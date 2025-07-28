const nodemailer = require('nodemailer');

// Configura o transporte de e‑mail usando variáveis de ambiente.
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: process.env.SMTP_PORT,
  secure: process.env.SMTP_SECURE === 'true', // true para SSL, false para STARTTLS
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

/**
 * Envia um e‑mail de boas‑vindas com link para definição de senha.
 * @param {string} toEmail Email do destinatário.
 */
async function sendWelcomeEmail(toEmail) {
  // Gera link para a página de redefinição de senha, anexando o e‑mail como query.
  const resetLink = `${process.env.APP_BASE_URL || 'https://app.arbflash.com'}/forgot-password.html?email=${encodeURIComponent(toEmail)}`;

  const message = {
    from: process.env.FROM_EMAIL || 'no-reply@arbflash.com',
    to: toEmail,
    subject: 'Bem-vindo ao ARBFLASH!',
    html: `
      <p>Olá!</p>
      <p>Obrigado por assinar o ARBFLASH.</p>
      <p>Para definir a sua senha e acessar o painel, clique no link abaixo:</p>
      <p><a href="${resetLink}">${resetLink}</a></p>
      <p>Se você já criou uma senha anteriormente, basta fazer login normalmente.</p>
      <p>Qualquer dúvida, estamos à disposição!</p>
    `,
  };

  await transporter.sendMail(message);
}

module.exports = { sendWelcomeEmail };
