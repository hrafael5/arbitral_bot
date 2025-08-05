// routes/user.routes.js (Versão Final Completa e Revisada)

const express = require("express");
const router = express.Router();
const crypto = require("crypto");
const { Op } = require("sequelize");
const User = require("../models/user.model");
const UserConfiguration = require("../models/userConfiguration.model");

// Funções de e-mail (supondo que sendPasswordResetEmail também existe)
const { sendFreeWelcomeEmail, sendPasswordResetEmail } = require("../utils/emailService");

// Middleware de autenticação reutilizável
const isAuthenticated = (req, res, next) => {
  if (req.session && req.session.userId) {
    return next();
  }
  res.status(401).json({ message: "Acesso não autorizado. Por favor, faça login." });
};

// Rota de Cadastro (Register)
router.post("/register", async (req, res) => {
  try {
    const { name, email, whatsapp, password } = req.body;
    console.log(`📝 Tentativa de cadastro para: ${email}`);

    if (!name || !email || !password) {
      return res.status(400).json({ message: "Nome, email e senha são obrigatórios." });
    }

    // Criar novo usuário com o status "free"
    const newUser = await User.create({
      name: name.trim(),
      email: email.toLowerCase().trim(),
      whatsapp: whatsapp ? whatsapp.trim() : null,
      password,
      subscriptionStatus: "free" // <-- CORREÇÃO PRINCIPAL
    });
    console.log(`✅ Novo usuário criado: ${newUser.id} - ${newUser.email}`);

    // Criar configurações padrão
    await UserConfiguration.create({ UserId: newUser.id });

    // Enviar e-mail de boas-vindas
    try {
      await sendFreeWelcomeEmail(newUser.email, newUser.name);
      console.log(`📧 E-mail de boas-vindas (free) enviado para: ${newUser.email}`);
    } catch (emailError) {
      console.error(`❌ Erro ao enviar e-mail para ${newUser.email}:`, emailError);
    }

    // Login automático após cadastro
    req.session.userId = newUser.id;
    
    res.status(201).json({ message: "Conta criada com sucesso!" });
    
  } catch (error) {
    console.error("Erro no cadastro:", error);
    if (error.name === "SequelizeValidationError") {
      return res.status(400).json({ message: error.errors.map(e => e.message).join(", ") });
    }
    if (error.name === "SequelizeUniqueConstraintError") {
      return res.status(409).json({ message: "Este email já está cadastrado." });
    }
    res.status(500).json({ message: "Ocorreu um erro interno ao criar sua conta." });
  }
});

// Rota de Login com sistema de bloqueio
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ message: "Email e senha são obrigatórios." });
    }

    const user = await User.findOne({ where: { email: email.toLowerCase() } });
    if (!user) {
      return res.status(401).json({ message: "Email ou senha inválidos." });
    }

    if (user.isLocked()) {
      return res.status(429).json({ message: "Conta temporariamente bloqueada. Tente novamente mais tarde." });
    }

    const isValidPassword = await user.validatePassword(password);
    if (!isValidPassword) {
      await user.incrementLoginAttempts();
      return res.status(401).json({ message: "Email ou senha inválidos." });
    }

    await user.resetLoginAttempts();
    req.session.userId = user.id;
    
    console.log(`✅ Login bem-sucedido para: ${user.email} (ID: ${user.id})`);
    res.json({ message: "Login realizado com sucesso!" });

  } catch (error) {
    console.error("Erro no login:", error);
    res.status(500).json({ message: "Ocorreu um erro interno durante o login." });
  }
});

// Rota de Logout
router.post("/logout", (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ message: "Não foi possível fazer logout." });
    }
    res.clearCookie("connect.sid");
    res.json({ message: "Logout realizado com sucesso!" });
  });
});

// Rota para obter dados do usuário logado
router.get("/me", isAuthenticated, async (req, res) => {
  try {
    const user = await User.findByPk(req.session.userId, {
      attributes: { exclude: ["password", "resetToken", "resetTokenExpiry", "emailVerificationToken", "emailVerificationExpiry"] }
    });
    if (!user) {
      req.session.destroy();
      return res.status(404).json({ message: "Usuário não encontrado." });
    }
    res.json(user);
  } catch (error) {
    console.error(`Erro ao buscar dados do usuário ${req.session.userId}:`, error);
    res.status(500).json({ message: "Erro ao buscar dados do usuário." });
  }
});

