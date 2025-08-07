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
        // LINHA CORRIGIDA:
        this.logger.info('[MarketMonitor] Initialized. Will monitor exchanges: ' + Object.keys(this.connectors).join(', ') + '.');
    }

    _initializeMarketData(exchange, pair) {
        if (!this.marketData[exchange]) {
            this.marketData[exchange] = {};
        }
        if (!this.marketData[exchange][pair]) {
            const [baseAsset, quoteAsset] = pair.split("/");
            let spotSymbolApi = `${baseAsset}${quoteAsset}`; // Formato MEXC (BTCUSDT)
            let futuresSymbolApi = `${baseAsset}_${quoteAsset}`; // Formato MEXC e Gate.io (BTC_USDT)
            if (exchange.toLowerCase() === 'gateio') {
                spotSymbolApi = `${baseAsset}_${quoteAsset}`; // Formato Gate.io (BTC_USDT)
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
                this.logger.warn(`[MarketMonitor] No valid pairs to monitor for ${exchangeName.toUpperCase()} after blacklist filter. Skipping.`);
                return;
            }

            filteredPairs.forEach(pair => this._initializeMarketData(exchangeName, pair));

            // WebSocket para Spot
            if (typeof connector.connectSpotWebSocket === 'function' && exchangeConfig.enable_spot_ws) {
                this.logger.info(`[MarketMonitor] Attempting to connect to Spot WebSocket for ${exchangeName}...`);
                connector.connectSpotWebSocket(filteredPairs, () => {
                    this.logger.info(`[MarketMonitor] Spot WebSocket for ${exchangeName} connected. Starting data polling.`);
                    const wsPoller = this._pollWebSocketData(exchangeName, connector, 'spot');
                    this.pollTimers.push(wsPoller);
                });
            }

            // WebSocket para Futuros
            if (typeof connector.connectFuturesWebSocket === 'function' && exchangeConfig.enable_futures_ws) {
                this.logger.info(`[MarketMonitor] Attempting to connect to Futures WebSocket for ${exchangeName}...`);
                connector.connectFuturesWebSocket(filteredPairs, () => {
                    this.logger.info(`[MarketMonitor] Futures WebSocket for ${exchangeName} connected. Starting data polling.`);
                    const wsPoller = this._pollWebSocketData(exchangeName, connector, 'futures');
                    this.pollTimers.push(wsPoller);
                });
            }

            // Polling REST para Spot (como fallback ou se WS estiver desabilitado)
            if (!exchangeConfig.enable_spot_ws && typeof connector.getAllSpotBookTickers === 'function') {
                const spotPollingIntervalMs = parseInt(exchangeConfig.spot_polling_interval_ms) || 1500;
                const pollSpotTickers = () => this.pollSpotData(exchangeName, connector);
                pollSpotTickers(); // Primeira chamada imediata
                this.pollTimers.push(setInterval(pollSpotTickers, spotPollingIntervalMs));
            }

            // Polling REST para Futuros (como fallback ou se WS estiver desabilitado)
            if (!exchangeConfig.enable_futures_ws && typeof connector.getAllFuturesBookTickers === 'function') {
                const futuresPollingIntervalMs = parseInt(exchangeConfig.futures_polling_interval_ms) || 1500;
                const pollFuturesData = () => this.pollFuturesData(exchangeName, connector);
                pollFuturesData(); // Primeira chamada imediata
                this.pollTimers.push(setInterval(pollFuturesData, futuresPollingIntervalMs));
            }
        });
        this.logger.info("[MarketMonitor] All WebSocket and polling routines initiated.");
    }

    async pollSpotData(exchangeName, connector) {
        try {
            const spotTickersMap = await connector.getAllSpotBookTickers();

            if (!spotTickersMap || spotTickersMap.size === 0) {
                this.logger.warn(`[MarketMonitor][${exchangeName.toUpperCase()}] No spot tickers received via REST.`);
                return;
            }

            const pairsForThisExchange = this.pairsToMonitorByExchange[exchangeName] || [];
            let updatedCount = 0;

            pairsForThisExchange.forEach(pair => {
                if (this._isPairBlacklisted(exchangeName, pair)) return;
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
            });

            if (updatedCount > 0) {
                this.logger.info(`[MarketMonitor][${exchangeName.toUpperCase()}] Updated spot data for ${updatedCount} pairs via REST.`);
                this.engine.processMarketUpdate(this.marketData);
                if (this.broadcastMarketData) this.broadcastMarketData();
            }
        } catch (error) {
            this.logger.error(`[MarketMonitor][${exchangeName.toUpperCase()}] Error polling Spot data via REST: ${error.message}`);
        }
    }

    async pollFuturesData(exchangeName, connector) {
        try {
            const futuresDataMap = await connector.getAllFuturesBookTickers();
            if (!futuresDataMap || futuresDataMap.size === 0) {
                this.logger.warn(`[MarketMonitor][${exchangeName.toUpperCase()}] No futures tickers received via REST.`);
                return;
            }

            const pairsForThisExchange = this.pairsToMonitorByExchange[exchangeName] || [];
            let updatedCount = 0;

            for (const pair of pairsForThisExchange) {
                 if (this._isPairBlacklisted(exchangeName, pair)) continue;
                this._initializeMarketData(exchangeName, pair);
                const data = this.marketData[exchangeName][pair];
                const futuresSymbol = data.futures.symbolApi.toUpperCase();
                const tickerData = futuresDataMap.get(futuresSymbol);

                if (tickerData) {
                    data.futures.ticker = tickerData;
                    updatedCount++;
                } else {
                    data.futures.ticker = null;
                }
            }

            if (updatedCount > 0) {
                this.logger.info(`[MarketMonitor][${exchangeName.toUpperCase()}] Updated futures data for ${updatedCount} pairs via REST.`);
                this.engine.processMarketUpdate(this.marketData);
                if (this.broadcastMarketData) this.broadcastMarketData();
            }
        } catch (error) {
            this.logger.error(`[MarketMonitor][${exchangeName.toUpperCase()}] Error polling Futures data via REST: ${error.message}`);
        }
    }

    _pollWebSocketData(exchangeName, connector, type) {
        const pollInterval = 1000; // Processar dados recebidos a cada segundo
        return setInterval(() => {
            let updatedCount = 0;
            const pairsForThisExchange = this.pairsToMonitorByExchange[exchangeName] || [];
            const tickerMap = type === 'spot' ? connector.getSpotTickerMap() : connector.getFuturesTickerMap();

            if (!tickerMap || tickerMap.size === 0) {
                return;
            }

            pairsForThisExchange.forEach(pair => {
                if (this._isPairBlacklisted(exchangeName, pair)) return;
                this._initializeMarketData(exchangeName, pair);

                const data = this.marketData[exchangeName][pair];
                const symbolApi = (type === 'spot' ? data.spot.symbolApi : data.futures.symbolApi).toUpperCase();
                const tickerData = tickerMap.get(symbolApi);

                if (tickerData) {
                    if(type === 'spot') {
                        data.spot.ticker = tickerData;
                    } else {
                        data.futures.ticker = tickerData;
                    }
                    updatedCount++;
                }
            });

            if (updatedCount > 0) {
                // this.logger.info(`[MarketMonitor][${exchangeName.toUpperCase()}][${type.toUpperCase()}] Processed ${updatedCount} updates from WebSocket.`);
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
            if (typeof connector.disconnect === 'function') {
                connector.disconnect();
            }
        });
        this.logger.info("[MarketMonitor] All activities stopped.");
    }



    getAllMarketData() {
        return this.marketData;
    }
}

module.exports = MarketMonitor;