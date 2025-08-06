// /lib/MarketMonitor.js (VERSÃO WEBSOCKET)

class MarketMonitor {
    constructor(connectors, pairsToMonitorByExchange, engine, logger, globalConfig, broadcastCallback) {
        this.connectors = connectors;
        this.pairsToMonitorByExchange = pairsToMonitorByExchange;
        this.engine = engine;
        this.logger = logger;
        this.globalConfig = globalConfig;
        this.broadcastMarketData = broadcastCallback;
        this.marketData = {};
        this.pollTimers = []; // Ainda usado para a Gate.io
        this.logger.info(`[MarketMonitor] Initialized. Will monitor exchanges: ${Object.keys(this.connectors).join(', ')}.`);
    }

    _initializeMarketData(exchange, pair) {
        if (!this.marketData[exchange]) {
            this.marketData[exchange] = {};
        }
        if (!this.marketData[exchange][pair]) {
            const [baseAsset, quoteAsset] = pair.split("/");
            let spotSymbolApi = `${baseAsset}${quoteAsset}`;
            let futuresSymbolApi = `${baseAsset}_${quoteAsset}`;

            if (exchange.toLowerCase() === 'gateio') {
                spotSymbolApi = `${baseAsset}_${quoteAsset}`; 
            }
            
            this.marketData[exchange][pair] = {
                pair: pair,
                spot: { symbolApi: spotSymbolApi.toUpperCase(), ticker: null, volume24hQuote: null },
                futures: { symbolApi: futuresSymbolApi.toUpperCase(), ticker: null, volume24hQuote: null, fundingRate: null }
            };
        }
    }

    // --- ALTERADO: Método start() agora inicia os WebSockets ---
    start() {
        this.logger.info(`[MarketMonitor] Starting monitor in hybrid mode (WebSocket + Polling)...`);
        
        // Inicializa a estrutura de dados para todos os pares
        Object.entries(this.pairsToMonitorByExchange).forEach(([exchange, pairs]) => {
            pairs.forEach(pair => this._initializeMarketData(exchange, pair));
        });

        // Configura MEXC para usar WebSocket
        if (this.connectors.mexc) {
            const mexcPairs = this.pairsToMonitorByExchange.mexc || [];
            if (mexcPairs.length > 0) {
                this.logger.info("[MarketMonitor] Setting up MEXC for WebSocket streaming...");
                this.connectors.mexc.setTickerUpdateCallback(this.handleRealTimeUpdate.bind(this));
                
                const spotSymbols = mexcPairs.map(p => this.marketData.mexc[p].spot.symbolApi);
                const futuresSymbols = mexcPairs.map(p => this.marketData.mexc[p].futures.symbolApi);

                this.connectors.mexc.connectSpotWebSocket(spotSymbols);
                this.connectors.mexc.connectFuturesWebSocket(futuresSymbols);
            }
        }

        // Configura Gate.io para continuar com Polling (por enquanto)
        if (this.connectors.gateio) {
            this.logger.info("[MarketMonitor] Setting up Gate.io for REST polling...");
            const gateioConfig = this.globalConfig.gateio || {};
            const pollGateioSpot = () => this.pollSpotData('gateio', this.connectors.gateio);
            const pollGateioFutures = () => this.pollFuturesData('gateio', this.connectors.gateio);
            
            pollGateioSpot();
            pollGateioFutures();
            this.pollTimers.push(setInterval(pollGateioSpot, parseInt(gateioConfig.spot_polling_interval_ms) || 2000));
            this.pollTimers.push(setInterval(pollGateioFutures, parseInt(gateioConfig.futures_polling_interval_ms) || 2000));
        }
    }

