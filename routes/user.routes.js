const express = require("express");
const router = express.Router();
const crypto = require("crypto");
const { Op } = require("sequelize");
const User = require("../models/user.model");
const UserConfiguration = require("../models/userConfiguration.model");

// Importar as funções de e-mail melhoradas
const { sendFreeWelcomeEmail, sendPasswordResetEmail } = require("../utils/emailService");

// Middleware para rate limiting (implementação simples)
const loginAttempts = new Map();

const rateLimitMiddleware = (req, res, next) => {
  const ip = req.ip || req.connection.remoteAddress;
  const now = Date.now();
  const windowMs = 15 * 60 * 1000; // 15 minutos
  const maxAttempts = 10;

  if (!loginAttempts.has(ip)) {
    loginAttempts.set(ip, { count: 1, resetTime: now + windowMs });
    return next();
  }

  const attempts = loginAttempts.get(ip);
  
  if (now > attempts.resetTime) {
    attempts.count = 1;
    attempts.resetTime = now + windowMs;
    return next();
  }

  if (attempts.count >= maxAttempts) {
    return res.status(429).json({ 
      message: "Muitas tentativas de login. Tente novamente em 15 minutos." 
    });
  }

  attempts.count++;
  next();
};

// Rota de Cadastro (Register) - MELHORADA COM E-MAIL DE BOAS-VINDAS
router.post("/register", async (req, res) => {
  try {
    const { name, email, whatsapp, password } = req.body;
    
    console.log(`📝 Tentativa de cadastro para: ${email}`);
    
    // Validações básicas
    if (!name || !email || !password) {
      return res.status(400).json({ 
        message: "Por favor, preencha todos os campos obrigatórios: nome, email e senha." 
      });
    }

    // Verificar se o email já existe
    const existingUser = await User.findOne({ where: { email: email.toLowerCase() } });
    if (existingUser) {
      return res.status(409).json({ 
        message: "Este email já está cadastrado. Tente fazer login ou use outro email." 
      });
    }

    // Criar novo usuário
    const newUser = await User.create({ 
      name: name.trim(),
      email: email.toLowerCase().trim(),
      whatsapp: whatsapp ? whatsapp.trim() : null,
      password 
    });

    console.log(`✅ Novo usuário criado: ${newUser.id} - ${newUser.email}`);

    // Criar configurações padrão do usuário
    await UserConfiguration.create({ UserId: newUser.id });

    // Gerar token de verificação de email
    const verificationToken = newUser.generateEmailVerificationToken();
    await newUser.save();

    // NOVO: Enviar e-mail de boas-vindas para conta free
    try {
      await sendFreeWelcomeEmail(newUser.email, newUser.name);
      console.log(`📧 E-mail de boas-vindas (free) enviado para: ${newUser.email}`);
    } catch (emailError) {
      console.error(`❌ Erro ao enviar e-mail de boas-vindas para ${newUser.email}:`, emailError);
      // Não falha o cadastro se o e-mail não for enviado
    }

    // Fazer login automático após cadastro
    req.session.userId = newUser.id;
    
    res.status(201).json({ 
      message: "Conta criada com sucesso! Verifique seu email para conhecer todas as funcionalidades.",
      emailSent: true
    });
    
  } catch (error) {
    console.error("Erro no cadastro:", error);
    
    // Capturar erros de validação do Sequelize
    if (error.name === "SequelizeValidationError") {
      const messages = error.errors.map(err => err.message);
      return res.status(400).json({ message: messages.join(" ") });
    }
    
    if (error.name === "SequelizeUniqueConstraintError") {
      return res.status(409).json({ message: "Este email já está cadastrado." });
    }
    
    res.status(500).json({ message: "Erro interno ao criar o usuário." });
  }
});

// Rota de Login
router.post("/login", rateLimitMiddleware, async (req, res) => {
  try {
    const { email, password } = req.body;
    
    console.log(`🔐 Tentativa de login para: ${email}`);

    if (!email || !password) {
      return res.status(400).json({ message: "Email e senha são obrigatórios." });
    }

    // Buscar usuário
    const user = await User.findOne({ 
      where: { email: email.toLowerCase() },
      include: [UserConfiguration]
    });

    if (!user) {
      return res.status(401).json({ message: "Credenciais inválidas." });
    }

    // Verificar senha
    const isValidPassword = await user.validatePassword(password);
    if (!isValidPassword) {
      return res.status(401).json({ message: "Credenciais inválidas." });
    }

    // Atualizar último login
    user.lastLogin = new Date();
    await user.save();

    // Criar sessão
    req.session.userId = user.id;
    
    console.log(`✅ Login bem-sucedido para: ${user.email} (ID: ${user.id})`);

    res.json({ 
      message: "Login realizado com sucesso!",
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        subscriptionStatus: user.subscriptionStatus,
        emailVerified: user.emailVerified
      }
    });

  } catch (error) {
    console.error("Erro no login:", error);
    res.status(500).json({ message: "Erro interno no servidor." });
  }
});

