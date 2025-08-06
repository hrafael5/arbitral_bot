// /lib/MarketMonitor.js (VERSÃO HÍBRIDA FINAL)

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
                const spotApiSymbol = (exchange === 'gateio') ? pair.replace('/', '_') : pair.replace('/', '');
                const futuresApiSymbol = pair.replace('/', '_');

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

        // --- LÓGICA PARA MEXC (Híbrido: WebSocket para Futuros, REST para Spot) ---
        if (this.connectors.mexc) {
            const mexcPairs = this.pairsByExchange.mexc || [];
            if (mexcPairs.length > 0) {
                this.logger.info("[MarketMonitor] Configurando MEXC (Futuros: WebSocket, Spot: REST Polling)...");
                
                // 1. Configura o callback para receber dados do WebSocket de Futuros
                this.connectors.mexc.setTickerUpdateCallback(this.handleRealTimeUpdate.bind(this));
                
                // 2. Inicia a conexão WebSocket APENAS para Futuros
                const futuresSymbols = mexcPairs.map(p => this.marketData.mexc[p].futures.symbolApi);
                this.connectors.mexc.connectFuturesWebSocket(futuresSymbols);
                
                // 3. Inicia o loop de polling (buscas periódicas) APENAS para Spot
                const mexcConfig = this.globalConfig.mexc || {};
                const pollMexcSpot = () => this.pollSpotData("mexc", this.connectors.mexc);
                pollMexcSpot(); // Chamada inicial para obter dados imediatamente
                const spotInterval = parseInt(mexcConfig.spot_polling_interval_ms) || 2000;
                this.pollTimers.push(setInterval(pollMexcSpot, spotInterval));
            }
        }

        // --- LÓGICA PARA GATE.IO (Polling para ambos) ---
        if (this.connectors.gateio) {
            this.logger.info("[MarketMonitor] Configurando Gate.io para polling via API REST...");
            const gateioConfig = this.globalConfig.gateio || {};
            const pollGateioSpot = () => this.pollSpotData("gateio", this.connectors.gateio);
            const pollGateioFutures = () => this.pollFuturesData("gateio", this.connectors.gateio);
            
            pollGateioSpot();
            pollGateioFutures();
            
            const spotInterval = parseInt(gateioConfig.spot_polling_interval_ms) || 2500;
            const futuresInterval = parseInt(gateioConfig.futures_polling_interval_ms) || 2500;
            
            this.pollTimers.push(setInterval(pollGateioSpot, spotInterval));
            this.pollTimers.push(setInterval(pollGateioFutures, futuresInterval));
        }
    }

    // Callback para dados em tempo real (atualmente, só receberá Futuros da MEXC)
    handleRealTimeUpdate(exchange, marketType, data) {
        // Encontra o par no nosso formato padrão (ex: "BTC/USDT")
        const pairKey = Object.keys(this.marketData[exchange] || {}).find(key => 
            this.marketData[exchange][key][marketType]?.symbolApi === data.symbol
        );

        if (!pairKey) return;

        // Atualiza a estrutura de dados interna
        this.marketData[exchange][pairKey][marketType].ticker = data;
        if (data.volume24hQuote) this.marketData[exchange][pairKey][marketType].volume24hQuote = data.volume24hQuote;
        if (data.fundingRate) this.marketData[exchange][pairKey][marketType].fundingRate = data.fundingRate;

        this.triggerUpdate();
    }

    // Função de polling para dados de Spot (usada pela MEXC e Gate.io)
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
    
    // Função de polling para dados de Futuros (usada pela Gate.io)
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

    // Dispara a checagem de arbitragem e a atualização do frontend
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
        const flattenedData = [];
        for (const exchange in this.marketData) {
            for (const pair in this.marketData[exchange]) {
                const data = this.marketData[exchange][pair];
                flattenedData.push({
                    exchange: exchange,
                    pair: pair,
                    spotPrice: data.spot.ticker?.askPrice || null,
                    futuresPrice: data.futures.ticker?.askPrice || null,
                    spotBid: data.spot.ticker?.bidPrice || null,
                    futuresBid: data.futures.ticker?.bidPrice || null,
                    spotTimestamp: data.spot.ticker?.ts || null,
                    futuresTimestamp: data.futures.ticker?.ts || null
                });
            }
        }
        return flattenedData;
    }
}

module.exports = MarketMonitor;