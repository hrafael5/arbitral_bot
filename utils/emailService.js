const nodemailer = require('nodemailer');

// Configura o transporte de e‑mail usando variáveis de ambiente.
// Cria o transportador SMTP. Algumas hospedagens utilizam certificados autoassinados,
// portanto adicionamos tls.rejectUnauthorized: false para evitar falhas na verificação.
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT, 10) || 587,
  secure: process.env.SMTP_SECURE === 'true', // true para SSL (porta 465), false para STARTTLS (porta 587)
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
  tls: {
    rejectUnauthorized: false,
  },
  connectionTimeout: 30000, // 30 segundos
  greetingTimeout: 30000,   // 30 segundos
  socketTimeout: 30000,     // 30 segundos
});

/**
 * Envia um e‑mail de boas‑vindas com link para definição de senha (para usuários que compraram premium).
 * @param {string} toEmail Email do destinatário.
 */
async function sendWelcomeEmail(toEmail) {
  console.log(`📧 Enviando email de boas-vindas (premium) para: ${toEmail}`);
  
  // Gera link para a página de redefinição de senha, anexando o e‑mail como query.
  const resetLink = `${process.env.APP_BASE_URL || 'https://app.arbflash.com'}/forgot-password.html?email=${encodeURIComponent(toEmail)}`;

  const message = {
    from: process.env.FROM_EMAIL || 'no-reply@arbflash.com',
    to: toEmail,
    subject: 'Bem-vindo ao ARBFLASH Premium! ⚡',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f8f9fa;">
        <div style="background-color: white; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
          <div style="text-align: center; margin-bottom: 30px;">
            <h1 style="color: #2c5aa0; margin: 0; font-size: 28px;">ARBFLASH ⚡</h1>
            <h2 style="color: #28a745; margin: 10px 0 0 0; font-size: 24px;">Bem-vindo ao Premium!</h2>
          </div>
          
          <p style="font-size: 16px; line-height: 1.6; color: #333;">Olá!</p>
          
          <p style="font-size: 16px; line-height: 1.6; color: #333;">
            🎉 <strong>Parabéns!</strong> Obrigado por assinar o ARBFLASH Premium. Agora você tem acesso a todas as funcionalidades avançadas da nossa plataforma de arbitragem.
          </p>
          
          <div style="background-color: #e8f5e8; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <h3 style="color: #28a745; margin-top: 0;">🚀 O que você ganha com o Premium:</h3>
            <ul style="color: #333; line-height: 1.8;">
              <li>Todas as funcionalidades da versão Freemium</li>
              <li>Estratégias avançadas: Futuros vs Futuros e Spot vs Spot</li>
              <li>Filtros avançados de volume mínimo e funding rate</li>
              <li>Monitor de saída de operações</li>
              <li>Visualização de oportunidades com ambos lucros positivos</li>
              <li>Acesso completo a todas as corretoras e pares</li>
            </ul>
          </div>
          
          <p style="font-size: 16px; line-height: 1.6; color: #333;">
            Para definir sua senha e acessar o painel premium, clique no botão abaixo:
          </p>
          
          <div style="text-align: center; margin: 30px 0;">
            <a href="${resetLink}" style="background-color: #28a745; color: white; padding: 15px 30px; text-decoration: none; border-radius: 5px; font-weight: bold; font-size: 16px; display: inline-block;">
              🔐 Definir Minha Senha
            </a>
          </div>
          
          <p style="font-size: 14px; color: #666; text-align: center;">
            Se o botão não funcionar, copie e cole este link no seu navegador:<br>
            <a href="${resetLink}" style="color: #2c5aa0; word-break: break-all;">${resetLink}</a>
          </p>
          
          <p style="font-size: 16px; line-height: 1.6; color: #333;">
            Se você já criou uma senha anteriormente, basta fazer login normalmente em <a href="${process.env.APP_BASE_URL || 'https://app.arbflash.com'}" style="color: #2c5aa0;">app.arbflash.com</a>.
          </p>
          
          <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
          
          <p style="font-size: 14px; color: #666; text-align: center;">
            Qualquer dúvida, estamos à disposição!<br>
            Equipe ARBFLASH ⚡
          </p>
        </div>
      </div>
    `,
  };

  try {
    const result = await transporter.sendMail(message);
    console.log(`✅ Email de boas-vindas (premium) enviado com sucesso!`);
    console.log(`📋 ID da mensagem: ${result.messageId}`);
    return result;
  } catch (error) {
    console.error(`❌ Erro ao enviar email de boas-vindas (premium):`, error);
    throw error;
  }
}

/**
 * Envia um e‑mail de boas-vindas para novos cadastros (conta free).
 * @param {string} toEmail Email do destinatário.
 * @param {string} userName Nome do usuário.
 */
async function sendFreeWelcomeEmail(toEmail, userName = 'Novo usuário') {
  console.log(`📧 Enviando email de boas-vindas (free) para: ${toEmail}`);
  
  const loginLink = `${process.env.APP_BASE_URL || 'https://app.arbflash.com'}/login.html`;
  const upgradeLink = `http://arbflash.com/`; // Página de vendas

  const message = {
    from: process.env.FROM_EMAIL || 'no-reply@arbflash.com',
    to: toEmail,
    subject: 'Bem-vindo ao ARBFLASH! Comece a lucrar com arbitragem ⚡',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f8f9fa;">
        <div style="background-color: white; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
          <div style="text-align: center; margin-bottom: 30px;">
            <h1 style="color: #2c5aa0; margin: 0; font-size: 28px;">ARBFLASH ⚡</h1>
            <h2 style="color: #333; margin: 10px 0 0 0; font-size: 24px;">Bem-vindo à plataforma!</h2>
          </div>
          
          <p style="font-size: 16px; line-height: 1.6; color: #333;">Olá, ${userName}!</p>
          
          <p style="font-size: 16px; line-height: 1.6; color: #333;">
            🎉 <strong>Parabéns!</strong> Você acabou de se cadastrar na melhor plataforma de arbitragem de criptomoedas do Brasil. Agora você pode começar a identificar oportunidades de lucro entre diferentes exchanges.
          </p>
          
          <div style="background-color: #e7f3ff; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <h3 style="color: #2c5aa0; margin-top: 0;">🚀 O que você pode fazer agora:</h3>
            <ul style="color: #333; line-height: 1.8;">
              <li>✅ Acessar oportunidades de arbitragem em tempo real</li>
              <li>✅ Monitorar spreads entre MEXC e Gate.io</li>
              <li>✅ Visualizar volumes e taxas de funding</li>
              <li>✅ Usar filtros básicos para encontrar as melhores oportunidades</li>
            </ul>
          </div>
          
          <div style="text-align: center; margin: 30px 0;">
            <a href="${loginLink}" style="background-color: #2c5aa0; color: white; padding: 15px 30px; text-decoration: none; border-radius: 5px; font-weight: bold; font-size: 16px; display: inline-block;">
              🚀 Acessar Dashboard
            </a>
          </div>
          
          <div style="background-color: #fff3cd; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #ffc107;">
            <h3 style="color: #856404; margin-top: 0;">💎 Quer ainda mais recursos?</h3>
            <p style="color: #856404; margin-bottom: 15px; line-height: 1.6;">
              Upgrade para o <strong>ARBFLASH Premium</strong> e tenha acesso a:
            </p>
            <ul style="color: #856404; line-height: 1.8; margin-bottom: 20px;">
              <li>Estratégias avançadas: Futuros vs Futuros e Spot vs Spot</li>
              <li>Filtros avançados de volume mínimo e funding rate</li>
              <li>Monitor de saída de operações</li>
              <li>Visualização de oportunidades com ambos lucros positivos</li>
              <li>Acesso completo a todas as corretoras e pares</li>
            </ul>
            <div style="text-align: center;">
              <a href="${upgradeLink}" style="background-color: #28a745; color: white; padding: 12px 25px; text-decoration: none; border-radius: 5px; font-weight: bold; font-size: 14px; display: inline-block;">
                💎 Upgrade para Premium
              </a>
            </div>
          </div>
          
          <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
          
          <p style="font-size: 14px; color: #666; text-align: center;">
            Dúvidas? Estamos aqui para ajudar!<br>
            Equipe ARBFLASH ⚡
          </p>
        </div>
      </div>
    `,
  };

  try {
    const result = await transporter.sendMail(message);
    console.log(`✅ Email de boas-vindas (free) enviado com sucesso!`);
    console.log(`📋 ID da mensagem: ${result.messageId}`);
    return result;
  } catch (error) {
    console.error(`❌ Erro ao enviar email de boas-vindas (free):`, error);
    throw error;
  }
}

/**
 * Envia um e‑mail de parabéns para usuários existentes que compraram premium.
 * @param {string} toEmail Email do destinatário.
 * @param {string} userName Nome do usuário.
 */
async function sendPremiumUpgradeEmail(toEmail, userName = 'Usuário') {
  console.log(`📧 Enviando email de parabéns (upgrade premium) para: ${toEmail}`);
  
  const loginLink = `${process.env.APP_BASE_URL || 'https://app.arbflash.com'}/login.html`;

  const message = {
    from: process.env.FROM_EMAIL || 'no-reply@arbflash.com',
    to: toEmail,
    subject: 'Parabéns! Sua conta foi atualizada para Premium! 🎉',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f8f9fa;">
        <div style="background-color: white; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
          <div style="text-align: center; margin-bottom: 30px;">
            <h1 style="color: #2c5aa0; margin: 0; font-size: 28px;">ARBFLASH ⚡</h1>
            <h2 style="color: #28a745; margin: 10px 0 0 0; font-size: 24px;">🎉 Parabéns!</h2>
          </div>
          
          <p style="font-size: 16px; line-height: 1.6; color: #333;">Olá, ${userName}!</p>
          
          <p style="font-size: 16px; line-height: 1.6; color: #333;">
            🚀 <strong>Sua conta foi atualizada para Premium!</strong> Obrigado por confiar no ARBFLASH e investir na melhor ferramenta de arbitragem do mercado.
          </p>
          
          <div style="background-color: #e8f5e8; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <h3 style="color: #28a745; margin-top: 0;">💎 Agora você tem acesso a:</h3>
            <ul style="color: #333; line-height: 1.8;">
              <li>✨ Todas as funcionalidades da versão gratuita</li>
              <li>🔥 Estratégias avançadas: Futuros vs Futuros e Spot vs Spot</li>
              <li>🎯 Filtros avançados de volume mínimo e funding rate</li>
              <li>📊 Monitor de saída de operações</li>
              <li>💰 Visualização de oportunidades com ambos lucros positivos</li>
              <li>🌐 Acesso completo a todas as corretoras e pares</li>
            </ul>
          </div>
          
          <p style="font-size: 16px; line-height: 1.6; color: #333;">
            Suas novas funcionalidades premium já estão ativas! Faça login agora e comece a explorar todas as possibilidades:
          </p>
          
          <div style="text-align: center; margin: 30px 0;">
            <a href="${loginLink}" style="background-color: #28a745; color: white; padding: 15px 30px; text-decoration: none; border-radius: 5px; font-weight: bold; font-size: 16px; display: inline-block;">
              🚀 Acessar Dashboard Premium
            </a>
          </div>
          
          <div style="background-color: #fff3cd; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #ffc107;">
            <h4 style="color: #856404; margin-top: 0;">💡 Dica Pro:</h4>
            <p style="color: #856404; margin-bottom: 0; line-height: 1.6;">
              Explore as novas estratégias "Futuros vs Futuros" e "Spot vs Spot" para encontrar oportunidades ainda mais lucrativas que outros traders não conseguem ver!
            </p>
          </div>
          
          <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
          
          <p style="font-size: 14px; color: #666; text-align: center;">
            Obrigado por fazer parte da família ARBFLASH Premium!<br>
            Equipe ARBFLASH ⚡
          </p>
        </div>
      </div>
    `,
  };

  try {
    const result = await transporter.sendMail(message);
    console.log(`✅ Email de parabéns (upgrade premium) enviado com sucesso!`);
    console.log(`📋 ID da mensagem: ${result.messageId}`);
    return result;
  } catch (error) {
    console.error(`❌ Erro ao enviar email de parabéns (upgrade premium):`, error);
    throw error;
  }
}

/**
 * Envia um e‑mail de redefinição de senha com um token de reset.
 * @param {string} toEmail Email do destinatário.
 * @param {string} token Token gerado para o reset.
 */
async function sendPasswordResetEmail(toEmail, token) {
  console.log(`📧 Enviando email de redefinição de senha para: ${toEmail}`);
  console.log(`🔑 Token gerado: ${token.substring(0, 8)}...`);
  
  // Use a página de recuperação existente, passando o token como parâmetro.
  const resetLink = `${process.env.APP_BASE_URL || 'https://app.arbflash.com'}/forgot-password.html?token=${encodeURIComponent(token)}`;
  const message = {
    from: process.env.FROM_EMAIL || 'no-reply@arbflash.com',
    to: toEmail,
    subject: 'Recuperação de senha - ARBFLASH',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f8f9fa;">
        <div style="background-color: white; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
          <div style="text-align: center; margin-bottom: 30px;">
            <h1 style="color: #2c5aa0; margin: 0; font-size: 28px;">ARBFLASH ⚡</h1>
            <h2 style="color: #333; margin: 10px 0 0 0; font-size: 24px;">Recuperação de Senha</h2>
          </div>
          
          <p style="font-size: 16px; line-height: 1.6; color: #333;">Olá!</p>
          
          <p style="font-size: 16px; line-height: 1.6; color: #333;">
            Recebemos uma solicitação para redefinir a sua senha no ARBFLASH.
          </p>
          
          <p style="font-size: 16px; line-height: 1.6; color: #333;">
            Se foi você quem fez essa solicitação, clique no botão abaixo:
          </p>
          
          <div style="text-align: center; margin: 30px 0;">
            <a href="${resetLink}" style="background-color: #dc3545; color: white; padding: 15px 30px; text-decoration: none; border-radius: 5px; font-weight: bold; font-size: 16px; display: inline-block;">
              🔐 Redefinir Minha Senha
            </a>
          </div>
          
          <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <p style="margin: 0; color: #666; font-size: 14px; text-align: center;">
              <strong>Token de recuperação:</strong><br>
              <code style="background-color: #e9ecef; padding: 5px 10px; border-radius: 3px; font-family: monospace; font-size: 16px; color: #495057;">${token}</code>
            </p>
          </div>
          
          <p style="font-size: 14px; color: #666; text-align: center;">
            Se o botão não funcionar, copie e cole este link no seu navegador:<br>
            <a href="${resetLink}" style="color: #2c5aa0; word-break: break-all;">${resetLink}</a>
          </p>
          
          <div style="background-color: #fff3cd; padding: 15px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #ffc107;">
            <p style="margin: 0; color: #856404; font-size: 14px;">
              ⚠️ <strong>Importante:</strong> Este link expira em 1 hora. Se você não solicitou a redefinição, ignore este e‑mail.
            </p>
          </div>
          
          <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
          
          <p style="font-size: 14px; color: #666; text-align: center;">
            Equipe ARBFLASH ⚡
          </p>
        </div>
      </div>
    `,
  };
  
  try {
    const result = await transporter.sendMail(message);
    console.log(`✅ Email de redefinição de senha enviado com sucesso!`);
    console.log(`📋 ID da mensagem: ${result.messageId}`);
    return result;
  } catch (error) {
    console.error(`❌ Erro ao enviar email de redefinição de senha:`, error);
    throw error;
  }
}

module.exports = { 
  sendWelcomeEmail, 
  sendFreeWelcomeEmail, 
  sendPremiumUpgradeEmail, 
  sendPasswordResetEmail 
};

