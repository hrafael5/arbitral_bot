const { Sequelize } = require('sequelize');
require('dotenv').config(); // Carrega as variáveis do arquivo .env

// Validação para garantir que a URL do banco foi definida no .env
if (!process.env.DATABASE_URL) {
  throw new Error("A variável de ambiente DATABASE_URL não foi definida no arquivo .env");
}

const sequelize = new Sequelize(process.env.DATABASE_URL, {
  dialect: 'postgres',
  protocol: 'postgres',
  dialectOptions: {
    // Esta configuração é geralmente necessária para conectar a bancos na nuvem como o Render
    ssl: {
      require: true,
      rejectUnauthorized: false
    }
  },
  logging: false, // Desativa os logs de SQL no console para não poluir
  // --- NOVO CÓDIGO AQUI: CONFIGURAÇÃO DO POOL DE CONEXÕES ---
  pool: {
    max: 20,    // Aumenta o número máximo de conexões no pool
    min: 0,     // Conexões mínimas no pool
    acquire: 60000, // Aumenta o tempo limite para adquirir uma conexão (60 segundos)
    idle: 10000     // Tempo de inatividade antes de fechar a conexão (10 segundos)
  }
  // --- FIM DO NOVO CÓDIGO ---
});

module.exports = sequelize;