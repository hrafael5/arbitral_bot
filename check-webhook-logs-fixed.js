const express = require(\'express\');
const User = require(\'./models/user.model\');
require(\'dotenv\').config();

// Script para verificar o estado atual dos usuários e logs
async function checkWebhookStatus() {
    console.log(\'🔍 Verificando estado atual dos usuários e configurações...\\n\');

    try {
        // Verificar configurações do ambiente
        console.log(\'⚙️ Configurações do ambiente:\');
        console.log(`- STRIPE_SECRET_KEY: ${process.env.STRIPE_SECRET_KEY ? \'✅ Configurada\' : \'❌ Não configurada\'}`);
        console.log(`- STRIPE_WEBHOOK_SECRET: ${process.env.STRIPE_WEBHOOK_SECRET ? \'✅ Configurada\' : \'❌ Não configurada\'}`);
        console.log(`- APP_BASE_URL: ${process.env.APP_BASE_URL || \'Não configurada\'}`);
        console.log(`- SMTP_HOST: ${process.env.SMTP_HOST || \'Não configurado\'}`);
        console.log(`- SMTP_USER: ${process.env.SMTP_USER || \'Não configurado\'}\\n`);

        // Listar todos os usuários
        console.log(\'👥 Usuários existentes no banco de dados:\');
        const users = await User.findAll({
            attributes: [\'id\', \'email\', \'name\', \'subscriptionStatus\', \'stripeCustomerId\', \'emailVerified\', \'createdAt\'],
            order: [[\'createdAt\', \'DESC\']]
        });

        if (users.length === 0) {
            console.log(\'❌ Nenhum usuário encontrado no banco de dados.\\n\');
        } else {
            users.forEach((user, index) => {
                console.log(`${index + 1}. ID: ${user.id}`);
                console.log(`   Email: ${user.email}`);
                console.log(`   Nome: ${user.name || \'Não informado\'}`);
                console.log(`   Status: ${user.subscriptionStatus || \'free\'}`);
                console.log(`   Stripe Customer ID: ${user.stripeCustomerId || \'Não vinculado\'}`);
                console.log(`   Email Verificado: ${user.emailVerified ? \'Sim\' : \'Não\'}`);
                console.log(`   Criado em: ${user.createdAt}`);
                console.log(\'\');
            });
        }

        // Verificar usuários com status premium
        const premiumUsers = await User.findAll({
            where: { subscriptionStatus: \'active\' }
        });

        console.log(`💎 Usuários premium: ${premiumUsers.length}`);
        if (premiumUsers.length > 0) {
            premiumUsers.forEach(user => {
                console.log(`- ${user.email} (ID: ${user.id})`);
            });
        }
        console.log(\'\');

        // Verificar usuários criados recentemente (últimas 24 horas)
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);

        const recentUsers = await User.findAll({
            where: {
                createdAt: {
                    [require(\'sequelize\').Op.gte]: yesterday
                }
            },
            order: [[\'createdAt\', \'DESC\']]
        });

        console.log(`🆕 Usuários criados nas últimas 24 horas: ${recentUsers.length}`);
        if (recentUsers.length > 0) {
            recentUsers.forEach(user => {
                console.log(`- ${user.email} (Status: ${user.subscriptionStatus || \'free\'}) - ${user.createdAt}`);
            });
        }

    } catch (error) {
        console.error(\'❌ Erro ao verificar status:\', error);
        console.error(\'Stack trace:\', error.stack);
    }
}

// Executar a verificação
checkWebhookStatus()
    .then(() => {
        console.log(\'\\n✅ Verificação finalizada.\');
        process.exit(0);
    })
    .catch((error) => {
        console.error(\'\\n❌ Erro fatal:\', error);
        process.exit(1);
    });



