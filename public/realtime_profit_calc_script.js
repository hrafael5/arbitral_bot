// Variáveis globais para o estado do popup
let pair = "";
let entryBuyExName = "mexc";
let entrySellExName = "mexc";
let entryBuyInstrument = "S";
let entrySellInstrument = "F";

// Seletores de elementos do DOM
const popupPairDisplayEl = document.getElementById("popupPairDisplay");
const popupLeg1ExchangeEl = document.getElementById("popupLeg1Exchange");
const popupLeg1InstrumentEl = document.getElementById("popupLeg1Instrument");
const popupLeg1PriceEl = document.getElementById("popupLeg1Price");
const popupProfitEEl = document.getElementById("popupProfitE");
const popupProfitSEl = document.getElementById("popupProfitS");
const popupLeg2ExchangeEl = document.getElementById("popupLeg2Exchange");
const popupLeg2InstrumentEl = document.getElementById("popupLeg2Instrument");
const popupLeg2PriceEl = document.getElementById("popupLeg2Price");
const openChartButtonEl = document.getElementById("openChartButton");

// Funções de formatação
function getRelevantDecimals(price) {
    if (price === null || price === undefined || isNaN(price)) return 7;
    const absPrice = Math.abs(price);
    if (absPrice >= 100) return 2;
    if (absPrice >= 1) return 4;
    if (absPrice >= 0.01) return 5;
    if (absPrice >= 0.0001) return 6;
    return 7;
}

function formatPriceForDisplay(price) {
    if (typeof price !== "number" || isNaN(price)) return "...";
    return price.toFixed(getRelevantDecimals(price));
}

function formatProfitPercentageForDisplay(profitPercentage, element) {
    if (!element) return;
    let textToShow = "Aguardando...";
    let baseClassName = element.id === "popupProfitS" ? "value-s profit-value" : "value profit-value";
    let finalClassName = baseClassName + " zero";

    if (typeof profitPercentage === "number" && !isNaN(profitPercentage)) {
        textToShow = (profitPercentage >= 0 ? "+" : "") + profitPercentage.toFixed(2) + "%";
        if (profitPercentage > 0.009) finalClassName = baseClassName + " positive";
        else if (profitPercentage < -0.009) finalClassName = baseClassName + " negative";
    }
    element.textContent = textToShow;
    element.className = finalClassName;
}

// Função que busca dados ao vivo da janela principal
function updateWithLiveData() {
    if (!window.opener || window.opener.closed) {
        if (window.profitUpdateInterval) clearInterval(window.profitUpdateInterval);
        return;
    }
    
    const mainState = window.opener.frontendState;
    if (!mainState) {
        return; // Aguarda o estado principal estar pronto
    }
    if (!mainState.allPairsData || !mainState.config) {
        return; // Aguarda o estado principal estar pronto
    }
    
    try {
        const configEntryBuyEx = mainState.config.exchanges[entryBuyExName.toLowerCase()];
        const configEntrySellEx = mainState.config.exchanges[entrySellExName.toLowerCase()];

        if (!configEntryBuyEx || !configEntrySellEx) return;

        const feeForEntryBuyOrder = entryBuyInstrument.toUpperCase().includes("SPOT") ? parseFloat(configEntryBuyEx.spotMakerFee) : parseFloat(configEntryBuyEx.futuresMakerFee);
        const feeForEntrySellOrder = entrySellInstrument.toUpperCase().includes("SPOT") ? parseFloat(configEntrySellEx.spotMakerFee) : parseFloat(configEntrySellEx.futuresMakerFee);
        
        const marketDataForEntryBuyLeg = mainState.allPairsData.find(p => p.pair === pair && p.exchange.toLowerCase() === entryBuyExName.toLowerCase());
        const marketDataForEntrySellLeg = mainState.allPairsData.find(p => p.pair === pair && p.exchange.toLowerCase() === entrySellExName.toLowerCase());

        if (marketDataForEntryBuyLeg && marketDataForEntrySellLeg) {
            const liveBuyPrice = entryBuyInstrument.toUpperCase().includes("SPOT") ? marketDataForEntryBuyLeg.spotPrice : marketDataForEntryBuyLeg.futuresPrice;
            const liveSellPrice = entrySellInstrument.toUpperCase().includes("SPOT") ? marketDataForEntrySellLeg.spotBid : marketDataForEntrySellLeg.futuresBid;

            // Atualiza a exibição de preços ao vivo
            popupLeg1PriceEl.textContent = formatPriceForDisplay(liveBuyPrice);
            popupLeg2PriceEl.textContent = formatPriceForDisplay(liveSellPrice);

            // Recalcula e exibe o Lucro E (Entrada) ao vivo
            if (typeof liveBuyPrice === "number" && typeof liveSellPrice === "number" && liveBuyPrice > 0) {
                const grossSpread = (liveSellPrice / liveBuyPrice) - 1;
                const netSpread = (grossSpread - feeForEntryBuyOrder - feeForEntrySellOrder) * 100;
                formatProfitPercentageForDisplay(netSpread, popupProfitEEl);
            }

            // Recalcula e exibe o Lucro S (Saída) ao vivo
            const lucroS_val = window.opener.calculateLucroS({
                buyExchange: entryBuyExName, sellExchange: entrySellExName,
                buyInstrument: entryBuyInstrument, sellInstrument: entrySellInstrument, pair: pair
            }, mainState.allPairsData, mainState.config);
            formatProfitPercentageForDisplay(lucroS_val, popupProfitSEl);
        }
    } catch (e) {
        console.error("Erro durante a atualização ao vivo:", e);
    }
}

