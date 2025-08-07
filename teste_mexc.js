const axios = require('axios');

async function testMexcApi() {
    const spotUrl = "https://api.mexc.com/api/v3/exchangeInfo";
    const futuresUrl = "https://contract.mexc.com/api/v1/contract/detail";

    console.log(`[TESTE] A tentar fazer o pedido para a API de SPOT: ${spotUrl}`);

    try {
        // Usando um User-Agent de navegador comum para evitar bloqueios simples
        const spotResponse = await axios.get(spotUrl, {
            timeout: 15000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            }
        });
        console.log("\n✅ SUCESSO NA API DE SPOT!");
        console.log(`   - Status da resposta: ${spotResponse.status}`);
        console.log(`   - Encontrados ${spotResponse.data.symbols.length} pares de moedas.\n`);

    } catch (error) {
        console.error("\n❌ ERRO NA API DE SPOT!");
        logErrorDetails(error);
    }

    console.log(`[TESTE] A tentar fazer o pedido para a API de FUTUROS: ${futuresUrl}`);

    try {
        const futuresResponse = await axios.get(futuresUrl, {
            timeout: 15000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            }
        });
        console.log("\n✅ SUCESSO NA API DE FUTUROS!");
        console.log(`   - Status da resposta: ${futuresResponse.status}`);
        console.log(`   - Encontrados ${futuresResponse.data.data.length} contratos de futuros.\n`);

    } catch (error) {
        console.error("\n❌ ERRO NA API DE FUTUROS!");
        logErrorDetails(error);
    }
}

function logErrorDetails(error) {
    if (error.response) {
        // O pedido foi feito e o servidor respondeu com um status de erro
        console.error(`   - Status do Erro: ${error.response.status}`);
        console.error("   - Dados da Resposta:", JSON.stringify(error.response.data));
    } else if (error.request) {
        // O pedido foi feito mas nenhuma resposta foi recebida
        console.error("   - Erro: Nenhuma resposta recebida do servidor. (Timeout ou problema de rede)");
    } else {
        // Algo aconteceu ao configurar o pedido
        console.error("   - Erro ao configurar o pedido:", error.message);
    }
    console.log("\n");
}

testMexcApi();