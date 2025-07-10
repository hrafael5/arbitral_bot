const express = require('express');
const router = express.Router();
const User = require('../models/user.model');
const UserConfiguration = require('../models/userConfiguration.model');

// Rota de Cadastro (Register)
router.post('/register', async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) return res.status(400).send("Email e senha são obrigatórios.");
        
        const existingUser = await User.findOne({ where: { email } });
        if (existingUser) return res.status(400).send("Este email já está em uso.");

        const newUser = await User.create({ email, password });
        await UserConfiguration.create({ UserId: newUser.id });

        req.session.userId = newUser.id;
        res.status(201).json({ message: "Usuário criado com sucesso!" });
    } catch (error) {
        console.error("Erro no cadastro:", error);
        res.status(500).send("Erro interno ao criar o usuário.");
    }
});

// Rota de Login
router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) return res.status(400).send("Email e senha são obrigatórios.");

        const user = await User.findOne({ where: { email } });
        if (!user) return res.status(401).send("Email ou senha inválidos.");

        const isValid = await user.validatePassword(password);
        if (!isValid) return res.status(401).send("Email ou senha inválidos.");

        req.session.userId = user.id;
        res.status(200).json({ message: "Login bem-sucedido!" });
    } catch (error) {
        console.error("Erro no login:", error);
        res.status(500).send("Erro interno no servidor.");
    }
});

// Rota de Logout
router.post('/logout', (req, res) => {
    req.session.destroy(err => {
        if (err) return res.status(500).send("Não foi possível fazer logout.");
        res.clearCookie('connect.sid');
        res.status(200).send("Logout bem-sucedido.");
    });
});

// Rota para BUSCAR as configurações do usuário
router.get('/settings', async (req, res) => {
    if (!req.session.userId) return res.status(401).send("Usuário não autenticado.");
    try {
        const config = await UserConfiguration.findOne({ where: { UserId: req.session.userId } });
        if (!config) return res.status(404).send("Configurações não encontradas.");
        res.json(config);
    } catch (error) {
        res.status(500).send("Erro ao buscar configurações.");
    }
});

// Rota para SALVAR as configurações do usuário (MODIFICADA)
router.post('/settings', async (req, res) => {
    if (!req.session.userId) return res.status(401).send("Usuário não autenticado.");
    
    try {
        const fieldsToUpdate = {};
        // Construímos um objeto apenas com os campos que foram enviados pelo frontend
        // para não apagar os outros campos existentes no banco de dados.
        if (req.body.mexcApiKey !== undefined) fieldsToUpdate.mexcApiKey = req.body.mexcApiKey;
        if (req.body.mexcApiSecret !== undefined) fieldsToUpdate.mexcApiSecret = req.body.mexcApiSecret;
        if (req.body.gateioApiKey !== undefined) fieldsToUpdate.gateioApiKey = req.body.gateioApiKey;
        if (req.body.gateioApiSecret !== undefined) fieldsToUpdate.gateioApiSecret = req.body.gateioApiSecret;
        if (req.body.minProfitPercentage !== undefined) fieldsToUpdate.minProfitPercentage = req.body.minProfitPercentage;
        if (req.body.watchedPairs !== undefined) fieldsToUpdate.watchedPairs = req.body.watchedPairs;

        // Se nenhum campo válido foi enviado, não faz nada
        if (Object.keys(fieldsToUpdate).length === 0) {
            return res.status(400).send("Nenhum dado de configuração válido para atualizar.");
        }

        await UserConfiguration.update(fieldsToUpdate, {
            where: { UserId: req.session.userId }
        });

        res.status(200).send("Configurações salvas com sucesso!");

    } catch (error) {
        console.error("Erro ao salvar configurações:", error);
        res.status(500).send("Erro ao salvar configurações.");
    }
});

module.exports = router;