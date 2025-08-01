let pair = '';
let originalDirection = ''; 
let entryBuyExName = 'mexc'; 
let entrySellExName = 'mexc'; 
let entryBuyInstrumentIsSpot = true;
let entrySellInstrumentIsSpot = false;

// Função para obter parâmetros da URL
function getUrlParameter(name) {
    name = name.replace(/[[\]]/g, '\\$&');
    var regex = new RegExp('[?&]' + name + '(=([^&#]*)|&|#|$)');
    var results = regex.exec(window.location.href);
    if (!results) return null;
    if (!results[2]) return '';
    return decodeURIComponent(results[2].replace(/\+/g, ' '));
}

// Ler parâmetros da URL ao carregar a página
document.addEventListener('DOMContentLoaded', () => {
    const urlParams = new URLSearchParams(window.location.search);
    pair = urlParams.get('pair') || pair;
    originalDirection = urlParams.get('direction') || originalDirection;
    entryBuyExName = urlParams.get('buyEx') || entryBuyExName;
    entrySellExName = urlParams.get('sellEx') || entrySellExName;

    // Determinar se é spot ou futures baseado na direção
    if (originalDirection === 'spot_to_futures') {
        entryBuyInstrumentIsSpot = true;
        entrySellInstrumentIsSpot = false;
    } else if (originalDirection === 'futures_to_spot') {
        entryBuyInstrumentIsSpot = false;
        entrySellInstrumentIsSpot = true;
    } else { // Default ou outros casos
        entryBuyInstrumentIsSpot = true;
        entrySellInstrumentIsSpot = false;
    }
    updatePopupDisplay();
});

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

// Dados simulados para demonstração
const simulatedData = {
    'BTC/USDT': {
        mexc: { spotPrice: 67850.50, futuresPrice: 67855.20, spotBid: 67848.30, futuresBid: 67853.10 },
        gateio: { spotPrice: 67860.80, futuresPrice: 67865.40, spotBid: 67858.60, futuresBid: 67863.20 }
    },
    'ETH/USDT': {
        mexc: { spotPrice: 3245.80, futuresPrice: 3246.50, spotBid: 3244.90, futuresBid: 3245.60 },
        gateio: { spotPrice: 3248.20, futuresPrice: 3249.10, spotBid: 3247.30, futuresBid: 3248.20 }
    }
};

const simulatedConfig = {
    exchanges: {
        mexc: { spotMakerFee: 0.0000, futuresMakerFee: 0.0001 },
        gateio: { spotMakerFee: 0.0010, futuresMakerFee: 0.0002 }
    }
};

function formatPriceForDisplay(price, decimals = 7) { 
    if (typeof price !== 'number' || isNaN(price)) return '-'; 
    if (price < 0.00001 && price !== 0 && price > -0.00001) return price.toPrecision(3);
    return price.toFixed(decimals); 
}

function getRelevantDecimals(price) {
    if (price === null || price === undefined || isNaN(price)) return 7;
    const absPrice = Math.abs(price);
    if (absPrice >= 100) return 2;
    if (absPrice >= 1) return 4;
    if (absPrice >= 0.01) return 5;
    if (absPrice >= 0.0001) return 6;
    return 7;
}

function formatProfitPercentageForDisplay(profitPercentage, element) {
    if (!element) return;
    let textToShow = "Dados...";
    let baseClassName = element.id === 'popupProfitS' ? 'value-s profit-value' : 'value profit-value';
    let finalClassName = `${baseClassName} zero`;

    if (typeof profitPercentage === 'number' && !isNaN(profitPercentage)) {
        textToShow = (profitPercentage >= 0 ? '+' : '') + profitPercentage.toFixed(2) + '%';
        if (profitPercentage > 0.009) finalClassName = `${baseClassName} positive`;
        else if (profitPercentage < -0.009) finalClassName = `${baseClassName} negative`;
    }
    element.textContent = textToShow;
    element.className = finalClassName;
}

