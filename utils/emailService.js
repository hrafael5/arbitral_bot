const nodemailer = require("nodemailer");

// Configura o transporte de e‑mail usando variáveis de ambiente.
// Cria o transportador SMTP. Algumas hospedagens utilizam certificados autoassinados,
// portanto adicionamos tls.rejectUnauthorized: false para evitar falhas na verificação.
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT, 10) || 587,
  secure: process.env.SMTP_SECURE === "true", // true para SSL (porta 465), false para STARTTLS (porta 587)
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
  tls: {
    rejectUnauthorized: false,
  },
  // Adicionar configurações específicas para Titan Email
  connectionTimeout: 60000, // 60 segundos
  greetingTimeout: 30000,   // 30 segundos
  socketTimeout: 60000,     // 60 segundos
});

// Função para testar a conexão SMTP
async function testConnection() {
  try {
    console.log("🔄 Testando conexão SMTP...");
    console.log(`📧 Host: ${process.env.SMTP_HOST}`);
    console.log(`🔌 Porta: ${process.env.SMTP_PORT}`);
    console.log(`👤 Usuário: ${process.env.SMTP_USER}`);
    console.log(`🔒 Seguro: ${process.env.SMTP_SECURE}`);
    
    await transporter.verify();
    console.log("✅ Conexão SMTP estabelecida com sucesso!");
    return true;
  } catch (error) {
    console.error("❌ Erro na conexão SMTP:", error.message);
    console.error("📋 Detalhes do erro:", error);
    return false;
  }
}

/**
 * Envia um e‑mail de boas‑vindas com link para definição de senha.
 * @param {string} toEmail Email do destinatário.
 */
async function sendWelcomeEmail(toEmail) {
  try {
    console.log(`📤 Enviando email de boas-vindas para: ${toEmail}`);
    
    // Gera link para a página de redefinição de senha, anexando o e‑mail como query.
    const resetLink = `${process.env.APP_BASE_URL || "https://app.arbflash.com"}/forgot-password.html?email=${encodeURIComponent(toEmail)}`;

    const message = {
      from: process.env.FROM_EMAIL || "no-reply@arbflash.com",
      to: toEmail,
      subject: "Bem-vindo ao ARBFLASH!",
      html: `
        <p>Olá!</p>
        <p>Obrigado por assinar o ARBFLASH.</p>
        <p>Para definir a sua senha e acessar o painel, clique no link abaixo:</p>
        <p><a href="${resetLink}">${resetLink}</a></p>
        <p>Se você já criou uma senha anteriormente, basta fazer login normalmente.</p>
        <p>Qualquer dúvida, estamos à disposição!</p>
      `,
    };

    const result = await transporter.sendMail(message);
    console.log("✅ Email de boas-vindas enviado com sucesso!");
    console.log("📋 ID da mensagem:", result.messageId);
    return result;
  } catch (error) {
    console.error("❌ Erro ao enviar email de boas-vindas:", error.message);
    console.error("📋 Detalhes do erro:", error);
    throw error;
  }
}

/**
 * Envia um e‑mail de redefinição de senha com um token de reset.
 * @param {string} toEmail Email do destinatário.
 * @param {string} token Token gerado para o reset.
 */
async function sendPasswordResetEmail(toEmail, token) {
  try {
    console.log(`📤 Enviando email de redefinição de senha para: ${toEmail}`);
    console.log(`🔑 Token gerado: ${token.substring(0, 8)}...`);
    
    // Use a página de recuperação existente, passando o token como parâmetro.
    const resetLink = `${process.env.APP_BASE_URL || "https://app.arbflash.com"}/forgot-password.html?token=${encodeURIComponent(token)}`;
    
    const message = {
      from: process.env.FROM_EMAIL || "no-reply@arbflash.com",
      to: toEmail,
      subject: "Recuperação de senha - ARBFLASH",
      html: `
        <p>Olá!</p>
        <p>Recebemos uma solicitação para redefinir a sua senha no ARBFLASH.</p>
        <p>Se foi você quem fez essa solicitação, clique no link abaixo ou copie o token e cole na página de redefinição:</p>
        <p><a href="${resetLink}">${resetLink}</a></p>
        <p>Token: <strong>${token}</strong></p>
        <p>Esse link expira em 1 hora. Se você não solicitou a redefinição, ignore este e‑mail.</p>
      `,
    };
    
    const result = await transporter.sendMail(message);
    console.log("✅ Email de redefinição de senha enviado com sucesso!");
    console.log("📋 ID da mensagem:", result.messageId);
    return result;
  } catch (error) {
    console.error("❌ Erro ao enviar email de redefinição de senha:", error.message);
    console.error("📋 Detalhes do erro:", error);
    
    // Log adicional para debug específico do Titan
    if (error.code === "EAUTH") {
      console.error("🔐 Erro de autenticação - verifique SMTP_USER e SMTP_PASS");
    } else if (error.code === "ECONNECTION") {
      console.error("🌐 Erro de conexão - verifique SMTP_HOST e SMTP_PORT");
    } else if (error.code === "ETIMEDOUT") {
      console.error("⏰ Timeout - servidor SMTP não respondeu a tempo");
    }
    
    throw error;
  }
}

module.exports = { 
  sendWelcomeEmail, 
  sendPasswordResetEmail, 
  testConnection 
};