// Rota de Logout
router.post("/logout", (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error("Erro ao fazer logout:", err);
      return res.status(500).json({ message: "Erro ao fazer logout." });
    }
    res.json({ message: "Logout realizado com sucesso!" });
  });
});

// Rota para verificar se o usuário está logado
router.get("/me", async (req, res) => {
  try {
    if (!req.session.userId) {
      return res.status(401).json({ message: "Usuário não autenticado." });
    }

    const user = await User.findByPk(req.session.userId, {
      include: [UserConfiguration],
      attributes: { exclude: ['password', 'passwordResetToken', 'passwordResetExpires'] }
    });

    if (!user) {
      req.session.destroy();
      return res.status(401).json({ message: "Usuário não encontrado." });
    }

    res.json({ user });

  } catch (error) {
    console.error("Erro ao buscar dados do usuário:", error);
    res.status(500).json({ message: "Erro interno no servidor." });
  }
});

// Rota para solicitar redefinição de senha - MELHORADA
router.post("/forgot-password", async (req, res) => {
  try {
    const { email } = req.body;
    
    console.log(`🔑 Solicitação de redefinição de senha para: ${email}`);

    if (!email) {
      return res.status(400).json({ message: "Email é obrigatório." });
    }

    const user = await User.findOne({ where: { email: email.toLowerCase() } });
    
    if (!user) {
      // Por segurança, não revelamos se o email existe ou não
      return res.json({ 
        message: "Se o email estiver cadastrado, você receberá as instruções para redefinir sua senha." 
      });
    }

    // Gerar token de redefinição
    const resetToken = user.generatePasswordResetToken();
    await user.save();

    // Enviar email de redefinição com design melhorado
    try {
      await sendPasswordResetEmail(user.email, resetToken);
      console.log(`📧 E-mail de redefinição enviado para: ${user.email}`);
    } catch (emailError) {
      console.error(`❌ Erro ao enviar e-mail de redefinição para ${user.email}:`, emailError);
      return res.status(500).json({ message: "Erro ao enviar email de redefinição." });
    }

    res.json({ 
      message: "Se o email estiver cadastrado, você receberá as instruções para redefinir sua senha." 
    });

  } catch (error) {
    console.error("Erro na solicitação de redefinição de senha:", error);
    res.status(500).json({ message: "Erro interno no servidor." });
  }
});

// Rota para verificar email
router.get("/verify-email", async (req, res) => {
  try {
    const { token } = req.query;

    if (!token) {
      return res.status(400).json({ message: "Token de verificação é obrigatório." });
    }

    const hashedToken = crypto.createHash("sha256").update(token).digest("hex");
    
    const user = await User.findOne({
      where: {
        emailVerificationToken: hashedToken,
        emailVerificationExpires: { [Op.gt]: Date.now() }
      }
    });

    if (!user) {
      return res.status(400).json({ message: "Token inválido ou expirado." });
    }

    // Marcar email como verificado
    user.emailVerified = true;
    user.emailVerificationToken = null;
    user.emailVerificationExpires = null;
    await user.save();

    res.json({ message: "Email verificado com sucesso!" });

  } catch (error) {
    console.error("Erro na verificação de email:", error);
    res.status(500).json({ message: "Erro interno no servidor." });
  }
});

// Rota para atualizar perfil do usuário
router.put("/profile", async (req, res) => {
  try {
    if (!req.session.userId) {
      return res.status(401).json({ message: "Usuário não autenticado." });
    }

    const { name, whatsapp } = req.body;
    
    const user = await User.findByPk(req.session.userId);
    if (!user) {
      return res.status(404).json({ message: "Usuário não encontrado." });
    }

    // Atualizar dados
    if (name) user.name = name.trim();
    if (whatsapp !== undefined) user.whatsapp = whatsapp ? whatsapp.trim() : null;
    
    await user.save();

    res.json({ 
      message: "Perfil atualizado com sucesso!",
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        whatsapp: user.whatsapp,
        subscriptionStatus: user.subscriptionStatus
      }
    });

  } catch (error) {
    console.error("Erro ao atualizar perfil:", error);
    res.status(500).json({ message: "Erro interno no servidor." });
  }
});

