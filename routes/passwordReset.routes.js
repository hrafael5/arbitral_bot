const express = require('express');
const crypto = require('crypto');
const { Op } = require('sequelize');
const router = express.Router();

const User = require('../models/user.model');
const { sendPasswordResetEmail } = require('../utils/emailService');

// Endpoint para solicitar redefinição de senha
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ message: 'Email é obrigatório' });
    }
    const user = await User.findOne({ where: { email: email.toLowerCase() } });
    if (!user) {
      return res.status(404).json({ message: 'Usuário não encontrado' });
    }
    // Gera token e define validade de 1 hora
    const token = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 3600 * 1000);
    await user.update({ passwordResetToken: token, passwordResetExpires: expires });
    await sendPasswordResetEmail(email, token);
    return res.status(200).json({ message: 'Email de redefinição enviado' });
  } catch (error) {
    console.error('Erro ao solicitar redefinição de senha:', error);
    return res.status(500).json({ message: 'Erro interno ao solicitar redefinição de senha' });
  }
});

// Endpoint para redefinir a senha usando o token
router.post('/reset-password', async (req, res) => {
  try {
    const { token, password } = req.body;
    if (!token || !password) {
      return res.status(400).json({ message: 'Token e nova senha são obrigatórios' });
    }
    const user = await User.findOne({
      where: {
        passwordResetToken: token,
        passwordResetExpires: { [Op.gt]: new Date() },
      },
    });
    if (!user) {
      return res.status(400).json({ message: 'Token inválido ou expirado' });
    }
    user.password = password;
    user.passwordResetToken = null;
    user.passwordResetExpires = null;
    await user.save();
    return res.status(200).json({ message: 'Senha redefinida com sucesso' });
  } catch (error) {
    console.error('Erro ao redefinir senha:', error);
    return res.status(500).json({ message: 'Erro interno ao redefinir senha' });
  }
});

module.exports = router;