    // NOVO: Handler central para receber todas as atualizações em tempo real
    handleRealTimeUpdate(exchangeName, instrumentType, data) {
        const symbolApi = data.symbol;
        const pair = Object.keys(this.marketData[exchangeName] || {}).find(p => 
            this.marketData[exchangeName][p][instrumentType]?.symbolApi === symbolApi
        );

        if (!pair) return; // Ignora atualização de um par que não monitoramos

        const pairData = this.marketData[exchangeName][pair];
        
        if (instrumentType === 'spot') {
            pairData.spot.ticker = {
                bidPrice: data.bidPrice, askPrice: data.askPrice, ts: data.ts
            };
        } else if (instrumentType === 'futures') {
            pairData.futures.ticker = {
                bidPrice: data.bidPrice, askPrice: data.askPrice, ts: data.ts
            };
            pairData.futures.volume24hQuote = data.volume24hQuote;
            pairData.futures.fundingRate = data.fundingRate;
        }

        // A cada atualização recebida, dispara o motor e a transmissão para o frontend
        this.engine.processMarketUpdate(this.marketData);
        if (this.broadcastMarketData) this.broadcastMarketData();
    }

    async pollSpotData(exchangeName, connector) {
        try {
            const [spotTickersMap, spotStatsMap] = await Promise.all([
                connector.getAllSpotBookTickers(),
                connector.getAllSpot24hrStats()
            ]);

            if (!spotTickersMap || spotTickersMap.size === 0) return;
            
            const pairsForThisExchange = this.pairsToMonitorByExchange[exchangeName] || [];
            let updatedCount = 0;

            pairsForThisExchange.forEach(pair => {
                this._initializeMarketData(exchangeName, pair);
                const data = this.marketData[exchangeName][pair];
                const spotSymbol = data.spot.symbolApi.toUpperCase();

                const tickerData = spotTickersMap.get(spotSymbol);
                if (tickerData) {
                    data.spot.ticker = tickerData;
                    updatedCount++;
                } else {
                    data.spot.ticker = null;
                }

                if (spotStatsMap) {
                    const statsData = spotStatsMap.get(spotSymbol);
                    if (statsData) {
                        data.spot.volume24hQuote = statsData.quoteVolume24h;
                    }
                }
            });

            if (updatedCount > 0) {
                this.logger.debug(`[MarketMonitor][${exchangeName.toUpperCase()}] Updated spot data for ${updatedCount} pairs.`);
                this.engine.processMarketUpdate(this.marketData);
                if (this.broadcastMarketData) this.broadcastMarketData();
            }
        } catch (error) {
            this.logger.error(`[MarketMonitor][${exchangeName.toUpperCase()}] Error polling Spot data: ${error.message}`);
        }
    }

    async pollFuturesData(exchangeName, connector) {
        try {
            const futuresDataMap = await connector.getAllFuturesBookTickers();
            if (!futuresDataMap || futuresDataMap.size === 0) return;

            const pairsForThisExchange = this.pairsToMonitorByExchange[exchangeName] || [];
            let updatedCount = 0;

            pairsForThisExchange.forEach(pair => {
                this._initializeMarketData(exchangeName, pair);
                const data = this.marketData[exchangeName][pair];
                const futuresSymbol = data.futures.symbolApi.toUpperCase();
                const tickerData = futuresDataMap.get(futuresSymbol);

                if (tickerData) {
                    data.futures.ticker = {
                        bidPrice: tickerData.bidPrice, askPrice: tickerData.askPrice,
                        bidQty: tickerData.bidQty, askQty: tickerData.askQty,
                        ts: tickerData.ts
                    };
                    data.futures.volume24hQuote = tickerData.volume24hQuote;
                    data.futures.fundingRate = tickerData.fundingRate;
                    updatedCount++;
                } else {
                    data.futures.ticker = null;
                    data.futures.volume24hQuote = null;
                    data.futures.fundingRate = null;
                }
            });

            if (updatedCount > 0) {
                this.logger.debug(`[MarketMonitor][${exchangeName.toUpperCase()}] Updated futures data for ${updatedCount} pairs.`);
                this.engine.processMarketUpdate(this.marketData);
                if (this.broadcastMarketData) this.broadcastMarketData();
            }
        } catch (error) {
            this.logger.error(`[MarketMonitor][${exchangeName.toUpperCase()}] Error polling Futures data: ${error.message}`);
        }
    }
    
    stop() {
        this.logger.info("[MarketMonitor] Stopping all routines...");
        this.pollTimers.forEach(timer => clearInterval(timer));
        this.pollTimers = [];
        Object.values(this.connectors).forEach(c => {
            if (typeof c.closeAll === 'function') c.closeAll();
        });
        this.logger.info("[MarketMonitor] All routines stopped.");
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