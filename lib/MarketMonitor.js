```javascript
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
                connector.connectSpotWebSocket(filteredPairs, () => {
                    this.logger.info(`[MarketMonitor] Spot WebSocket for ${exchangeName} connected`);
                    this._pollWebSocketData(exchangeName, connector, 'spot');
                });
            }

            // WebSocket para Futuros
            if (typeof connector.connectFuturesWebSocket === 'function' && exchangeConfig.enable_futures_ws) {
                connector.connectFuturesWebSocket(filteredPairs, () => {
                    this.logger.info(`[MarketMonitor] Futures WebSocket for ${exchangeName} connected`);
                    this._pollWebSocketData(exchangeName, connector, 'futures');
                });
            }

            // Polling REST para Spot
            const spotPollingIntervalMs = parseInt(exchangeConfig.spot_polling_interval_ms) || 1500;
            if (typeof connector.getAllSpotBookTickers === 'function') {
                const pollSpotTickers = () => this.pollSpotData(exchangeName, connector);
                pollSpotTickers();
                this.pollTimers.push(setInterval(pollSpotTickers, spotPollingIntervalMs));
            }

            // Polling REST para Futuros
            const futuresPollingIntervalMs = parseInt(exchangeConfig.futures_polling_interval_ms) || 1500;
            if (typeof connector.getAllFuturesBookTickers === 'function') {
                const pollFuturesData = () => this.pollFuturesData(exchangeName, connector);
                pollFuturesData();
                this.pollTimers.push(setInterval(pollFuturesData, futuresPollingIntervalMs));
            }
        });
        this.logger.info("[MarketMonitor] All WebSocket and polling routines initiated.");
    }

    async pollSpotData(exchangeName, connector) {
        try {
            const [spotTickersMap, spotStatsMap] = await Promise.all([
                connector.getAllSpotBookTickers(),
                connector.getAllSpot24hrStats()
            ]);

            if (!spotTickersMap || spotTickersMap.size === 0) {
                this.logger.warn(`[MarketMonitor][${exchangeName.toUpperCase()}] No spot tickers received.`);
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

                if (spotStatsMap) {
                    const statsData = spotStatsMap.get(spotSymbol);
                    if (statsData) {
                        data.spot.volume24hQuote = statsData.quoteVolume24h;
                    }
                }
            });

            if (updatedCount > 0) {
                this.logger.info(`[MarketMonitor][${exchangeName.toUpperCase()}] Updated spot data for ${updatedCount} pairs via REST.`);
                this.engine.processMarketUpdate(this.marketData);
                if (this.broadcastMarketData) this.broadcastMarketData(this.marketData);
            }
        } catch (error) {
            this.logger.error(`[MarketMonitor][${exchangeName.toUpperCase()}] Error polling Spot data: ${error.message}`);
        }
    }

    async pollFuturesData(exchangeName, connector) {
        try {
            const futuresDataMap = await connector.getAllFuturesBookTickers();
            if (!futuresDataMap || futuresDataMap.size === 0) {
                this.logger.warn(`[MarketMonitor][${exchangeName.toUpperCase()}] No futures tickers received.`);
                return;
            }

            const pairsForThisExchange = this.pairsToMonitorByExchange[exchangeName] || [];
            let updatedCount = 0;

            pairsForThisExchange.forEach(pair => {
                if (this._isPairBlacklisted(exchangeName, pair)) return;
                this._initializeMarketData(exchangeName, pair);
                const data = this.marketData[exchangeName][pair];
                const futuresSymbol = data.futures.symbolApi.toUpperCase();
                const tickerData = futuresDataMap.get(futuresSymbol);

                if (tickerData) {
                    data.futures.ticker = {
                        bidPrice: tickerData.bidPrice,
                        askPrice: tickerData.askPrice,
                        bidQty: tickerData.bidQty,
                        askQty: tickerData.askQty,
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
                this.logger.info(`[MarketMonitor][${exchangeName.toUpperCase()}] Updated futures data for ${updatedCount} pairs via REST.`);
                this.engine.processMarketUpdate(this.marketData);
                if (this.broadcastMarketData) this.broadcastMarketData(this.marketData);
            }
        } catch (error) {
            this.logger.error(`[MarketMonitor][${exchangeName.toUpperCase()}] Error polling Futures data: ${error.message}`);
        }
    }

    _pollWebSocketData(exchangeName, connector, type) {
        const pollInterval = setInterval(() => {
            let updatedCount = 0;
            const pairsForThisExchange = this.pairsToMonitorByExchange[exchangeName] || [];
            if (type === 'spot') {
                const spotTickersMap = connector.spotTickerMap;
                if (spotTickersMap && spotTickersMap.size > 0) {
                    pairsForThisExchange.forEach(pair => {
                        if (this._isPairBlacklisted(exchangeName, pair)) return;
                        this._initializeMarketData(exchangeName, pair);
                        const data = this.marketData[exchangeName][pair];
                        const spotSymbol = data.spot.symbolApi.toUpperCase();
                        const tickerData = spotTick