const express = require('express');
const router = express.Router();
const User = require('../models/user.model'); // Aceder ao nosso modelo de utilizador
require('dotenv').config();

// Inicializar o Stripe com a sua chave secreta do .env
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// Middleware para garantir que o utilizador está autenticado
const isAuthenticated = (req, res, next) => {
    if (req.session && req.session.userId) {
        return next();
    }
    res.status(401).json({ message: "Utilizador não autenticado." });
};

// ROTA 1: CRIAR A SESSÃO DE CHECKOUT
router.post('/create-checkout-session', isAuthenticated, async (req, res) => {
    try {
        const userId = req.session.userId;
        const user = await User.findByPk(userId);

        if (!user) {
            return res.status(404).json({ message: 'Utilizador não encontrado.' });
        }

        // --- ID do seu Preço do Stripe ---
        const priceId = 'price_1Rlxp7LUk7QOPN8ooQoUqbQ7'; // O seu ID foi inserido aqui

        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            mode: 'subscription',
            customer_email: user.email, // Preenche o email do cliente automaticamente
            line_items: [{
                price: priceId,
                quantity: 1,
            }],
            // URL para onde o utilizador será redirecionado após o sucesso ou cancelamento
            success_url: `${process.env.APP_BASE_URL || 'https://app.arbflash.com'}?payment_success=true`,
            cancel_url: `${process.env.APP_BASE_URL || 'https://app.arbflash.com'}?payment_canceled=true`,
            // Guarda o ID do utilizador da sua base de dados para sabermos quem pagou
            metadata: {
                userId: userId
            }
        });

        res.json({ sessionId: session.id });

    } catch (error) {
        console.error("Erro ao criar sessão de checkout:", error);
        res.status(500).json({ message: 'Erro ao iniciar o pagamento.' });
    }
});


// ROTA 2: RECEBER OS WEBHOOKS DO STRIPE
// Esta rota é chamada pelo SERVIDOR do Stripe, não pelo seu site.
router.post('/stripe-webhook', express.raw({ type: 'application/json' }), async (req, res) => {
    // A assinatura do webhook é usada para verificar se o pedido veio mesmo do Stripe
    const sig = req.headers['stripe-signature'];
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET; // Crie esta variável no .env

    let event;

    try {
        event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
    } catch (err) {
        console.error(`⚠️  Erro na verificação do webhook: ${err.message}`);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    // Lidar com o evento
    switch (event.type) {
        case 'checkout.session.completed': {
            const session = event.data.object;
            const userId = session.metadata.userId;
            const stripeCustomerId = session.customer;
            const stripeSubscriptionId = session.subscription;
            
            // Buscar o período final da assinatura
            const subscription = await stripe.subscriptions.retrieve(stripeSubscriptionId);

            // Atualizar o utilizador na nossa base de dados
            await User.update({
                subscriptionStatus: 'active',
                stripeCustomerId: stripeCustomerId,
                stripeSubscriptionId: stripeSubscriptionId,
                stripePriceId: subscription.items.data[0].price.id,
                stripeCurrentPeriodEnd: new Date(subscription.current_period_end * 1000)
            }, {
                where: { id: userId }
            });

            console.log(`✅ Pagamento bem-sucedido para o utilizador ${userId}. Status atualizado para 'active'.`);
            break;
        }

        case 'customer.subscription.updated': {
            const subscription = event.data.object;
            const stripeCustomerId = subscription.customer;

            // Atualizar o status e a data de renovação
            await User.update({
                subscriptionStatus: subscription.status, // ex: 'active', 'past_due'
                stripePriceId: subscription.items.data[0].price.id,
                stripeCurrentPeriodEnd: new Date(subscription.current_period_end * 1000)
            }, {
                where: { stripeCustomerId: stripeCustomerId }
            });
            
            console.log(`🔄 Assinatura atualizada para o cliente ${stripeCustomerId}. Novo status: ${subscription.status}.`);
            break;
        }
        
        case 'customer.subscription.deleted': {
            const subscription = event.data.object;
            const stripeCustomerId = subscription.customer;

            // Mudar o status para 'canceled' ou 'free'
            await User.update({
                subscriptionStatus: 'canceled', // ou 'free'
                stripeSubscriptionId: null, // Limpa o ID da assinatura
                // Não limpe o stripePriceId ou stripeCurrentPeriodEnd, pode ser útil para histórico
            }, {
                where: { stripeCustomerId: stripeCustomerId }
            });

            console.log(`🚫 Assinatura cancelada para o cliente ${stripeCustomerId}.`);
            break;
        }

        default:
            console.log(`Evento de webhook não tratado: ${event.type}`);
    }

    // Responder ao Stripe para confirmar o recebimento
    res.status(200).json({ received: true });
});

module.exports = router;