function calculateLucroS_PopUp(dataSource) {
    const currentData = dataSource.allPairsData;
    const currentConfig = dataSource.config;

    if (!currentData[pair]) {
        console.log('[CalcPopUpS] Dados para o par não encontrados na fonte atual.');
        return NaN;
    }
    
    const configForS_BuyLeg = currentConfig.exchanges[entrySellExName.toLowerCase()]; 
    const configForS_SellLeg = currentConfig.exchanges[entryBuyExName.toLowerCase()]; 

    if (!configForS_BuyLeg || !configForS_SellLeg) {
        console.warn(`[CalcPopUpS] Config de taxas não encontrada para ${entrySellExName} ou ${entryBuyExName} (para Saída)`);
        return NaN;
    }

    const marketDataForS_BuyLeg = currentData[pair][entrySellExName.toLowerCase()];
    const marketDataForS_SellLeg = currentData[pair][entryBuyExName.toLowerCase()];

    if (!marketDataForS_BuyLeg || !marketDataForS_SellLeg) {
        console.log('[CalcPopUpS] Dados de mercado para pernas de saída não encontrados.');
        return NaN;
    }

    let price_S_Buy, fee_S_Buy;
    if (entrySellInstrumentIsSpot) {
        price_S_Buy = marketDataForS_BuyLeg.spotPrice; 
        fee_S_Buy = parseFloat(configForS_BuyLeg.spotMakerFee);
    } else {
        price_S_Buy = marketDataForS_BuyLeg.futuresPrice; 
        fee_S_Buy = parseFloat(configForS_BuyLeg.futuresMakerFee);
    }

    let price_S_Sell, fee_S_Sell;
    if (entryBuyInstrumentIsSpot) {
        price_S_Sell = marketDataForS_SellLeg.spotBid; 
        fee_S_Sell = parseFloat(configForS_SellLeg.spotMakerFee);
    } else {
        price_S_Sell = marketDataForS_SellLeg.futuresBid; 
        fee_S_Sell = parseFloat(configForS_SellLeg.futuresMakerFee);
    }
    
    if (isNaN(fee_S_Buy)) fee_S_Buy = 0;
    if (isNaN(fee_S_Sell)) fee_S_Sell = 0;

    if (typeof price_S_Buy === 'number' && typeof price_S_Sell === 'number' && price_S_Buy > 0 && !isNaN(price_S_Buy) && !isNaN(price_S_Sell)) {
        const grossSpreadS = (price_S_Sell / price_S_Buy) - 1;
        const netSpreadS = grossSpreadS - fee_S_Buy - fee_S_Sell; 
        return netSpreadS * 100; 
    }
    console.log('[CalcPopUpS] Preços ou taxas inválidos para cálculo de lucro S.');
    return NaN;
}

