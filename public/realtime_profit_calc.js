// --- ESTADO E SELETORES DO DOM ---

// Variáveis globais para guardar o estado da calculadora
let pair = "";
let originalDirection = ''; 
let entryBuyExName = 'mexc'; 
let entrySellExName = 'mexc';

// Seletores de elementos do DOM para fácil acesso
const popupPairDisplayEl = document.getElementById('popupPairDisplay');
const popupLeg1ExchangeEl = document.getElementById('popupLeg1Exchange');
const popupLeg1InstrumentEl = document.getElementById('popupLeg1Instrument');
const popupLeg1PriceEl = document.getElementById('popupLeg1Price');
const popupProfitEEl = document.getElementById('popupProfitE'); 
const popupProfitSEl = document.getElementById('popupProfitS'); 
const popupLeg2ExchangeEl = document.getElementById('popupLeg2Exchange');
const popupLeg2InstrumentEl = document.getElementById('popupLeg2Instrument');
const popupLeg2PriceEl = document.getElementById('popupLeg2Price');
const openChartButtonEl = document.getElementById('openChartButton');

// --- FUNÇÕES DE FORMATAÇÃO E UTILIDADE ---

/**
 * Formata um número de preço para exibição, ajustando as casas decimais.
 * @param {number} price O preço a ser formatado.
 * @param {number} defaultDecimals O número padrão de casas decimais.
 * @returns {string} O preço formatado como string.
 */
function formatPriceForDisplay(price, defaultDecimals = 7) { 
    if (typeof price !== 'number' || isNaN(price)) return '---'; 
    if (price < 0.00001 && price > -0.00001 && price !== 0) return price.toPrecision(3);
    return price.toFixed(defaultDecimals); 
}

/**
 * Determina o número apropriado de casas decimais com base na magnitude do preço.
 * @param {number} price O preço.
 * @returns {number} O número de casas decimais.
 */
function getRelevantDecimals(price) {
    if (price === null || isNaN(price)) return 7;
    const absPrice = Math.abs(price);
    if (absPrice >= 100) return 2;
    if (absPrice >= 1) return 4;
    if (absPrice >= 0.01) return 5;
    if (absPrice >= 0.0001) return 6;
    return 7;
}

/**
 * Formata e colore um valor de lucro percentual.
 * @param {number} profitPercentage O lucro em percentagem.
 * @param {HTMLElement} element O elemento do DOM para atualizar.
 */
function formatProfitPercentageForDisplay(profitPercentage, element) {
    if (!element) return;

    let textToShow = "Calculando...";
    const baseClassName = element.id === 'popupProfitS' ? 'value-s profit-value' : 'value profit-value';
    let finalClassName = `${baseClassName} zero`;

    if (typeof profitPercentage === 'number' && !isNaN(profitPercentage)) {
        textToShow = (profitPercentage >= 0 ? '+' : '') + profitPercentage.toFixed(2) + '%';
        if (profitPercentage > 0.009) finalClassName = `${baseClassName} positive`;
        else if (profitPercentage < -0.009) finalClassName = `${baseClassName} negative`;
    }
    
    element.textContent = textToShow;
    element.className = finalClassName;
}

/**
 * Configura o estado inicial da calculadora com base nos parâmetros da URL.
 * @param {URLSearchParams} params Os parâmetros da URL.
 */
function setInitialState(params) {
    pair = params.get('pair'); 
    originalDirection = params.get('direction'); 
    entryBuyExName = params.get('buyEx') || 'mexc'; 
    entrySellExName = params.get('sellEx') || 'mexc'; 

    let buyInstrument = "S";
    let sellInstrument = "F";

    if (originalDirection) {
        const dirParts = originalDirection.toLowerCase().split('/');
        if (dirParts.length === 2) {
            buyInstrument = dirParts[0].trim().includes("spot") ? 'S' : 'F';
            sellInstrument = dirParts[1].trim().includes("spot") ? 'S' : 'F';
        }
    }

    // Atualiza a UI estática que não muda
    document.title = "Entrada: " + pair;
    popupPairDisplayEl.textContent = pair.split('/')[0];
    popupLeg1ExchangeEl.textContent = entryBuyExName.length > 4 ? entryBuyExName.substring(0,4).toUpperCase() : entryBuyExName.toUpperCase();
    popupLeg1InstrumentEl.textContent = buyInstrument;
    popupLeg2ExchangeEl.textContent = entrySellExName.length > 4 ? entrySellExName.substring(0,4).toUpperCase() : entrySellExName.toUpperCase();
    popupLeg2InstrumentEl.textContent = sellInstrument;
}

// --- LÓGICA PRINCIPAL DE EXECUÇÃO ---

window.onload = () => {
    // Extrai os parâmetros da URL para configurar a janela.
    const params = new URLSearchParams(window.location.search);
    setInitialState(params);

    // Adiciona o "escutador" de mensagens da janela principal.
    // Esta é a parte central da comunicação em tempo real.
    window.addEventListener('message', (event) => {
        // Verificação de segurança: só aceita mensagens da mesma origem.
        if (event.origin !== window.location.origin) return;

        const messageData = event.data;

        // Verifica se a mensagem é do tipo 'update' (enviada pelo script.js).
        if (messageData && messageData.type === 'update') {
            const op = messageData.opportunity;
            const lucroS = messageData.lucroS;

            // Atualiza os elementos da UI com os novos dados recebidos.
            if (op) {
                popupLeg1PriceEl.textContent = formatPriceForDisplay(op.buyPrice, getRelevantDecimals(op.buyPrice));
                popupLeg2PriceEl.textContent = formatPriceForDisplay(op.sellPrice, getRelevantDecimals(op.sellPrice));
                formatProfitPercentageForDisplay(op.netSpreadPercentage, popupProfitEEl);
            }
            if (typeof lucroS === 'number') {
                formatProfitPercentageForDisplay(lucroS, popupProfitSEl);
            }
        }
    });

    // Adiciona o evento de clique ao botão para abrir os gráficos na janela principal.
    openChartButtonEl.addEventListener('click', () => {
        if (window.opener && typeof window.opener.abrirGraficosComLayout === 'function') {
            const buyInstrumentType = popupLeg1InstrumentEl.textContent === 'S' ? 'spot' : 'futures';
            const sellInstrumentType = popupLeg2InstrumentEl.textContent === 'S' ? 'spot' : 'futures';
            
            // Pede para a janela "mãe" executar a função de abrir os gráficos.
            window.opener.abrirGraficosComLayout(
                entryBuyExName, 
                buyInstrumentType, 
                entrySellExName, 
                sellInstrumentType, 
                pair, 
                originalDirection, 
                '' // Não precisa mais enviar os dados da op, a janela principal já os tem.
            );
        }
    });
};