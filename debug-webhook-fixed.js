const express = require(\'express\');
const User = require(\'./models/user.model\');
const { sendWelcomeEmail } = require(\'./utils/emailService\');
require(\'dotenv\').config();

// Simular um evento de webhook do Stripe para testar a lógica
async function testWebhookLogic() {
    console.log(\'🧪 Iniciando teste da lógica do webhook...\\n\');

    // Simular dados de um evento checkout.session.completed
    const mockEvent = {
        type: \'checkout.session.completed\',
        data: {
            object: {
                customer: \'cus_test123\',
                subscription: \'sub_test123\',
                customer_details: {
                    email: \'teste@exemplo.com\',
                    name: \'Usuário Teste\'
                }
            }
        }
    };

    // Simular dados de subscription do Stripe
    const mockSubscription = {
        items: {
            data: [{
                price: {
                    id: \'price_1Rlxp7LUk7QOPN8ooQoUqbQ7\'
                }
            }]
        },
        current_period_end: Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60) // 30 dias
    };

    try {
        const session = mockEvent.data.object;
        const stripeCustomerId = session.customer;
        const stripeSubscriptionId = session.subscription;
        const customerEmail = session.customer_details.email.toLowerCase();

        console.log(`📧 Email do cliente: ${customerEmail}`);
        console.log(`🆔 Customer ID: ${stripeCustomerId}`);
        console.log(`📋 Subscription ID: ${stripeSubscriptionId}\\n`);

        // Verificar se o usuário já existe
        console.log(\'🔍 Verificando se o usuário já existe...\');
        let user = await User.findOne({ where: { email: customerEmail } });

        const userData = {
            subscriptionStatus: \'active\',
            stripeCustomerId: stripeCustomerId,
            stripeSubscriptionId: stripeSubscriptionId,
            stripePriceId: mockSubscription.items.data[0].price.id,
            stripeCurrentPeriodEnd: new Date(mockSubscription.current_period_end * 1000)
        };

        if (user) {
            console.log(`✅ Usuário existente encontrado: ${user.id}`);
            console.log(`📊 Status atual: ${user.subscriptionStatus}`);
            
            // Atualizar usuário existente
            await user.update(userData);
            console.log(`🔄 Usuário atualizado para status: ${userData.subscriptionStatus}`);
        } else {
            console.log(\'❌ Usuário não encontrado. Criando novo usuário...\');
            
            // Criar novo usuário
            const tempPassword = require(\'crypto\').randomBytes(16).toString(\'hex\');
            
            user = await User.create({
                email: customerEmail,
                name: session.customer_details.name || \'Novo Assinante\',
                password: tempPassword,
                emailVerified: true,
                ...userData
            });
            
            console.log(`✅ Novo usuário criado: ${user.id}`);
            
            // Testar envio de email de boas-vindas
            console.log(\'\\n📧 Testando envio de email de boas-vindas...\');
            try {
                await sendWelcomeEmail(customerEmail);
                console.log(`✅ Email de boas-vindas enviado para ${customerEmail}`);
            } catch (err) {
                console.error(`❌ Falha ao enviar email de boas-vindas:`, err.message);
            }
        }

        console.log(\'\\n🎉 Teste da lógica do webhook concluído com sucesso!\');
        
        // Verificar o usuário final
        const finalUser = await User.findOne({ where: { email: customerEmail } });
        console.log(\'\\n📋 Estado final do usuário:\');
        console.log(`- ID: ${finalUser.id}`);
        console.log(`- Email: ${finalUser.email}`);
        console.log(`- Nome: ${finalUser.name}`);
        console.log(`- Status: ${finalUser.subscriptionStatus}`);
        console.log(`- Stripe Customer ID: ${finalUser.stripeCustomerId}`);
        console.log(`- Email Verificado: ${finalUser.emailVerified}`);

    } catch (error) {
        console.error(\'❌ Erro durante o teste:\', error);
        console.error(\'Stack trace:\', error.stack);
    }
}

// Executar o teste
testWebhookLogic()
    .then(() => {
        console.log(\'\\n✅ Teste finalizado.\');
        process.exit(0);
    })
    .catch((error) => {
        console.error(\'\\n❌ Erro fatal:\', error);
        process.exit(1);
    });



