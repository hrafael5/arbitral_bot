const express = require('express');
const router = express.Router();
const User = require('../models/user.model'); // Aceder ao nosso modelo de utilizador
require('dotenv').config();

// Serviço de email para envio de boas‑vindas aos novos assinantes.
// Este módulo precisa estar disponível em utils/emailService.js conforme sugerido.
const { sendWelcomeEmail } = require('../utils/emailService');

// Inicializar o Stripe com a sua chave secreta do .env
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// ROTA 1: CRIAR A SESSÃO DE CHECKOUT (Permite utilizadores não logados)
router.post('/create-checkout-session', async (req, res) => {
    try {
        const priceId = 'price_1Rlxp7LUk7QOPN8ooQoUqbQ7'; // O seu ID de preço

        const sessionPayload = {
            payment_method_types: ['card'],
            mode: 'subscription',
            line_items: [{
                price: priceId,
                quantity: 1,
            }],
            success_url: `${process.env.APP_BASE_URL || 'https://app.arbflash.com'}?payment_success=true`,
            cancel_url: `${process.env.APP_BASE_URL || 'https://app.arbflash.com'}?payment_canceled=true`,
            metadata: {}
        };

        // Se o utilizador JÁ ESTIVER LOGADO, pré-preenchemos o email e guardamos o ID dele
        if (req.session && req.session.userId) {
            const user = await User.findByPk(req.session.userId);
            if (user) {
                sessionPayload.customer_email = user.email;
                sessionPayload.metadata.userId = req.session.userId;
            }
        }

        const session = await stripe.checkout.sessions.create(sessionPayload);

        res.json({ sessionId: session.id });

    } catch (error) {
        console.error("Erro ao criar sessão de checkout:", error);
        res.status(500).json({ message: 'Erro ao iniciar o pagamento.' });
    }
});


// ROTA 2: RECEBER OS WEBHOOKS DO STRIPE (Cria ou atualiza utilizador)
router.post('/stripe-webhook', express.raw({ type: 'application/json' }), async (req, res) => {
    const sig = req.headers['stripe-signature'];
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

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
            const stripeCustomerId = session.customer;
            const stripeSubscriptionId = session.subscription;
            
            // O email que o cliente digitou no checkout do Stripe
            const customerEmail = session.customer_details.email.toLowerCase();
            
            const subscription = await stripe.subscriptions.retrieve(stripeSubscriptionId);

            // Verificar se o utilizador já existe na nossa base de dados
            let user = await User.findOne({ where: { email: customerEmail } });

            const userData = {
                subscriptionStatus: 'active',
                stripeCustomerId: stripeCustomerId,
                stripeSubscriptionId: stripeSubscriptionId,
                stripePriceId: subscription.items.data[0].price.id,
                stripeCurrentPeriodEnd: new Date(subscription.current_period_end * 1000)
            };

            if (user) {
                // Se o utilizador já existe, apenas atualizamos os seus dados de assinatura
                await user.update(userData);
                console.log(`✅ Assinatura ativada para o utilizador existente: ${user.id}`);
            } else {
                // Se o utilizador não existe, criamos uma nova conta para ele
                const tempPassword = require('crypto').randomBytes(16).toString('hex');

                user = await User.create({
                    email: customerEmail,
                    name: session.customer_details.name || 'Novo Assinante',
                    password: tempPassword, // O hook do modelo irá encriptar
                    emailVerified: true, // Consideramos o email verificado, pois ele pagou
                    ...userData
                });
                
                console.log(`✅ Novo utilizador criado a partir do pagamento: ${user.id}`);
                
                // Enviar email de boas‑vindas para o novo utilizador com link para definir a sua senha.
                try {
                    await sendWelcomeEmail(customerEmail);
                    console.log(`📧 Email de boas‑vindas enviado para ${customerEmail}`);
                } catch (err) {
                    console.error(`Falha ao enviar email de boas‑vindas para ${customerEmail}:`, err);
                }
            }
            break;
        }

        case 'customer.subscription.updated': {
            const subscription = event.data.object;
            const stripeCustomerId = subscription.customer;

            await User.update({
                subscriptionStatus: subscription.status,
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

            await User.update({
                subscriptionStatus: 'canceled',
                stripeSubscriptionId: null,
            }, {
                where: { stripeCustomerId: stripeCustomerId }
            });

            console.log(`🚫 Assinatura cancelada para o cliente ${stripeCustomerId}.`);
            break;
        }

        default:
            console.log(`Evento de webhook não tratado: ${event.type}`);
    }

    res.status(200).json({ received: true });
});

module.exports = router;