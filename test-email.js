// Script para testar o envio de emails
require('dotenv').config();

const { testConnection, sendPasswordResetEmail } = require('./utils/emailService');

async function testEmailSystem() {
  console.log('🚀 Iniciando teste do sistema de email...\n');
  
  // Teste 1: Verificar configurações
  console.log('📋 Configurações atuais:');
  console.log(`SMTP_HOST: ${process.env.SMTP_HOST}`);
  console.log(`SMTP_PORT: ${process.env.SMTP_PORT}`);
  console.log(`SMTP_SECURE: ${process.env.SMTP_SECURE}`);
  console.log(`SMTP_USER: ${process.env.SMTP_USER}`);
  console.log(`FROM_EMAIL: ${process.env.FROM_EMAIL}`);
  console.log(`APP_BASE_URL: ${process.env.APP_BASE_URL}\n`);
  
  // Teste 2: Conexão SMTP
  console.log('🔍 Teste 1: Verificando conexão SMTP...');
  const connectionOk = await testConnection();
  
  if (!connectionOk) {
    console.log('❌ Falha na conexão SMTP. Verifique as configurações.');
    return;
  }
  
  // Teste 3: Envio de email de teste
  console.log('\n🔍 Teste 2: Enviando email de teste...');
  try {
    const testEmail = process.env.SMTP_USER; // Enviar para o próprio email
    const testToken = 'test-token-123456789';
    
    await sendPasswordResetEmail(testEmail, testToken);
    console.log('✅ Email de teste enviado com sucesso!');
    console.log('📧 Verifique sua caixa de entrada e spam.');
    
  } catch (error) {
    console.error('❌ Falha ao enviar email de teste:', error.message);
  }
  
  console.log('\n🏁 Teste concluído!');
}

// Executar o teste
testEmailSystem().catch(console.error);

