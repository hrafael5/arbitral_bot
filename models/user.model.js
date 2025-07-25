const { DataTypes } = require('sequelize');
const sequelize = require('../database');
const bcrypt = require('bcrypt');

const User = sequelize.define('User', {
  name: {
    type: DataTypes.STRING,
    allowNull: true,
    defaultValue: 'Usuário',
    validate: {
      notEmpty: {
        msg: "O nome é obrigatório."
      },
      len: {
        args: [2, 100],
        msg: "O nome deve ter entre 2 e 100 caracteres."
      }
    }
  },
  email: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: {
      msg: "Este email já está cadastrado."
    },
    validate: {
      isEmail: {
        msg: "Por favor, insira um email válido."
      },
      notEmpty: {
        msg: "O email é obrigatório."
      }
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
      isStrongPassword(value) {
        if (!value) {
          throw new Error("A senha é obrigatória.");
        }
        
        if (value.length < 8) {
          throw new Error("A senha deve ter pelo menos 8 caracteres.");
        }
        
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
        args: [['free', 'premium', 'active', 'canceled', 'incomplete']], // Adicionado mais status
        msg: "Status de assinatura inválido."
      }
    }
  },
  
  // --- CAMPOS ADICIONADOS PARA A INTEGRAÇÃO COM O STRIPE ---
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
  // --- FIM DOS CAMPOS ADICIONADOS ---

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
    // Hook para criptografar a senha antes de salvar o usuário
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
  indexes: [
    {
      unique: true,
      fields: ['email']
    },
    {
      fields: ['emailVerificationToken']
    },
    {
      fields: ['resetToken']
    }
  ]
});

// Método para validar a senha no login
User.prototype.validatePassword = async function(password) {
  return bcrypt.compare(password, this.password);
};

// Método para verificar se a conta está bloqueada
User.prototype.isLocked = function() {
  return !!(this.lockedUntil && this.lockedUntil > Date.now());
};

// Método para incrementar tentativas de login
User.prototype.incrementLoginAttempts = async function() {
  if (this.lockedUntil && this.lockedUntil < Date.now()) {
    return this.update({
      loginAttempts: 1,
      lockedUntil: null
    });
  }
  
  const updates = { loginAttempts: this.loginAttempts + 1 };
  
  if (this.loginAttempts + 1 >= 5 && !this.isLocked()) {
    updates.lockedUntil = Date.now() + 30 * 60 * 1000; // 30 minutos
  }
  
  return this.update(updates);
};

// Método para resetar tentativas de login após login bem-sucedido
User.prototype.resetLoginAttempts = async function() {
  return this.update({
    loginAttempts: 0,
    lockedUntil: null,
    lastLoginAt: new Date()
  });
};

// Método para gerar token de verificação de email
User.prototype.generateEmailVerificationToken = function() {
  const crypto = require('crypto');
  const token = crypto.randomBytes(32).toString('hex');
  
  this.emailVerificationToken = token;
  this.emailVerificationExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 horas
  
  return token;
};

// Método para verificar se o token de verificação de email é válido
User.prototype.isEmailVerificationTokenValid = function(token) {
  return this.emailVerificationToken === token && 
         this.emailVerificationExpiry && 
         this.emailVerificationExpiry > new Date();
};

module.exports = User;