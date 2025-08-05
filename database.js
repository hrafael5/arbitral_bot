const { Sequelize } = require("sequelize");
require("dotenv").config(); // Carrega as variáveis do arquivo .env

// Validação para garantir que a URL do banco foi definida no .env
if (!process.env.DATABASE_URL) {
  throw new Error("A variável de ambiente DATABASE_URL não foi definida no arquivo .env");
}

const sequelize = new Sequelize(process.env.DATABASE_URL, {
  dialect: "postgres",
  protocol: "postgres",
  dialectOptions: {
    // Esta configuração é geralmente necessária para conectar a bancos na nuvem como o Render
    ssl: {
      require: true,
      rejectUnauthorized: false
    }
  },
  logging: false // Desativa os logs de SQL no console para não poluir
});

module.exports = sequelize;


