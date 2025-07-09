// /home/ubuntu/mexc_bot/lib/MarketMonitor.js
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

            if (exchange.toLowerCase() === 'gateio') {
                spotSymbolApi = `${baseAsset}_${quoteAsset}`; 
            }
            
            this.marketData[exchange][pair] = {
                pair: pair,
                spot: { symbolApi: spotSymbolApi.toUpperCase(), ticker: null, volume24hQuote: null },
                futures: { symbolApi: futuresSymbolApi.toUpperCase(), ticker: null, volume24hQuote: null, fundingRate: null }
            };
            this.logger.debug(`[MarketMonitor] Initialized market data for ${exchange} - ${pair} (Spot API Symbol: ${spotSymbolApi}, Futures API Symbol: ${futuresSymbolApi})`);
        }
    }

    start() {
        this.logger.info(`[MarketMonitor] Starting monitor...`);
        Object.entries(this.connectors).forEach(([exchangeName, connector]) => {
            const exchangeConfig = this.globalConfig[exchangeName] || {};
            const pairsForThisExchange = this.pairsToMonitorByExchange[exchangeName] || [];

            if (pairsForThisExchange.length === 0) {
                this.logger.warn(`[MarketMonitor] No pairs to monitor for ${exchangeName.toUpperCase()}. Skipping polling setup for this exchange.`);
                return;
            }
            this.logger.info(`[MarketMonitor] Setting up polling for ${exchangeName.toUpperCase()} for ${pairsForThisExchange.length} pair(s).`);
            pairsForThisExchange.forEach(pair => this._initializeMarketData(exchangeName, pair));

            const spotPollingIntervalMs = parseInt(exchangeConfig.spot_polling_interval_ms) || 7000;
            if (typeof connector.getAllSpotBookTickers === 'function') {
                const pollSpotTickers = () => this.pollSpotBookTickers(exchangeName, connector);
                pollSpotTickers();
                this.pollTimers.push(setInterval(pollSpotTickers, spotPollingIntervalMs));
            }
            if (typeof connector.getAllSpot24hrStats === 'function') {
                const pollSpotStats = () => this.pollSpot24hrStats(exchangeName, connector);
                pollSpotStats(); 
                this.pollTimers.push(setInterval(pollSpotStats, spotPollingIntervalMs + 500)); 
            }

            const futuresPollingIntervalMs = parseInt(exchangeConfig.futures_polling_interval_ms) || 7000;
            if (typeof connector.getAllFuturesBookTickers === 'function') {
                const pollFuturesData = () => this.pollAllFuturesData(exchangeName, connector);
                pollFuturesData();
                this.pollTimers.push(setInterval(pollFuturesData, futuresPollingIntervalMs));
            }
            if (typeof connector.connectFuturesWebSocket === 'function') {
                connector.connectFuturesWebSocket(() => {
                    this.logger.info(`[MarketMonitor] WebSocket for ${exchangeName} futures (if used by connector) reported as open.`);
                });
            }
        });
        this.logger.info("[MarketMonitor] All polling routines initiated.");
    }

    stop() {
        this.logger.info("[MarketMonitor] Stopping all polling routines...");
        this.pollTimers.forEach(timer => clearInterval(timer));
        this.pollTimers = [];
        this.logger.info("[MarketMonitor] All market polling stopped.");
    }

    async pollSpotBookTickers(exchangeName, connector) {
        try {
            const allSpotTickersMap = await connector.getAllSpotBookTickers();
            this.logger.debug(`[MarketMonitor][${exchangeName.toUpperCase()}_DEBUG] pollSpotBookTickers raw response map size: ${allSpotTickersMap ? allSpotTickersMap.size : 'null/empty'}`);
            if (!allSpotTickersMap || allSpotTickersMap.size === 0) {
                 if(allSpotTickersMap === null) this.logger.warn(`[MarketMonitor][${exchangeName.toUpperCase()}] getAllSpotBookTickers returned null.`);
                 else if(allSpotTickersMap.size === 0) this.logger.warn(`[MarketMonitor][${exchangeName.toUpperCase()}] getAllSpotBookTickers returned empty map.`);
                return;
            }

            const pairsForThisExchange = this.pairsToMonitorByExchange[exchangeName] || [];
            let updatedCount = 0;
            pairsForThisExchange.forEach(pair => {
                this._initializeMarketData(exchangeName, pair); 
                const spotSymbolForApiLookup = this.marketData[exchangeName][pair].spot.symbolApi;
                const tickerData = allSpotTickersMap.get(spotSymbolForApiLookup.toUpperCase());

                if (tickerData) {
                    this.marketData[exchangeName][pair].spot.ticker = tickerData;
                    updatedCount++;
                } else {
                    if (this.marketData[exchangeName]?.[pair]?.spot) this.marketData[exchangeName][pair].spot.ticker = null;
                }
            });
            if (updatedCount > 0) {
                this.logger.info(`[MarketMonitor][${exchangeName.toUpperCase()}] Updated spot tickers for ${updatedCount} pairs.`);
                this.engine.processMarketUpdate(this.marketData); 
                if (this.broadcastMarketData) this.broadcastMarketData();
            }
        } catch (error) {
            this.logger.error(`[MarketMonitor][${exchangeName.toUpperCase()}] Error polling Spot book tickers: ${error.message}`);
        }
    }

    async pollSpot24hrStats(exchangeName, connector) {
        try {
            const allSpotStatsMap = await connector.getAllSpot24hrStats();
            this.logger.debug(`[MarketMonitor][${exchangeName.toUpperCase()}_DEBUG] pollSpot24hrStats raw response map size: ${allSpotStatsMap ? allSpotStatsMap.size : 'null/empty'}`);
            if (!allSpotStatsMap || allSpotStatsMap.size === 0) return;
            
            const pairsForThisExchange = this.pairsToMonitorByExchange[exchangeName] || [];
            let updatedCount = 0;
            pairsForThisExchange.forEach(pair => {
                this._initializeMarketData(exchangeName, pair);
                const spotSymbolForApiLookup = this.marketData[exchangeName][pair].spot.symbolApi;
                const statsData = allSpotStatsMap.get(spotSymbolForApiLookup.toUpperCase());

                if (statsData) {
                    this.marketData[exchangeName][pair].spot.volume24hQuote = statsData.quoteVolume24h;
                    updatedCount++;
                } else {
                    if (this.marketData[exchangeName]?.[pair]?.spot) this.marketData[exchangeName][pair].spot.volume24hQuote = null;
                }
            });
            if (updatedCount > 0) this.logger.debug(`[MarketMonitor][${exchangeName.toUpperCase()}] Updated spot 24hr stats for ${updatedCount} pairs.`);
        } catch (error) {
            this.logger.error(`[MarketMonitor][${exchangeName.toUpperCase()}] Error polling Spot 24hr stats: ${error.message}`);
        }
    }

    async pollAllFuturesData(exchangeName, connector) {
        try {
            const allFuturesDataMap = await connector.getAllFuturesBookTickers();
            this.logger.debug(`[MarketMonitor][${exchangeName.toUpperCase()}_DEBUG] pollAllFuturesData raw response map size: ${allFuturesDataMap ? allFuturesDataMap.size : 'null/empty'}`);
             if (!allFuturesDataMap || allFuturesDataMap.size === 0) {
                 if(allFuturesDataMap === null) this.logger.warn(`[MarketMonitor][${exchangeName.toUpperCase()}] getAllFuturesBookTickers returned null.`);
                 else if(allFuturesDataMap.size === 0) this.logger.warn(`[MarketMonitor][${exchangeName.toUpperCase()}] getAllFuturesBookTickers returned empty map.`);
                return;
            }

            const pairsForThisExchange = this.pairsToMonitorByExchange[exchangeName] || [];
            let updatedCount = 0;
            pairsForThisExchange.forEach(pair => {
                this._initializeMarketData(exchangeName, pair);
                const futuresSymbolForApiLookup = this.marketData[exchangeName][pair].futures.symbolApi;
                const data = allFuturesDataMap.get(futuresSymbolForApiLookup.toUpperCase());

                if (data) {
                    this.marketData[exchangeName][pair].futures.ticker = {
                        bidPrice: data.bidPrice, askPrice: data.askPrice,
                        bidQty: data.bidQty, askQty: data.askQty,
                        ts: data.ts
                    };
                    this.marketData[exchangeName][pair].futures.volume24hQuote = data.volume24hQuote;
                    this.marketData[exchangeName][pair].futures.fundingRate = data.fundingRate;
                    updatedCount++;
                } else {
                    if (this.marketData[exchangeName]?.[pair]?.futures) {
                        this.marketData[exchangeName][pair].futures.ticker = null;
                        this.marketData[exchangeName][pair].futures.volume24hQuote = null;
                        this.marketData[exchangeName][pair].futures.fundingRate = null;
                    }
                }
            });
             if (updatedCount > 0) {
                this.logger.info(`[MarketMonitor][${exchangeName.toUpperCase()}] Updated futures data for ${updatedCount} pairs.`);
                this.engine.processMarketUpdate(this.marketData);
                if (this.broadcastMarketData) this.broadcastMarketData();
            }
        } catch (error) {
            this.logger.error(`[MarketMonitor][${exchangeName.toUpperCase()}] Error polling Futures data: ${error.message}`);
        }
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