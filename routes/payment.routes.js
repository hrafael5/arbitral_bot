const express = require('express');
const router = express.Router();
const User = require('../models/user.model');
require('dotenv').config();
const { sendWelcomeEmail } = require('../utils/emailService');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// ROTA 1 – CRIA A SESSÃO DE CHECKOUT
router.post('/create-checkout-session', async (req, res) => {
    try {
        const priceId = 'price_1Rlxp7LUk7QOPN8ooQoUqbQ7';

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

        if (req.session && req.session.userId) {
            const user = await User.findByPk(req.session.userId);
            if (user) {
                sessionPayload.customer_email = user.email;
                sessionPayload.metadata.userId = user.id;
                sessionPayload.client_reference_id = user.id.toString();
            }
        }

        const session = await stripe.checkout.sessions.create(sessionPayload);
        res.json({ sessionId: session.id });

    } catch (error) {
        console.error("Erro ao criar sessão de checkout:", error);
        res.status(500).json({ message: 'Erro ao iniciar o pagamento.' });
    }
});

// ROTA 2 – RECEBE OS WEBHOOKS DO STRIPE
router.post('/stripe-webhook', express.raw({ type: 'application/json' }), async (req, res) => {
    const sig = req.headers['stripe-signature'];
    let event;

    try {
        event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    } catch (err) {
        console.error(`⚠️ Erro de verificação do webhook: ${err.message}`);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    switch (event.type) {
        case 'checkout.session.completed': {
            const session = event.data.object;
            const stripeCustomerId = session.customer;
            const stripeSubscriptionId = session.subscription;
            const customerEmail = session.customer_details.email.toLowerCase();
            const subscription = await stripe.subscriptions.retrieve(stripeSubscriptionId);

            const userData = {
                subscriptionStatus: 'active',
                stripeCustomerId,
                stripeSubscriptionId,
                stripePriceId: subscription.items.data[0].price.id,
                stripeCurrentPeriodEnd: new Date(subscription.current_period_end * 1000)
            };

            let user = await User.findOne({ where: { email: customerEmail } });

            if (user) {
                await user.update(userData);
                console.log(`✅ Assinatura ativada para usuário existente (${user.email})`);

                // Envia e-mail mesmo que o usuário já exista
                try {
                    await sendWelcomeEmail(customerEmail);
                    console.log(`📧 E-mail de boas-vindas reenviado para ${customerEmail}`);
                } catch (err) {
                    console.error(`Erro ao enviar e-mail de boas-vindas para usuário existente:`, err);
                }

            } else {
                const tempPassword = require('crypto').randomBytes(16).toString('hex');

                user = await User.create({
                    email: customerEmail,
                    name: session.customer_details.name || 'Novo Assinante',
                    password: tempPassword,
                    emailVerified: true,
                    ...userData
                });

                console.log(`✅ Novo usuário criado: ${user.email}`);

                try {
                    await sendWelcomeEmail(customerEmail);
                    console.log(`📧 E-mail de boas-vindas enviado para novo usuário ${customerEmail}`);
                } catch (err) {
                    console.error(`Erro ao enviar e-mail de boas-vindas:`, err);
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
                where: { stripeCustomerId }
            });

            console.log(`🔁 Assinatura atualizada: ${stripeCustomerId} (${subscription.status})`);
            break;
        }

        case 'customer.subscription.deleted': {
            const subscription = event.data.object;
            const stripeCustomerId = subscription.customer;

            await User.update({
                subscriptionStatus: 'canceled',
                stripeSubscriptionId: null
            }, {
                where: { stripeCustomerId }
            });

            console.log(`🚫 Assinatura cancelada: ${stripeCustomerId}`);
            break;
        }

        default:
            console.log(`📌 Evento não tratado: ${event.type}`);
    }

    res.status(200).json({ received: true });
});

module.exports = router;