function updatePopupDisplay() {
    let dataSource = null;

    // Tenta acessar dados reais primeiro, mas com tratamento de erro CORS
    try {
        if (window.opener && !window.opener.closed && window.opener.frontendState) {
            dataSource = window.opener.frontendState;
            console.log('[CalcPopUpNew] Usando dados de window.opener.frontendState.');
        }
    } catch (e) {
        // Ignora erros de CORS silenciosamente
        console.log('[CalcPopUpNew] Acesso a window.opener bloqueado por CORS, usando dados simulados.');
    }

    // Fallback para dados simulados
    if (!dataSource || !dataSource.allPairsData || !dataSource.config || !dataSource.config.exchanges) {
        console.log('[CalcPopUpNew] Usando dados simulados.');
        dataSource = { allPairsData: simulatedData, config: simulatedConfig };
    }

    try {
        const currentConfig = dataSource.config;
        const currentAllPairsData = dataSource.allPairsData;

        const configEntryBuyEx = currentConfig.exchanges[entryBuyExName.toLowerCase()];
        const configEntrySellEx = currentConfig.exchanges[entrySellExName.toLowerCase()];

        if (!configEntryBuyEx || !configEntrySellEx) {
            console.warn(`[CalcPopUpNew] Config de taxas não encontrada para ${entryBuyExName} ou ${entrySellExName}.`);
            formatProfitPercentageForDisplay(NaN, popupProfitEEl);
            formatProfitPercentageForDisplay(NaN, popupProfitSEl);
            return;
        }
        
        const feeForEntryBuyOrder = entryBuyInstrumentIsSpot ? parseFloat(configEntryBuyEx.spotMakerFee) : parseFloat(configEntryBuyEx.futuresMakerFee);
        const feeForEntrySellOrder = entrySellInstrumentIsSpot ? parseFloat(configEntrySellEx.spotMakerFee) : parseFloat(configEntrySellEx.futuresMakerFee);
        
        // Acesso direto aos dados do par
        const marketDataForEntryBuyLeg = currentAllPairsData[pair] ? currentAllPairsData[pair][entryBuyExName.toLowerCase()] : null;
        const marketDataForEntrySellLeg = currentAllPairsData[pair] ? currentAllPairsData[pair][entrySellExName.toLowerCase()] : null;

        if (marketDataForEntryBuyLeg && marketDataForEntrySellLeg) {
            const priceToBuyEntry = entryBuyInstrumentIsSpot ? marketDataForEntryBuyLeg.spotPrice : marketDataForEntryBuyLeg.futuresPrice; 
            const priceToSellEntry = entrySellInstrumentIsSpot ? marketDataForEntrySellLeg.spotBid : marketDataForEntrySellLeg.futuresBid; 
            
            let netSpreadMakerEntry = NaN;
            if (typeof priceToBuyEntry === 'number' && typeof priceToSellEntry === 'number' && priceToBuyEntry > 0 && !isNaN(priceToBuyEntry) && !isNaN(priceToSellEntry)) {
                const grossSpreadMaker = (priceToSellEntry / priceToBuyEntry) - 1;
                netSpreadMakerEntry = grossSpreadMaker - feeForEntryBuyOrder - feeForEntrySellOrder;
            }
            formatProfitPercentageForDisplay(netSpreadMakerEntry * 100, popupProfitEEl);
            
            const netSpreadMakerS_percentage = calculateLucroS_PopUp(dataSource);
            formatProfitPercentageForDisplay(netSpreadMakerS_percentage, popupProfitSEl);

            if (popupPairDisplayEl) popupPairDisplayEl.textContent = pair.split('/')[0];
            if (popupLeg1ExchangeEl) popupLeg1ExchangeEl.textContent = entryBuyExName.length > 4 ? entryBuyExName.substring(0,4).toUpperCase() : entryBuyExName.toUpperCase();
            if (popupLeg1InstrumentEl) popupLeg1InstrumentEl.textContent = entryBuyInstrumentIsSpot ? 'S' : 'F';
            if (popupLeg1PriceEl) popupLeg1PriceEl.textContent = formatPriceForDisplay(priceToBuyEntry, getRelevantDecimals(priceToBuyEntry));
            if (popupLeg2ExchangeEl) popupLeg2ExchangeEl.textContent = entrySellExName.length > 4 ? entrySellExName.substring(0,4).toUpperCase() : entrySellExName.toUpperCase();
            if (popupLeg2InstrumentEl) popupLeg2InstrumentEl.textContent = entrySellInstrumentIsSpot ? 'S' : 'F';
            if (popupLeg2PriceEl) popupLeg2PriceEl.textContent = formatPriceForDisplay(priceToSellEntry, getRelevantDecimals(priceToSellEntry));
            
        } else {
            console.log('[CalcPopUpNew] Dados de mercado para pernas de entrada não encontrados.');
            formatProfitPercentageForDisplay(NaN, popupProfitEEl);
            formatProfitPercentageForDisplay(NaN, popupProfitSEl);
        }

    } catch (error) {
        console.error('[CalcPopUpNew] Erro ao atualizar display do popup:', error);
        formatProfitPercentageForDisplay(NaN, popupProfitEEl);
        formatProfitPercentageForDisplay(NaN, popupProfitSEl);
    }
}

// Inicializa o display quando a página carrega
// updatePopupDisplay(); // Removido pois já é chamado no DOMContentLoaded