// Função principal que é executada quando a janela carrega
window.onload = () => {
    const params = new URLSearchParams(window.location.search);
    
    // Pega os dados da URL
    pair = params.get("pair");
    entryBuyExName = params.get("buyEx");
    entrySellExName = params.get("sellEx");
    entryBuyInstrument = params.get("buyInst");
    entrySellInstrument = params.get("sellInst");
    const initialBuyPrice = parseFloat(params.get("buyPrice"));
    const initialSellPrice = parseFloat(params.get("sellPrice"));
    
    if (!pair) {
        document.body.innerHTML = "<h1>Erro: Par não especificado.</h1>";
        return;
    }

    document.title = "Entrada: " + pair;

    // **EXIBIÇÃO INICIAL E IMEDIATA DOS DADOS**
    popupPairDisplayEl.textContent = pair.split("/")[0];
    popupLeg1ExchangeEl.textContent = entryBuyExName ? (entryBuyExName.length > 4 ? entryBuyExName.substring(0, 4).toUpperCase() : entryBuyExName.toUpperCase()) : "EX1";
    popupLeg1InstrumentEl.textContent = entryBuyInstrument ? (entryBuyInstrument.toUpperCase().includes("SPOT") ? "S" : "F") : "S";
    popupLeg1PriceEl.textContent = formatPriceForDisplay(initialBuyPrice);
    
    popupLeg2ExchangeEl.textContent = entrySellExName ? (entrySellExName.length > 4 ? entrySellExName.substring(0, 4).toUpperCase() : entrySellExName.toUpperCase()) : "EX2";
    popupLeg2InstrumentEl.textContent = entrySellInstrument ? (entrySellInstrument.toUpperCase().includes("SPOT") ? "S" : "F") : "F";
    popupLeg2PriceEl.textContent = formatPriceForDisplay(initialSellPrice);

    // Calcular e exibir lucros iniciais se os preços estão disponíveis
    if (typeof initialBuyPrice === "number" && typeof initialSellPrice === "number" && !isNaN(initialBuyPrice) && !isNaN(initialSellPrice) && initialBuyPrice > 0) {
        // Usar taxas padrão se não conseguir acessar a janela principal ainda
        const defaultFees = {
            mexc: { spotMakerFee: 0.0000, futuresMakerFee: 0.0001 },
            gateio: { spotMakerFee: 0.0010, futuresMakerFee: 0.0002 }
        };
        
        const buyExConfig = defaultFees[entryBuyExName ? entryBuyExName.toLowerCase() : "mexc"] || { spotMakerFee: 0.001, futuresMakerFee: 0.001 };
        const sellExConfig = defaultFees[entrySellExName ? entrySellExName.toLowerCase() : "mexc"] || { spotMakerFee: 0.001, futuresMakerFee: 0.001 };
        
        const feeForBuyOrder = entryBuyInstrument && entryBuyInstrument.toUpperCase().includes("SPOT") ? buyExConfig.spotMakerFee : buyExConfig.futuresMakerFee;
        const feeForSellOrder = entrySellInstrument && entrySellInstrument.toUpperCase().includes("SPOT") ? sellExConfig.spotMakerFee : sellExConfig.futuresMakerFee;
        
        const grossSpread = (initialSellPrice / initialBuyPrice) - 1;
        const netSpread = (grossSpread - feeForBuyOrder - feeForSellOrder) * 100;
        
        formatProfitPercentageForDisplay(netSpread, popupProfitEEl);
    }

    // Inicia o loop para buscar dados ao vivo
    updateWithLiveData(); // Faz uma chamada inicial
    window.profitUpdateInterval = setInterval(updateWithLiveData, 1000);

    // Configura o botão de abrir gráficos
    openChartButtonEl.addEventListener("click", () => {
         if (window.opener && typeof window.opener.abrirGraficosComLayout === "function") {
            window.opener.abrirGraficosComLayout(
                entryBuyExName, 
                entryBuyInstrument, 
                entrySellExName, 
                entrySellInstrument, 
                pair, 
                "entry", 
                JSON.stringify({ buyPrice: initialBuyPrice, sellPrice: initialSellPrice })
            );
        } else {
            console.warn("window.opener.abrirGraficosComLayout não está disponível.");
        }
    });
};

