const express = require("express");
const router = express.Router();
const User = require("../models/user.model");
require("dotenv").config();

// Serviços de email
const { sendWelcomeEmail, sendPremiumUpgradeEmail } = require("../utils/emailService");

// Inicializar o Stripe com a sua chave secreta do .env
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

// Função para gerar senha temporária que atende aos critérios de validação
function generateStrongTempPassword() {
    const lowercase = "abcdefghijklmnopqrstuvwxyz";
    const uppercase = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    const numbers = "0123456789";
    const symbols = "!@#$%&*";
    
    let password = "";
    password += lowercase[Math.floor(Math.random() * lowercase.length)];
    password += uppercase[Math.floor(Math.random() * uppercase.length)];
    password += numbers[Math.floor(Math.random() * numbers.length)];
    password += symbols[Math.floor(Math.random() * symbols.length)];
    
    const allChars = lowercase + uppercase + numbers + symbols;
    for (let i = 4; i < 12; i++) {
        password += allChars[Math.floor(Math.random() * allChars.length)];
    }
    
    return password.split("").sort(() => Math.random() - 0.5).join("");
}

// Função para converter timestamp do Stripe para data válida
function convertStripeTimestamp(timestamp) {
    try {
        if (!timestamp || isNaN(timestamp)) {
            // Retorna data padrão de 30 dias a partir de agora em caso de erro
            return new Date(Date.now() + (30 * 24 * 60 * 60 * 1000));
        }
        const date = new Date(timestamp * 1000);
        if (isNaN(date.getTime())) {
            return new Date(Date.now() + (30 * 24 * 60 * 60 * 1000));
        }
        return date;
    } catch (error) {
        console.error(`❌ Erro ao converter timestamp ${timestamp}:`, error);
        return new Date(Date.now() + (30 * 24 * 60 * 60 * 1000));
    }
}

// ROTA 1: CRIAR A SESSÃO DE CHECKOUT
router.post("/create-checkout-session", async (req, res) => {
    try {
        const priceId = process.env.STRIPE_PRICE_ID; // Usar variável de ambiente para o ID do preço

        const sessionPayload = {
            payment_method_types: ["card"],
            mode: "subscription",
            line_items: [{ price: priceId, quantity: 1 }],
            success_url: `${process.env.APP_BASE_URL || "https://app.arbflash.com"}?payment_success=true`,
            cancel_url: `${process.env.APP_BASE_URL || "https://app.arbflash.com"}?payment_canceled=true`,
            metadata: {}
        };

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
        res.status(500).json({ message: "Erro ao iniciar o pagamento." });
    }
});


// ROTA 2: RECEBER OS WEBHOOKS DO STRIPE
router.post("/stripe-webhook", express.raw({ type: "application/json" }), async (req, res) => {
    const sig = req.headers["stripe-signature"];
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    let event;

    try {
        event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
    } catch (err) {
        console.error(`⚠️  Erro na verificação do webhook: ${err.message}`);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    console.log(`🔔 Webhook recebido: ${event.type}`);

    // Lidar com o evento
    switch (event.type) {
        case "checkout.session.completed": {
            const session = event.data.object;
            const stripeCustomerId = session.customer;
            const stripeSubscriptionId = session.subscription;
            
            const customerEmail = session.customer_details.email.toLowerCase();
            const customerName = session.customer_details.name || "Novo Assinante";
            
            try {
                const subscription = await stripe.subscriptions.retrieve(stripeSubscriptionId);
                let user = await User.findOne({ where: { email: customerEmail } });
                const periodEndDate = convertStripeTimestamp(subscription.current_period_end);

                const userData = {
                    subscriptionStatus: "active",
                    stripeCustomerId: stripeCustomerId,
                    stripeSubscriptionId: stripeSubscriptionId,
                    stripePriceId: subscription.items.data[0].price.id,
                    stripeCurrentPeriodEnd: periodEndDate
                };

                if (user) {
                    await user.update(userData);
                    console.log(`✅ Assinatura ativada para o utilizador existente: ${user.id}`);
                    try {
                        await sendPremiumUpgradeEmail(user.email, user.name);
                        console.log(`🎉 E-mail de upgrade premium enviado para: ${user.email}`);
                    } catch (err) {
                        console.error(`❌ Falha ao enviar e-mail de upgrade para ${user.email}:`, err);
                    }
                } else {
                    const tempPassword = generateStrongTempPassword();
                    user = await User.create({
                        email: customerEmail,
                        name: customerName,
                        password: tempPassword,
                        emailVerified: true,
                        ...userData
                    });
                    console.log(`✅ Novo utilizador premium criado: ${user.id}`);
                    try {
                        await sendWelcomeEmail(customerEmail);
                        console.log(`📧 E-mail de boas‑vindas premium enviado para ${customerEmail}`);
                    } catch (err) {
                        console.error(`❌ Falha ao enviar email de boas‑vindas premium para ${customerEmail}:`, err);
                    }
                }
            } catch (error) {
                console.error(`❌ Erro ao processar checkout.session.completed:`, error);
                return res.status(500).send(`Erro interno: ${error.message}`);
            }
            break;
        }

        case "customer.subscription.updated":
        case "customer.subscription.deleted": {
            const subscription = event.data.object;
            const stripeCustomerId = subscription.customer;

            // LÓGICA DE DOWNGRADE AUTOMÁTICO
            let newStatus = "free"; // Padrão é reverter para "free"
            if (subscription.status === "active" || subscription.status === "trialing") {
                newStatus = "active"; // Apenas "active" ou "trialing" são considerados premium
            }

            console.log(`🔄 Assinatura atualizada para o cliente ${stripeCustomerId}. Status no Stripe: ${subscription.status}. Status no sistema será: ${newStatus}.`);

            try {
                await User.update({
                    subscriptionStatus: newStatus,
                    stripePriceId: subscription.items.data[0]?.price.id,
                    stripeCurrentPeriodEnd: convertStripeTimestamp(subscription.current_period_end)
                }, {
                    where: { stripeCustomerId: stripeCustomerId }
                });
            } catch (error) {
                console.error(`❌ Erro ao atualizar/deletar assinatura:`, error);
            }
            break;
        }

        default:
            console.log(`ℹ️  Evento de webhook não tratado: ${event.type}`);
    }

    res.status(200).json({ received: true });
});

module.exports = router;

