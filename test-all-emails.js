require('dotenv').config();
const { 
  sendFreeWelcomeEmail, 
  sendPremiumUpgradeEmail, 
  sendWelcomeEmail, 
  sendPasswordResetEmail 
} = require('./utils/emailService');

async function testAllEmails() {
  console.log('🧪 Iniciando teste de todos os tipos de e-mail...\n');

  const testEmail = process.env.SMTP_USER || 'teste@exemplo.com';
  const testName = 'Usuário Teste';

  try {
    // Teste 1: E-mail de boas-vindas para cadastro free
    console.log('📧 Teste 1: E-mail de boas-vindas (cadastro free)');
    console.log(`📤 Enviando para: ${testEmail}`);
    await sendFreeWelcomeEmail(testEmail, testName);
    console.log('✅ E-mail de boas-vindas (free) enviado com sucesso!\n');

    // Aguardar um pouco entre os envios
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Teste 2: E-mail de parabéns por upgrade premium
    console.log('📧 Teste 2: E-mail de parabéns (upgrade premium)');
    console.log(`📤 Enviando para: ${testEmail}`);
    await sendPremiumUpgradeEmail(testEmail, testName);
    console.log('✅ E-mail de parabéns (upgrade premium) enviado com sucesso!\n');

    // Aguardar um pouco entre os envios
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Teste 3: E-mail de boas-vindas premium (usuário novo que comprou)
    console.log('📧 Teste 3: E-mail de boas-vindas premium (usuário novo)');
    console.log(`📤 Enviando para: ${testEmail}`);
    await sendWelcomeEmail(testEmail);
    console.log('✅ E-mail de boas-vindas premium enviado com sucesso!\n');

    // Aguardar um pouco entre os envios
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Teste 4: E-mail de redefinição de senha
    console.log('📧 Teste 4: E-mail de redefinição de senha');
    console.log(`📤 Enviando para: ${testEmail}`);
    const testToken = 'abc123def456ghi789jkl012mno345pqr678stu901vwx234yz';
    await sendPasswordResetEmail(testEmail, testToken);
    console.log('✅ E-mail de redefinição de senha enviado com sucesso!\n');

    console.log('🎉 Todos os testes de e-mail foram executados com sucesso!');
    console.log(`📧 Verifique a caixa de entrada de ${testEmail} para confirmar o recebimento.`);
    console.log('\n📋 Resumo dos e-mails enviados:');
    console.log('1. ✅ Boas-vindas (cadastro free)');
    console.log('2. ✅ Parabéns (upgrade premium)');
    console.log('3. ✅ Boas-vindas premium (usuário novo)');
    console.log('4. ✅ Redefinição de senha');

  } catch (error) {
    console.error('❌ Erro durante o teste de e-mails:', error);
    process.exit(1);
  }
}

// Executar os testes
testAllEmails();

