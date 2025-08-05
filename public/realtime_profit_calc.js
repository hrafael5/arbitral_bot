// --- ESTADO E SELETORES GLOBAIS ---
const state = {
    params: {},
    allPairsData: [],
    config: null,
    connected: false,
};

const elements = {
    pairDisplay: document.getElementById('popupPairDisplay'),
    leg1Exchange: document.getElementById('popupLeg1Exchange'),
    leg1Instrument: document.getElementById('popupLeg1Instrument'),
    leg1Price: document.getElementById('popupLeg1Price'),
    profitE: document.getElementById('popupProfitE'),
    profitS: document.getElementById('popupProfitS'),
    leg2Exchange: document.getElementById('popupLeg2Exchange'),
    leg2Instrument: document.getElementById('popupLeg2Instrument'),
    leg2Price: document.getElementById('popupLeg2Price'),
    openChartButton: document.getElementById('openChartButton'),
    connectionDot: document.getElementById('connection-dot'),
    connectionText: document.getElementById('connection-text'),
};

// --- FUNÇÕES DE ATUALIZAÇÃO E FORMATAÇÃO ---

function formatPrice(price) {
    if (typeof price !== 'number' || isNaN(price)) return '...';
    const decimals = Math.abs(price) >= 1 ? 4 : 7;
    return price.toFixed(decimals);
}

function updateElementText(element, text) {
    if (element && element.textContent !== text) {
        element.textContent = text;
    }
}

function updateProfitDisplay(element, profit) {
    if (!element) return;
    let text = '...';
    let className = 'profit-value zero';
    if (typeof profit === 'number' && !isNaN(profit)) {
        text = (profit >= 0 ? '+' : '') + profit.toFixed(2) + '%';
        if (profit > 0.009) className = 'profit-value positive';
        else if (profit < -0.009) className = 'profit-value negative';
    }
    updateElementText(element, text);
    element.className = element.id.includes('popupProfitS') ? `value-s ${className}` : `value ${className}`;
}

// --- FUNÇÕES DE CÁLCULO ---

function getFee(exchange, instrument) {
    const exConf = state.config.exchanges[exchange.toLowerCase()];
    if (!exConf) return 0;
    return instrument.toUpperCase().includes('SPOT') ? (exConf.spotMakerFee || 0) : (exConf.futuresMakerFee || 0);
}

function calculateAndDisplay() {
    if (!state.params.pair || !state.config || !state.allPairsData.length) return;

    const { pair, buyEx, sellEx, buyInst, sellInst } = state.params;
    
    const marketBuyData = state.allPairsData.find(p => p.pair === pair && p.exchange.toLowerCase() === buyEx.toLowerCase());
    const marketSellData = state.allPairsData.find(p => p.pair === pair && p.exchange.toLowerCase() === sellEx.toLowerCase());

    if (!marketBuyData || !marketSellData) return;

    // Calcula Lucro de Entrada (E)
    const entryPriceBuy = buyInst.toUpperCase().includes('SPOT') ? marketBuyData.spotPrice : marketBuyData.futuresPrice;
    const entryPriceSell = sellInst.toUpperCase().includes('SPOT') ? marketSellData.spotBid : marketSellData.futuresBid;
    
    updateElementText(elements.leg1Price, formatPrice(entryPriceBuy));
    updateElementText(elements.leg2Price, formatPrice(entryPriceSell));
    
    if (entryPriceBuy > 0) {
        const feeBuy = getFee(buyEx, buyInst);
        const feeSell = getFee(sellEx, sellInst);
        const profitE = ((entryPriceSell / entryPriceBuy) - 1 - feeBuy - feeSell) * 100;
        updateProfitDisplay(elements.profitE, profitE);
    }

    // Calcula Lucro de Saída (S - Inverso)
    const exitPriceBuy = sellInst.toUpperCase().includes('SPOT') ? marketSellData.spotPrice : marketSellData.futuresPrice;
    const exitPriceSell = buyInst.toUpperCase().includes('SPOT') ? marketBuyData.spotBid : marketBuyData.futuresBid;
    
    if (exitPriceBuy > 0) {
        const feeExitBuy = getFee(sellEx, sellInst);
        const feeExitSell = getFee(buyEx, buyInst);
        const profitS = ((exitPriceSell / exitPriceBuy) - 1 - feeExitBuy - feeExitSell) * 100;
        updateProfitDisplay(elements.profitS, profitS);
    }
}

// --- LÓGICA DE CONEXÃO E INICIALIZAÇÃO ---

function updateConnectionStatus(connected) {
    state.connected = connected;
    elements.connectionDot.className = 'status-dot ' + (connected ? 'connected' : 'disconnected');
    updateElementText(elements.connectionText, connected ? 'Conectado' : 'Desconectado');
}

function connectWebSocket() {
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${wsProtocol}//${window.location.host}`;
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => updateConnectionStatus(true);
    ws.onclose = () => {
        updateConnectionStatus(false);
        setTimeout(connectWebSocket, 5000);
    };
    ws.onerror = (err) => {
        console.error("WebSocket Error:", err);
        updateConnectionStatus(false);
        ws.close();
    };
    ws.onmessage = (event) => {
        try {
            const message = JSON.parse(event.data);
            if (message.type === "all_pairs_update") {
                state.allPairsData = message.data || [];
                calculateAndDisplay();
            }
        } catch (error) {
            console.error("Erro ao processar mensagem:", error);
        }
    };
}

async function initialize() {
    const params = new URLSearchParams(window.location.search);
    state.params = {
        pair: params.get("pair"),
        buyEx: params.get("buyEx"),
        sellEx: params.get("sellEx"),
        buyInst: params.get("buyInst"),
        sellInst: params.get("sellInst")
    };

    if (!state.params.pair) {
        document.body.innerHTML = "<h1>Erro: Parâmetros insuficientes.</h1>";
        return;
    }

    document.title = `Detalhes: ${state.params.pair}`;
    updateElementText(elements.pairDisplay, state.params.pair.split('/')[0]);
    updateElementText(elements.leg1Exchange, state.params.buyEx);
    updateElementText(elements.leg1Instrument, state.params.buyInst.includes('spot') ? 'S' : 'F');
    updateElementText(elements.leg2Exchange, state.params.sellEx);
    updateElementText(elements.leg2Instrument, state.params.sellInst.includes('spot') ? 'S' : 'F');

    elements.openChartButton.addEventListener("click", () => {
        if (window.opener && typeof window.opener.abrirGraficosComLayout === "function") {
            window.opener.abrirGraficosComLayout(
                state.params.buyEx, state.params.buyInst,
                state.params.sellEx, state.params.sellInst,
                state.params.pair, "entry", ""
            );
        }
    });

    try {
        const response = await fetch('/api/config');
        if (!response.ok) throw new Error('Falha ao buscar config');
        state.config = await response.json();
        connectWebSocket();
    } catch (error) {
        console.error("Erro na inicialização:", error);
        updateElementText(elements.pairDisplay, "ERRO");
    }
}

document.addEventListener('DOMContentLoaded', initialize);