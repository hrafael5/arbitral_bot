// /lib/MarketMonitor.js
class MarketMonitor {
    constructor(connectors, pairsToMonitorByExchange, engine, logger, globalConfig, broadcastCallback) {
        this.connectors = connectors;
        this.pairsToMonitorByExchange = pairsToMonitorByExchange;
        this.engine = engine;
        this.logger = logger;
        this.globalConfig = globalConfig;
        this.broadcastMarketData = broadcastCallback;
        this.marketData = {}; 
        this.pollTimers = [];
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

            // Lógica específica da exchange para formato de símbolo
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

    start() {
        this.logger.info(`[MarketMonitor] Starting monitor in hybrid WebSocket/Polling mode...`);

        Object.entries(this.connectors).forEach(([exchangeName, connector]) => {
            const exchangeConfig = this.globalConfig[exchangeName] || {};
            const pairsForThisExchange = this.pairsToMonitorByExchange[exchangeName] || [];

            if (pairsForThisExchange.length === 0) {
                this.logger.warn(`[MarketMonitor] No pairs to monitor for ${exchangeName.toUpperCase()}. Skipping.`);
                return;
            }
            
            // Inicializa a estrutura de dados para todos os pares da exchange
            pairsForThisExchange.forEach(pair => this._initializeMarketData(exchangeName, pair));
            
            // --- LÓGICA DE POLLING (PARA SPOT E FALLBACK) ---
            // O polling para dados SPOT é mantido, pois são menos voláteis e as APIs são estáveis.
            const spotPollingIntervalMs = parseInt(exchangeConfig.spot_polling_interval_ms) || 5000; // Aumentado para 5s
            if (typeof connector.getAllSpotBookTickers === 'function') {
                const pollSpotTickers = () => this.pollSpotData(exchangeName, connector);
                pollSpotTickers(); // Executa imediatamente uma vez
                this.pollTimers.push(setInterval(pollSpotTickers, spotPollingIntervalMs));
                this.logger.info(`[MarketMonitor] Spot polling for ${exchangeName.toUpperCase()} started every ${spotPollingIntervalMs}ms.`);
            }
            
            // --- LÓGICA DE WEBSOCKET (PARA FUTUROS) ---
            // Configura o callback para receber atualizações em tempo real do conector
            if (typeof connector.setTickerUpdateCallback === 'function') {
                connector.setTickerUpdateCallback(this.handleTickerUpdate.bind(this));
            }

            // Tenta conectar o WebSocket. Se o conector não suportar, ele simplesmente ignora.
            if (typeof connector.connectFuturesWebSocket === 'function') {
                connector.connectFuturesWebSocket(() => {
                    this.logger.info(`[MarketMonitor] WebSocket for ${exchangeName.toUpperCase()} is open. Subscribing to futures pairs...`);
                    
                    const futuresSymbolsToSubscribe = pairsForThisExchange
                        .map(pair => this.marketData[exchangeName][pair]?.futures?.symbolApi)
                        .filter(Boolean); // Filtra nulos/undefined

                    if (futuresSymbolsToSubscribe.length > 0 && typeof connector.subscribeToFuturesTickers === 'function') {
                        connector.subscribeToFuturesTickers(futuresSymbolsToSubscribe);
                    }
                });
            } else {
                 // Se o conector não tem WebSocket (como o GateConnector atual), usamos polling como fallback.
                 this.logger.warn(`[MarketMonitor] No WebSocket support found for ${exchangeName.toUpperCase()} futures. Using REST polling as fallback.`);
                 const futuresPollingIntervalMs = parseInt(exchangeConfig.futures_polling_interval_ms) || 2000; // Intervalo mais curto para o fallback
                 const pollFuturesData = () => this.pollFuturesData(exchangeName, connector);
                 pollFuturesData();
                 this.pollTimers.push(setInterval(pollFuturesData, futuresPollingIntervalMs));
            }
        });
        this.logger.info("[MarketMonitor] All monitoring routines initiated.");
    }

    /**
     * Handler central para todas as atualizações de ticker recebidas via WebSocket.
     * @param {string} exchangeName - O nome da exchange (ex: 'mexc').
     * @param {string} instrumentType - O tipo de instrumento (ex: 'futures', 'spot').
     * @param {object} tickerData - Os dados do ticker formatados pelo conector.
     */
    handleTickerUpdate(exchangeName, instrumentType, tickerData) {
        const exchangeData = this.marketData[exchangeName];
        if (!exchangeData) return;

        // Encontra o par correspondente ao símbolo da API (ex: BTC_USDT)
        const pair = Object.keys(exchangeData).find(p => 
            exchangeData[p][instrumentType]?.symbolApi === tickerData.symbol
        );

        if (!pair) return;

        const data = exchangeData[pair];
        
        if (instrumentType === 'futures') {
            data.futures.ticker = {
                bidPrice: tickerData.bidPrice,
                askPrice: tickerData.askPrice,
                ts: tickerData.ts
            };
            data.futures.volume24hQuote = tickerData.volume24hQuote;
            data.futures.fundingRate = tickerData.fundingRate;
        } else if (instrumentType === 'spot') {
            data.spot.ticker = tickerData;
        }

        // Após cada atualização, aciona o motor de arbitragem
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
                }

                if (spotStatsMap) {
                    const statsData = spotStatsMap.get(spotSymbol);
                    if (statsData) {
                        data.spot.volume24hQuote = statsData.quoteVolume24h;
                    }
                }
            });

            if (updatedCount > 0) {
                this.logger.debug(`[MarketMonitor][${exchangeName.toUpperCase()}] Updated spot data for ${updatedCount} pairs via polling.`);
                this.engine.processMarketUpdate(this.marketData);
                if (this.broadcastMarketData) this.broadcastMarketData();
            }
        } catch (error) {
            this.logger.error(`[MarketMonitor][${exchangeName.toUpperCase()}] Error polling Spot data: ${error.message}`);
        }
    }

    // Este método agora serve como fallback para conectores sem WebSocket.
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
                }
            });

            if (updatedCount > 0) {
                this.logger.debug(`[MarketMonitor][${exchangeName.toUpperCase()}] Updated futures data for ${updatedCount} pairs via polling.`);
                this.engine.processMarketUpdate(this.marketData);
                if (this.broadcastMarketData) this.broadcastMarketData();
            }
        } catch (error) {
            this.logger.error(`[MarketMonitor][${exchangeName.toUpperCase()}] Error polling Futures data: ${error.message}`);
        }
    }

    stop() {
        this.logger.info("[MarketMonitor] Stopping all monitoring routines...");
        this.pollTimers.forEach(timer => clearInterval(timer));
        this.pollTimers = [];
        Object.values(this.connectors).forEach(connector => {
            if (typeof connector.closeAll === 'function') {
                connector.closeAll();
            }
        });
        this.logger.info("[MarketMonitor] All monitoring stopped.");
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
