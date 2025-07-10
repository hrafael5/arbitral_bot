const { DataTypes } = require('sequelize');
const sequelize = require('../database'); // Precisaremos criar este arquivo depois
const bcrypt = require('bcrypt');

const User = sequelize.define('User', {
  email: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true,
    validate: {
      isEmail: true
    }
  },
  password: {
    type: DataTypes.STRING,
    allowNull: false
  },
  subscriptionStatus: {
    type: DataTypes.STRING,
    defaultValue: 'inactive' // ex: inactive, active, cancelled
  }
}, {
  hooks: {
    // Hook para criptografar a senha antes de salvar o usuário
    beforeCreate: async (user) => {
      if (user.password) {
        const salt = await bcrypt.genSalt(10);
        user.password = await bcrypt.hash(user.password, salt);
      }
    }
  }
});

// Método para validar a senha no login
User.prototype.validatePassword = async function(password) {
  return bcrypt.compare(password, this.password);
};

module.exports = User;