// /lib/MarketMonitor.js (VERSÃO HÍBRIDA FINAL: MEXC=REST, Gate.io=WebSocket)

class MarketMonitor {
    constructor(connectors, pairsByExchange, arbitrageEngine, logger, config, broadcastCallback) {
        this.connectors = connectors;
        this.pairsByExchange = pairsByExchange;
        this.engine = arbitrageEngine;
        this.logger = logger;
        this.globalConfig = config;
        this.broadcastCallback = broadcastCallback;
        
        this.marketData = {};
        this.pollTimers = [];
        this.initializeMarketData();
    }

    initializeMarketData() {
        this.logger.info("[MarketMonitor] Inicializando a estrutura de dados de mercado...");
        for (const exchange in this.pairsByExchange) {
            this.marketData[exchange] = {};
            this.pairsByExchange[exchange].forEach(pair => {
                const [baseAsset, quoteAsset] = pair.split("/");
                // Gate.io usa UNDERSCORE para Spot, enquanto MEXC usa a concatenação
                const spotApiSymbol = (exchange === 'gateio') ? `${baseAsset}_${quoteAsset}` : `${baseAsset}${quoteAsset}`;
                const futuresApiSymbol = `${baseAsset}_${quoteAsset}`;

                this.marketData[exchange][pair] = {
                    pair: pair,
                    spot: { symbolApi: spotApiSymbol.toUpperCase(), ticker: null, volume24hQuote: null },
                    futures: { symbolApi: futuresApiSymbol.toUpperCase(), ticker: null, volume24hQuote: null, fundingRate: null }
                };
            });
        }
    }

    start() {
        this.logger.info(`[MarketMonitor] Iniciando monitoramento em modo HÍBRIDO...`);

        // --- LÓGICA PARA MEXC (100% API REST Polling) ---
        if (this.connectors.mexc) {
            this.logger.info("[MarketMonitor] Configurando MEXC para polling via API REST...");
            const mexcConfig = this.globalConfig.mexc || {};
            const pollMexcSpot = () => this.pollSpotData("mexc", this.connectors.mexc);
            const pollMexcFutures = () => this.pollFuturesData("mexc", this.connectors.mexc);
            
            pollMexcSpot();
            pollMexcFutures();
            
            const spotInterval = parseInt(mexcConfig.spot_polling_interval_ms) || 3000;
            const futuresInterval = parseInt(mexcConfig.futures_polling_interval_ms) || 3000;
            
            this.pollTimers.push(setInterval(pollMexcSpot, spotInterval));
            this.pollTimers.push(setInterval(pollMexcFutures, futuresInterval));
        }

        // --- LÓGICA PARA GATE.IO (100% WebSocket) ---
        if (this.connectors.gateio) {
            const gateioPairs = this.pairsByExchange.gateio || [];
            if (gateioPairs.length > 0) {
                this.logger.info("[MarketMonitor] Configurando Gate.io para streaming via WebSocket...");

                this.connectors.gateio.setTickerUpdateCallback(this.handleRealTimeUpdate.bind(this));

                const spotSymbols = gateioPairs.map(p => this.marketData.gateio[p].spot.symbolApi);
                const futuresSymbols = gateioPairs.map(p => this.marketData.gateio[p].futures.symbolApi);

                this.connectors.gateio.connectSpotWebSocket(spotSymbols);
                this.connectors.gateio.connectFuturesWebSocket(futuresSymbols);
            }
        }
    }

    // Callback para dados em tempo real (usado pela Gate.io WebSocket)
    handleRealTimeUpdate(exchange, marketType, data) {
        const pairKey = Object.keys(this.marketData[exchange] || {}).find(key => 
            this.marketData[exchange][key][marketType]?.symbolApi === data.symbol
        );
        if (!pairKey) return;

        this.marketData[exchange][pairKey][marketType].ticker = data;
        if (data.volume24hQuote) this.marketData[exchange][pairKey][marketType].volume24hQuote = data.volume24hQuote;
        if (data.fundingRate) this.marketData[exchange][pairKey][marketType].fundingRate = data.fundingRate;

        this.triggerUpdate();
    }

    // Função de polling para dados de Spot (usada pela MEXC)
    async pollSpotData(exchangeName, connector) {
        try {
            const spotTickersMap = await connector.getAllSpotBookTickers();
            if (!spotTickersMap || spotTickersMap.size === 0) return;

            let updated = false;
            (this.pairsByExchange[exchangeName] || []).forEach(pair => {
                const data = this.marketData[exchangeName][pair];
                const tickerData = spotTickersMap.get(data.spot.symbolApi);
                if (tickerData) {
                    data.spot.ticker = tickerData;
                    updated = true;
                }
            });

            if (updated) this.triggerUpdate();
        } catch (error) {
            this.logger.error(`[MarketMonitor][${exchangeName}] Erro no polling de Spot: ${error.message}`);
        }
    }
    
    // Função de polling para dados de Futuros (usada pela MEXC)
    async pollFuturesData(exchangeName, connector) {
        try {
            const futuresDataMap = await connector.getAllFuturesBookTickers();
            if (!futuresDataMap || futuresDataMap.size === 0) return;

            let updated = false;
            (this.pairsByExchange[exchangeName] || []).forEach(pair => {
                const data = this.marketData[exchangeName][pair];
                const tickerData = futuresDataMap.get(data.futures.symbolApi);
                if (tickerData) {
                    data.futures.ticker = {
                        bidPrice: tickerData.bidPrice,
                        askPrice: tickerData.askPrice,
                        ts: tickerData.ts
                    };
                    data.futures.volume24hQuote = tickerData.volume24hQuote;
                    data.futures.fundingRate = tickerData.fundingRate;
                    updated = true;
                }
            });

            if (updated) this.triggerUpdate();
        } catch (error) {
            this.logger.error(`[MarketMonitor][${exchangeName}] Erro no polling de Futuros: ${error.message}`);
        }
    }

    triggerUpdate() {
        this.engine.processMarketUpdate(this.marketData);
        if (this.broadcastCallback) this.broadcastCallback();
    }
    
    stop() {
        this.logger.info("[MarketMonitor] Parando todos os timers de polling e conexões...");
        this.pollTimers.forEach(timer => clearInterval(timer));
        this.pollTimers = [];
        Object.values(this.connectors).forEach(c => {
            if (typeof c.closeAll === 'function') c.closeAll();
        });
        this.logger.info("[MarketMonitor] Todas as rotinas paradas.");
    }
    
    getAllMarketData() {
        const allData = [];
        Object.entries(this.marketData).forEach(([exchangeName, pairsData]) => {
            Object.entries(pairsData).forEach(([pairName, data]) => {
                allData.push({
                    exchange: exchangeName, 
                    pair: pairName,
                    spotPrice: data.spot?.ticker?.askPrice,
                    futuresPrice: data.futures?.ticker?.askPrice,
                    spotBid: data.spot?.ticker?.bidPrice,
                    futuresBid: data.futures?.ticker?.bidPrice,
                    spotTimestamp: data.spot?.ticker?.ts,
                    futuresTimestamp: data.futures?.ticker?.ts,
                });
            });
        });
        return allData;
    }
}

module.exports = MarketMonitor;