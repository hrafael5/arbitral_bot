const express = require("express");
const router = express.Router();
const crypto = require("crypto");
const { Op } = require("sequelize");
const User = require("../models/user.model");
const UserConfiguration = require("../models/userConfiguration.model");
const { sendPasswordResetEmail } = require("../utils/emailService");

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

// Função para enviar email usando o emailService real
const sendEmail = async (to, subject, html) => {
  try {
    // Aqui você pode implementar o envio real usando o emailService
    // Por enquanto, vamos logar para debug
    console.log(`\n    ===== EMAIL ENVIADO =====\n    Para: ${to}\n    Assunto: ${subject}\n    Conteúdo: ${html}\n    ==========================\n  `);
    return Promise.resolve(true);
  } catch (error) {
    console.error("Erro ao enviar email:", error);
    throw error;
  }
};

// Rota de Cadastro (Register)
router.post("/register", async (req, res) => {
  try {
    const { name, email, whatsapp, password } = req.body;
    
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

    // Criar configurações padrão do usuário
    await UserConfiguration.create({ UserId: newUser.id });

    // Gerar token de verificação de email
    const verificationToken = newUser.generateEmailVerificationToken();
    await newUser.save();

    // Enviar email de verificação (simulado)
    const baseUrl = process.env.APP_BASE_URL || `${req.protocol}://${req.get("host")}`;
    const verificationLink = `${baseUrl}/api/users/verify-email?token=${verificationToken}`;
    await sendEmail(
      newUser.email,
      "Verifique seu email - ARBFLASH",
      `
        <h2>Bem-vindo ao ARBFLASH!</h2>
        <p>Olá ${newUser.name},</p>
        <p>Para completar seu cadastro, clique no link abaixo para verificar seu email:</p>
        <a href="${verificationLink}" style="background: #1e88e5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px;">Verificar Email</a>
        <p>Este link expira em 24 horas.</p>
        <p>Se você não se cadastrou no ARBFLASH, ignore este email.</p>
      `
    );

    // Fazer login automático após cadastro
    req.session.userId = newUser.id;
    
    res.status(201).json({ 
      message: "Conta criada com sucesso! Verifique seu email para ativar sua conta.",
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

// Rota de Login com proteção contra força bruta
router.post("/login", rateLimitMiddleware, async (req, res) => {
  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ 
        message: "Por favor, preencha todos os campos: email e senha." 
      });
    }

    // Buscar usuário
    const user = await User.findOne({ where: { email: email.toLowerCase() } });
    if (!user) {
      return res.status(401).json({ 
        message: "Email ou senha inválidos. Verifique suas credenciais." 
      });
    }

    // Verificar se a conta está bloqueada
    if (user.isLocked()) {
      return res.status(423).json({ 
        message: "Conta temporariamente bloqueada devido a muitas tentativas de login. Tente novamente em 30 minutos." 
      });
    }

    // Validar senha
    const isValid = await user.validatePassword(password);
    if (!isValid) {
      await user.incrementLoginAttempts();
      return res.status(401).json({ 
        message: "Email ou senha inválidos. Verifique suas credenciais." 
      });
    }

    // Login bem-sucedido
    await user.resetLoginAttempts();
    req.session.userId = user.id;
    
    res.status(200).json({ 
      message: "Login realizado com sucesso!",
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        emailVerified: user.emailVerified,
        subscriptionStatus: user.subscriptionStatus
      }
    });
    
  } catch (error) {
    console.error("Erro no login:", error);
    res.status(500).json({ message: "Erro interno no servidor." });
  }
});

// Rota de Logout
router.post("/logout", (req, res) => {
  req.session.destroy(err => {
    if (err) {
      console.error("Erro no logout:", err);
      return res.status(500).json({ message: "Não foi possível fazer logout." });
    }
    res.clearCookie("connect.sid");
    res.status(200).json({ message: "Logout realizado com sucesso." });
  });
});

// Rota para verificação de email
router.get("/verify-email", async (req, res) => {
  try {
    const { token } = req.query;
    
    if (!token) {
      return res.status(400).json({ message: "Token de verificação não fornecido." });
    }

    const user = await User.findOne({ 
      where: { 
        emailVerificationToken: token,
        emailVerificationExpiry: { [Op.gt]: new Date() }
      } 
    });

    if (!user) {
      return res.status(400).json({ message: "Token de verificação inválido ou expirado." });
    }

    // Verificar email
    await user.update({
      emailVerified: true,
      emailVerificationToken: null,
      emailVerificationExpiry: null
    });

    res.status(200).json({ message: "Email verificado com sucesso!" });
    
  } catch (error) {
    console.error("Erro na verificação de email:", error);
    res.status(500).json({ message: "Erro interno no servidor." });
  }
});