// Rota para alterar senha (usuário logado)
router.put("/change-password", async (req, res) => {
  try {
    if (!req.session.userId) {
      return res.status(401).json({ message: "Usuário não autenticado." });
    }

    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ message: "Senha atual e nova senha são obrigatórias." });
    }

    const user = await User.findByPk(req.session.userId);
    if (!user) {
      return res.status(404).json({ message: "Usuário não encontrado." });
    }

    // Verificar senha atual
    const isValidPassword = await user.validatePassword(currentPassword);
    if (!isValidPassword) {
      return res.status(400).json({ message: "Senha atual incorreta." });
    }

    // Atualizar senha
    user.password = newPassword;
    await user.save();

    res.json({ message: "Senha alterada com sucesso!" });

  } catch (error) {
    console.error("Erro ao alterar senha:", error);
    
    if (error.name === "SequelizeValidationError") {
      const messages = error.errors.map(err => err.message);
      return res.status(400).json({ message: messages.join(" ") });
    }
    
    res.status(500).json({ message: "Erro interno no servidor." });
  }
});

// Rota para deletar conta
router.delete("/account", async (req, res) => {
  try {
    if (!req.session.userId) {
      return res.status(401).json({ message: "Usuário não autenticado." });
    }

    const { password } = req.body;

    if (!password) {
      return res.status(400).json({ message: "Senha é obrigatória para deletar a conta." });
    }

    const user = await User.findByPk(req.session.userId);
    if (!user) {
      return res.status(404).json({ message: "Usuário não encontrado." });
    }

    // Verificar senha
    const isValidPassword = await user.validatePassword(password);
    if (!isValidPassword) {
      return res.status(400).json({ message: "Senha incorreta." });
    }

    // Deletar configurações do usuário primeiro (devido à foreign key)
    await UserConfiguration.destroy({ where: { UserId: user.id } });
    
    // Deletar usuário
    await user.destroy();

    // Destruir sessão
    req.session.destroy();

    res.json({ message: "Conta deletada com sucesso." });

  } catch (error) {
    console.error("Erro ao deletar conta:", error);
    res.status(500).json({ message: "Erro interno no servidor." });
  }
});

module.exports = router;



// Rota para obter configurações do usuário
router.get("/settings", async (req, res) => {
  try {
    if (!req.session.userId) {
      return res.status(401).json({ message: "Usuário não autenticado." });
    }

    const userConfig = await UserConfiguration.findOne({ where: { UserId: req.session.userId } });

    if (!userConfig) {
      return res.status(404).json({ message: "Configurações do usuário não encontradas." });
    }

    res.json({ config: userConfig });

  } catch (error) {
    console.error("Erro ao buscar configurações do usuário:", error);
    res.status(500).json({ message: "Erro interno no servidor." });
  }
});

// Rota para atualizar configurações do usuário
router.put("/settings", async (req, res) => {
  try {
    if (!req.session.userId) {
      return res.status(401).json({ message: "Usuário não autenticado." });
    }

    const { 
      minProfitPercentage,
      enableFuturesVsFutures,
      enableSpotVsSpot,
      mexcSpotMakerFee,
      mexcFuturesMakerFee,
      gateioSpotMakerFee,
      gateioFuturesMakerFee,
      blacklistedTokens
    } = req.body;

    const userConfig = await UserConfiguration.findOne({ where: { UserId: req.session.userId } });

    if (!userConfig) {
      return res.status(404).json({ message: "Configurações do usuário não encontradas." });
    }

    // Atualizar campos, se fornecidos
    if (minProfitPercentage !== undefined) userConfig.minProfitPercentage = minProfitPercentage;
    if (enableFuturesVsFutures !== undefined) userConfig.enableFuturesVsFutures = enableFuturesVsFutures;
    if (enableSpotVsSpot !== undefined) userConfig.enableSpotVsSpot = enableSpotVsSpot;
    if (mexcSpotMakerFee !== undefined) userConfig.mexcSpotMakerFee = mexcSpotMakerFee;
    if (mexcFuturesMakerFee !== undefined) userConfig.mexcFuturesMakerFee = mexcFuturesMakerFee;
    if (gateioSpotMakerFee !== undefined) userConfig.gateioSpotMakerFee = gateioSpotMakerFee;
    if (gateioFuturesMakerFee !== undefined) userConfig.gateioFuturesMakerFee = gateioFuturesMakerFee;
    if (blacklistedTokens !== undefined) userConfig.blacklistedTokens = blacklistedTokens;

    await userConfig.save();

    res.json({ message: "Configurações atualizadas com sucesso!", config: userConfig });

  } catch (error) {
    console.error("Erro ao atualizar configurações do usuário:", error);
    res.status(500).json({ message: "Erro interno no servidor." });
  }
});


