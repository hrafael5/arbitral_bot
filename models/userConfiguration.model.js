const { DataTypes } = require('sequelize');
const sequelize = require('../database');

const UserConfiguration = sequelize.define('UserConfiguration', {
  // --- Configurações Críticas ---
  mexcApiKey: {
    type: DataTypes.STRING,
    allowNull: true
  },
  mexcApiSecret: {
    type: DataTypes.STRING, // Lembre-se de criptografar em produção
    allowNull: true
  },
  gateioApiKey: {
    type: DataTypes.STRING,
    allowNull: true
  },
  gateioApiSecret: {
    type: DataTypes.STRING, // Lembre-se de criptografar em produção
    allowNull: true
  },

  // --- Preferências de Arbitragem ---
  minProfitPercentage: {
    type: DataTypes.FLOAT,
    defaultValue: 0.5
  },
  
  // --- ADICIONADO: Pares em Vigilância ---
  // Armazenamos a lista como um texto no formato JSON
  watchedPairs: {
    type: DataTypes.TEXT,
    defaultValue: '[]', // Padrão é uma lista vazia
    get() {
      const rawValue = this.getDataValue('watchedPairs');
      // Garante que o valor retornado seja sempre um array
      try {
        const parsed = JSON.parse(rawValue || '[]');
        return Array.isArray(parsed) ? parsed : [];
      } catch (e) {
        return [];
      }
    },
    set(value) {
      // Garante que estamos salvando um string JSON de um array
      this.setDataValue('watchedPairs', JSON.stringify(Array.isArray(value) ? value : []));
    }
  },

  // --- ADICIONADO (para o futuro): Filtros e Preferências da UI ---
  // Usamos o tipo JSONB que é perfeito para guardar objetos de configuração
  uiFilters: {
    type: DataTypes.JSONB,
    defaultValue: {
      mexcSpot: true,
      mexcFutures: true,
      gateioSpot: true,
      gateioFutures: true,
      minVolume: 0
    }
  },
  
  soundPreferences: {
    type: DataTypes.JSONB,
    defaultValue: {
      soundEnabled: false,
      soundProfitThreshold: 0.5
    }
  }
});

module.exports = UserConfiguration;