// Rota para reenviar email de verificação
router.post("/resend-verification", async (req, res) => {
  try {
    if (!req.session.userId) {
      return res.status(401).json({ message: "Usuário não autenticado." });
    }

    const user = await User.findByPk(req.session.userId);
    if (!user) {
      return res.status(404).json({ message: "Usuário não encontrado." });
    }

    if (user.emailVerified) {
      return res.status(400).json({ message: "Email já verificado." });
    }

    // Gerar novo token
    const verificationToken = user.generateEmailVerificationToken();
    await user.save();

    // Enviar email
    const baseUrl = process.env.APP_BASE_URL || `${req.protocol}://${req.get("host")}`;
    const verificationLink = `${baseUrl}/api/users/verify-email?token=${verificationToken}`;
    await sendEmail(
      user.email,
      "Verifique seu email - ARBFLASH",
      `
        <h2>Verificação de Email</h2>
        <p>Olá ${user.name},</p>
        <p>Clique no link abaixo para verificar seu email:</p>
        <a href="${verificationLink}" style="background: #1e88e5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px;">Verificar Email</a>
        <p>Este link expira em 24 horas.</p>
      `
    );

    res.status(200).json({ message: "Email de verificação reenviado com sucesso." });
    
  } catch (error) {
    console.error("Erro ao reenviar verificação:", error);
    res.status(500).json({ message: "Erro interno no servidor." });
  }
});

// ROTA DE REDEFINIÇÃO DE SENHA REMOVIDA COMPLETAMENTE
// Esta funcionalidade agora está APENAS em passwordReset.routes.js

// Rota para buscar informações do usuário atual
router.get("/me", async (req, res) => {
  try {
    if (!req.session.userId) {
      return res.status(401).json({ message: "Usuário não autenticado." });
    }

    const user = await User.findByPk(req.session.userId, {
      attributes: ["id", "name", "email", "whatsapp", "emailVerified", "subscriptionStatus", "createdAt"]
    });

    if (!user) {
      return res.status(404).json({ message: "Usuário não encontrado." });
    }

    res.json(user);
    
  } catch (error) {
    console.error("Erro ao buscar usuário:", error);
    res.status(500).json({ message: "Erro interno do servidor." });
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

    const updates = {};
    if (name !== undefined) updates.name = name.trim();
    if (whatsapp !== undefined) updates.whatsapp = whatsapp ? whatsapp.trim() : null;

    await user.update(updates);

    res.json({ 
      message: "Perfil atualizado com sucesso!",
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        whatsapp: user.whatsapp,
        emailVerified: user.emailVerified,
        subscriptionStatus: user.subscriptionStatus
      }
    });
    
  } catch (error) {
    console.error("Erro ao atualizar perfil:", error);
    
    if (error.name === "SequelizeValidationError") {
      const messages = error.errors.map(err => err.message);
      return res.status(400).json({ message: messages.join(" ") });
    }
    
    res.status(500).json({ message: "Erro interno do servidor." });
  }
});

// Rota para BUSCAR as configurações do usuário
router.get("/settings", async (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ message: "Usuário não autenticado." });
  }
  
  try {
    const config = await UserConfiguration.findOne({ where: { UserId: req.session.userId } });
    if (!config) {
      return res.status(404).json({ message: "Configurações não encontradas." });
    }
    res.json(config);
  } catch (error) {
    console.error("Erro ao buscar configurações:", error);
    res.status(500).json({ message: "Erro ao buscar configurações." });
  }
});

// Rota para SALVAR as configurações do usuário
router.post("/settings", async (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ message: "Usuário não autenticado." });
  }
  
  try {
    const fieldsToUpdate = {};
    if (req.body.watchedPairs !== undefined) fieldsToUpdate.watchedPairs = req.body.watchedPairs;
    
    // Adicione aqui outras configurações que deseja salvar no UserConfiguration
    // Exemplo: if (req.body.someOtherSetting !== undefined) fieldsToUpdate.someOtherSetting = req.body.someOtherSetting;

    if (Object.keys(fieldsToUpdate).length === 0) {
      return res.status(400).json({ message: "Nenhum dado de configuração válido para atualizar." });
    }
    
    await UserConfiguration.update(fieldsToUpdate, { where: { UserId: req.session.userId } });
    res.status(200).json({ message: "Configurações salvas com sucesso!" });
  } catch (error) {
    console.error("Erro ao salvar configurações:", error);
    res.status(500).json({ message: "Erro ao salvar configurações." });
  }
});

module.exports = router;

