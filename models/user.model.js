// models/user.model.js (Revisado)

const { DataTypes } = require('sequelize');
const sequelize = require('../database');
const bcrypt = require('bcrypt');
const crypto = require('crypto'); // Importar crypto para os tokens

const User = sequelize.define('User', {
  name: {
    type: DataTypes.STRING,
    allowNull: false, // Alterado para false, pois o nome é obrigatório
    validate: {
      notEmpty: { msg: "O nome é obrigatório." },
      len: { args: [2, 100], msg: "O nome deve ter entre 2 e 100 caracteres." }
    }
  },
  email: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: { msg: "Este email já está cadastrado." },
    validate: {
      isEmail: { msg: "Por favor, insira um email válido." },
      notEmpty: { msg: "O email é obrigatório." }
    }
  },
  whatsapp: {
    type: DataTypes.STRING,
    allowNull: true,
    validate: {
      isValidWhatsApp(value) {
        if (value && !/^\+?[\d\s\-\(\)]{10,}$/.test(value.replace(/\s/g, ''))) {
          throw new Error("Por favor, insira um número de WhatsApp válido.");
        }
      }
    }
  },
  password: {
    type: DataTypes.STRING,
    allowNull: false,
    validate: {
      len: { args: [8], msg: "A senha deve ter pelo menos 8 caracteres." },
      isStrongPassword(value) {
        if (!value) throw new Error("A senha é obrigatória.");
        let score = 0;
        if (/[a-z]/.test(value)) score++;
        if (/[A-Z]/.test(value)) score++;
        if (/[0-9]/.test(value)) score++;
        if (/[^A-Za-z0-9]/.test(value)) score++;
        if (score < 3) {
          throw new Error("A senha deve conter pelo menos 3 dos seguintes: letras minúsculas, maiúsculas, números e símbolos.");
        }
      }
    }
  },
  subscriptionStatus: {
    type: DataTypes.STRING,
    defaultValue: 'free',
    validate: {
      isIn: {
        args: [['free', 'premium', 'active', 'canceled', 'incomplete']],
        msg: "Status de assinatura inválido."
      }
    }
  },
  stripeCustomerId: {
    type: DataTypes.STRING,
    allowNull: true,
    unique: true
  },
  stripeSubscriptionId: {
    type: DataTypes.STRING,
    allowNull: true,
    unique: true
  },
  stripePriceId: {
    type: DataTypes.STRING,
    allowNull: true
  },
  stripeCurrentPeriodEnd: {
    type: DataTypes.DATE,
    allowNull: true
  },
  emailVerified: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  emailVerificationToken: {
    type: DataTypes.STRING,
    allowNull: true
  },
  emailVerificationExpiry: {
    type: DataTypes.DATE,
    allowNull: true
  },
  resetToken: {
    type: DataTypes.STRING,
    allowNull: true
  },
  resetTokenExpiry: {
    type: DataTypes.DATE,
    allowNull: true
  },
  lastLoginAt: {
    type: DataTypes.DATE,
    allowNull: true
  },
  loginAttempts: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  lockedUntil: {
    type: DataTypes.DATE,
    allowNull: true
  }
}, {
  hooks: {
    beforeCreate: async (user) => {
      if (user.password) {
        const salt = await bcrypt.genSalt(12);
        user.password = await bcrypt.hash(user.password, salt);
      }
    },
    beforeUpdate: async (user) => {
      if (user.changed('password')) {
        const salt = await bcrypt.genSalt(12);
        user.password = await bcrypt.hash(user.password, salt);
      }
    }
  },
  indexes: [{ unique: true, fields: ['email'] }]
});

// --- MÉTODOS DE INSTÂNCIA APRIMORADOS ---

User.prototype.validatePassword = function(password) {
  return bcrypt.compare(password, this.password);
};

User.prototype.isLocked = function() {
  return !!(this.lockedUntil && this.lockedUntil > new Date());
};

User.prototype.incrementLoginAttempts = async function() {
  const MAX_ATTEMPTS = 5;
  const LOCK_TIME_MINUTES = 15;

  let newAttempts = this.loginAttempts + 1;
  const updates = { loginAttempts: newAttempts };

  if (newAttempts >= MAX_ATTEMPTS) {
    updates.lockedUntil = new Date(Date.now() + LOCK_TIME_MINUTES * 60 * 1000);
    console.log(`Usuário ${this.email} bloqueado por ${LOCK_TIME_MINUTES} minutos.`);
  }
  
  return this.update(updates);
};

User.prototype.resetLoginAttempts = function() {
  return this.update({
    loginAttempts: 0,
    lockedUntil: null,
    lastLoginAt: new Date()
  });
};

/**
 * Gera um token, salva a versão hasheada no banco e retorna o token original.
 * @returns {string} O token não hasheado para ser enviado por e-mail.
 */
User.prototype.generateEmailVerificationToken = function() {
  const token = crypto.randomBytes(32).toString('hex');
  
  this.emailVerificationToken = crypto
    .createHash('sha256')
    .update(token)
    .digest('hex');
    
  this.emailVerificationExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 horas
  
  return token; // Retorna o token original para ser enviado
};

User.prototype.generatePasswordResetToken = function() {
  const token = crypto.randomBytes(32).toString('hex');

  this.resetToken = crypto
    .createHash('sha256')
    .update(token)
    .digest('hex');

  this.resetTokenExpiry = new Date(Date.now() + 60 * 60 * 1000); // 1 hora

  return token;
};

module.exports = User;