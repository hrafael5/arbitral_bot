// /lib/MarketMonitor.js - VERSÃO FINAL E DEFINITIVA
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
        this.logger.info('[MarketMonitor] Initialized. Will monitor exchanges: ' + Object.keys(this.connectors).join(', ') + '.');
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

    _isPairBlacklisted(exchange, pair) {
        const [baseAsset] = pair.split("/");
        const blacklistedTokens = this.globalConfig[exchange]?.blacklisted_tokens || [];
        return blacklistedTokens.some(token => baseAsset.toUpperCase() === token.toUpperCase());
    }

    start() {
        this.logger.info(`[MarketMonitor] Starting monitor with WebSocket and polling loops...`);
        Object.entries(this.connectors).forEach(([exchangeName, connector]) => {
            const exchangeConfig = this.globalConfig[exchangeName] || {};
            const pairsForThisExchange = this.pairsToMonitorByExchange[exchangeName] || [];
            const filteredPairs = pairsForThisExchange.filter(pair => !this._isPairBlacklisted(exchangeName, pair));

            if (filteredPairs.length === 0) {
                this.logger.warn(`[MarketMonitor] No valid pairs to monitor for ${exchangeName.toUpperCase()} after blacklist filter.`);
                return;
            }

            filteredPairs.forEach(pair => this._initializeMarketData(exchangeName, pair));

            // --- LÓGICA DE WEBSOCKET (PARA PREÇOS EM TEMPO REAL) ---
            if (typeof connector.connectSpotWebSocket === 'function' && exchangeConfig.enable_spot_ws) {
                connector.connectSpotWebSocket(filteredPairs, () => {
                    this.logger.info(`[MarketMonitor] Spot WebSocket for ${exchangeName} connected.`);
                    const wsPoller = this._pollWebSocketData(exchangeName, connector, 'spot');
                    this.pollTimers.push(wsPoller);
                });
            }
            if (typeof connector.connectFuturesWebSocket === 'function' && exchangeConfig.enable_futures_ws) {
                connector.connectFuturesWebSocket(filteredPairs, () => {
                    this.logger.info(`[MarketMonitor] Futures WebSocket for ${exchangeName} connected.`);
                    const wsPoller = this._pollWebSocketData(exchangeName, connector, 'futures');
                    this.pollTimers.push(wsPoller);
                });
            }

            // --- LÓGICA DE POLLING REST (PARA DADOS ESTATÍSTICOS E FALLBACK DE PREÇOS) ---
            const pollingInterval = parseInt(exchangeConfig.spot_polling_interval_ms) || 1500;
            const pollData = () => this.pollRestData(exchangeName, connector);
            pollData(); // Primeira chamada imediata
            this.pollTimers.push(setInterval(pollData, pollingInterval));
        });
        this.logger.info("[MarketMonitor] All WebSocket and polling routines initiated.");
    }
    
    // Função unificada para buscar todos os dados REST
    async pollRestData(exchangeName, connector) {
        try {
            const [spotTickers, spotStats, futuresTickers] = await Promise.all([
                connector.getAllSpotBookTickers ? connector.getAllSpotBookTickers() : Promise.resolve(null),
                connector.getAllSpot24hrStats ? connector.getAllSpot24hrStats() : Promise.resolve(null),
                connector.getAllFuturesBookTickers ? connector.getAllFuturesBookTickers() : Promise.resolve(null) // Esta chamada já inclui stats de futuros
            ]);

            const pairsForThisExchange = this.pairsToMonitorByExchange[exchangeName] || [];
            pairsForThisExchange.forEach(pair => {
                if (this._isPairBlacklisted(exchangeName, pair)) return;
                this._initializeMarketData(exchangeName, pair);
                
                const data = this.marketData[exchangeName][pair];

                // Atualiza dados de Spot
                const spotSymbol = data.spot.symbolApi.toUpperCase();
                if (spotTickers) {
                    const tickerData = spotTickers.get(spotSymbol);
                    // Só atualiza o ticker se o WS não estiver a fornecer
                    if (tickerData && !data.spot.ticker) {
                        data.spot.ticker = tickerData;
                    }
                }
                if (spotStats) {
                    const statsData = spotStats.get(spotSymbol);
                    if (statsData) {
                        data.spot.volume24hQuote = statsData.quoteVolume24h;
                    }
                }

                // Atualiza dados de Futuros
                const futuresSymbol = data.futures.symbolApi.toUpperCase();
                if (futuresTickers) {
                    const tickerData = futuresTickers.get(futuresSymbol);
                    if (tickerData) {
                        // Só atualiza o ticker se o WS não estiver a fornecer
                        if (!data.futures.ticker) {
                           data.futures.ticker = tickerData;
                        }
                        data.futures.volume24hQuote = tickerData.volume24hQuote;
                        data.futures.fundingRate = tickerData.fundingRate;
                    }
                }
            });
        } catch (error) {
            this.logger.error(`[MarketMonitor][${exchangeName.toUpperCase()}] Error polling REST data: ${error.message}`);
        }
    }

    _pollWebSocketData(exchangeName, connector, type) {
        const pollInterval = 300;
        return setInterval(() => {
            const tickerMap = type === 'spot' ? connector.spotTickerMap : connector.futuresTickerMap;
            if (!tickerMap || tickerMap.size === 0) return;

            const pairsForThisExchange = this.pairsToMonitorByExchange[exchangeName] || [];
            let updatedCount = 0;

            pairsForThisExchange.forEach(pair => {
                if (this._isPairBlacklisted(exchangeName, pair)) return;
                this._initializeMarketData(exchangeName, pair);

                const data = this.marketData[exchangeName][pair];
                const symbolApi = (type === 'spot' ? data.spot.symbolApi : data.futures.symbolApi).toUpperCase();
                const tickerData = tickerMap.get(symbolApi);

                if (tickerData) {
                    if (type === 'spot') data.spot.ticker = tickerData;
                    else data.futures.ticker = tickerData;
                    updatedCount++;
                }
            });

            if (updatedCount > 0) {
                this.engine.processMarketUpdate(this.marketData);
                if (this.broadcastMarketData) this.broadcastMarketData();
            }
        }, pollInterval);
    }

    stop() {
        this.logger.info("[MarketMonitor] Stopping all polling timers...");
        this.pollTimers.forEach(timer => clearInterval(timer));
        this.pollTimers = [];
        Object.values(this.connectors).forEach(connector => {
            if (typeof connector.closeAll === 'function') {
                connector.closeAll();
            }
        });
        this.logger.info("[MarketMonitor] All activities stopped.");
    }

    getAllMarketData() {
        return this.marketData;
    }
}

module.exports = MarketMonitor;