// Rota para solicitar redefinição de senha
router.post("/forgot-password", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ message: "Email é obrigatório." });
    }

    const user = await User.findOne({ where: { email: email.toLowerCase() } });
    if (user) {
      const resetToken = user.generatePasswordResetToken(); // Usa o método do modelo
      await user.save();
      
      try {
        await sendPasswordResetEmail(user.email, resetToken);
        console.log(`📧 E-mail de redefinição enviado para: ${user.email}`);
      } catch (emailError) {
        console.error(`❌ Erro ao enviar e-mail de redefinição para ${user.email}:`, emailError);
        return res.status(500).json({ message: "Erro ao enviar email de redefinição." });
      }
    }
    // Por segurança, sempre retorne a mesma mensagem
    res.json({ message: "Se o email estiver cadastrado, você receberá as instruções para redefinir sua senha." });
  } catch (error) {
    console.error("Erro na solicitação de redefinição de senha:", error);
    res.status(500).json({ message: "Erro interno no servidor." });
  }
});

// Rota para verificar email (NÃO precisa de autenticação)
router.get("/verify-email", async (req, res) => {
  try {
    const { token } = req.query;
    if (!token) {
      return res.status(400).json({ message: "Token de verificação é obrigatório." });
    }

    // Criptografa o token recebido para comparar com o que está no DB
    const hashedToken = crypto.createHash("sha256").update(token).digest("hex");
    
    const user = await User.findOne({
      where: {
        emailVerificationToken: hashedToken,
        emailVerificationExpiry: { [Op.gt]: new Date() } // [Op.gt] significa "maior que"
      }
    });

    if (!user) {
      return res.status(400).json({ message: "Token inválido ou expirado." });
    }

    user.emailVerified = true;
    user.emailVerificationToken = null;
    user.emailVerificationExpiry = null;
    await user.save();

    res.json({ message: "Email verificado com sucesso!" });
  } catch (error) {
    console.error("Erro na verificação de email:", error);
    res.status(500).json({ message: "Erro interno no servidor." });
  }
});

// Rota para atualizar perfil do usuário
router.put("/profile", isAuthenticated, async (req, res) => {
  try {
    const { name, whatsapp } = req.body;
    const user = await User.findByPk(req.session.userId);

    if (name) user.name = name.trim();
    if (whatsapp !== undefined) user.whatsapp = whatsapp ? whatsapp.trim() : null;
    
    await user.save();
    res.json({ message: "Perfil atualizado com sucesso!" });
  } catch (error) {
    console.error("Erro ao atualizar perfil:", error);
    res.status(500).json({ message: "Erro interno no servidor." });
  }
});

// Rota para alterar senha
router.put("/change-password", isAuthenticated, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ message: "Senha atual e nova senha são obrigatórias." });
    }

    const user = await User.findByPk(req.session.userId);
    const isValidPassword = await user.validatePassword(currentPassword);
    if (!isValidPassword) {
      return res.status(400).json({ message: "Senha atual incorreta." });
    }

    user.password = newPassword; // O hook "beforeUpdate" no modelo irá criptografar
    await user.save();
    res.json({ message: "Senha alterada com sucesso!" });
  } catch (error) {
    console.error("Erro ao alterar senha:", error);
    if (error.name === "SequelizeValidationError") {
      return res.status(400).json({ message: error.errors.map(e => e.message).join(", ") });
    }
    res.status(500).json({ message: "Erro interno no servidor." });
  }
});

// Rota para deletar conta
router.delete("/account", isAuthenticated, async (req, res) => {
  try {
    const { password } = req.body;
    if (!password) {
      return res.status(400).json({ message: "Senha é obrigatória para deletar a conta." });
    }

    const user = await User.findByPk(req.session.userId);
    const isValidPassword = await user.validatePassword(password);
    if (!isValidPassword) {
      return res.status(400).json({ message: "Senha incorreta." });
    }

    await UserConfiguration.destroy({ where: { UserId: user.id } });
    await user.destroy();
    req.session.destroy();
    res.json({ message: "Conta deletada com sucesso." });
  } catch (error) {
    console.error("Erro ao deletar conta:", error);
    res.status(500).json({ message: "Erro interno no servidor." });
  }
});

// --- ROTAS DE CONFIGURAÇÕES (PROTEGIDAS) ---

router.get("/settings", isAuthenticated, async (req, res) => {
    try {
        const userConfig = await UserConfiguration.findOne({ where: { UserId: req.session.userId } });
        if (!userConfig) {
            return res.status(404).json({ message: "Configurações não encontradas." });
        }
        res.json(userConfig);
    } catch (error) {
        console.error(`Erro ao buscar config do usuário ${req.session.userId}:`, error);
        res.status(500).json({ message: "Erro ao buscar configurações." });
    }
});

router.post("/settings", isAuthenticated, async (req, res) => {
    try {
        const [userConfig] = await UserConfiguration.findOrCreate({
            where: { UserId: req.session.userId }
        });
        await userConfig.update(req.body);
        res.json({ message: "Configurações salvas com sucesso!", config: userConfig });
    } catch (error) {
        console.error(`Erro ao salvar config do usuário ${req.session.userId}:`, error);
        res.status(500).json({ message: "Erro ao salvar configurações." });
    }
});

module.exports = router;

