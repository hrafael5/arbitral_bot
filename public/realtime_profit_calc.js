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
    if (absPrice >= 0.01) return 6;
    return 8;
}

/**
 * Formata a porcentagem de lucro para exibição com cores (verde para positivo, vermelho para negativo).
 * @param {number} percentage A porcentagem a ser formatada.
 * @param {HTMLElement} targetElement O elemento HTML onde a porcentagem será exibida.
 */
function formatProfitPercentageForDisplay(percentage, targetElement) {
    if (typeof percentage !== 'number' || isNaN(percentage)) {
        targetElement.textContent = '-0.00%';
        targetElement.classList.remove('text-green-600', 'text-red-600', 'dark:text-green-400', 'dark:text-red-400');
        return;
    }
    targetElement.textContent = (percentage >= 0 ? '+' : '') + percentage.toFixed(2) + '%';
    targetElement.classList.remove('text-green-600', 'text-red-600', 'dark:text-green-400', 'dark:text-red-400');
    if (percentage > 0) {
        targetElement.classList.add('text-green-600', 'dark:text-green-400');
    } else if (percentage < 0) {
        targetElement.classList.add('text-red-600', 'dark:text-red-400');
    }
}

/**
 * Função de debounce para limitar a frequência de execução de uma função.
 * @param {Function} func A função a ser debounced.
 * @param {number} wait O tempo de espera em milissegundos.
 * @returns {Function} A função debounced.
 */
function debounce(func, wait) {
    let timeout;
    return function (...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
    };
}

// --- INICIALIZAÇÃO E EVENTOS ---

// Aguarda o carregamento do DOM antes de configurar os eventos.
document.addEventListener('DOMContentLoaded', () => {
    // Inicializa os campos da UI com valores padrão.
    if (popupPairDisplayEl) popupPairDisplayEl.textContent = pair || '---';
    if (popupLeg1ExchangeEl) popupLeg1ExchangeEl.textContent = entryBuyExName.toUpperCase();
    if (popupLeg1InstrumentEl) popupLeg1InstrumentEl.textContent = 'S';
    if (popupLeg1PriceEl) popupLeg1PriceEl.textContent = '0.00000';
    if (popupProfitEEl) popupProfitEEl.textContent = '-0.00%';
    if (popupProfitSEl) popupProfitSEl.textContent = '-0.00%';
    if (popupLeg2ExchangeEl) popupLeg2ExchangeEl.textContent = entrySellExName.toUpperCase();
    if (popupLeg2InstrumentEl) popupLeg2InstrumentEl.textContent = 'F';
    if (popupLeg2PriceEl) popupLeg2PriceEl.textContent = '0.00000';

    // Configura o ouvinte de mensagens da janela principal (enviadas por script.js).
    window.addEventListener('message', debounce((event) => {
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
    }, 100)); // Debounce de 100ms

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
});