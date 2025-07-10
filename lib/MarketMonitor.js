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
        this.logger.info(`[MarketMonitor] Starting monitor with separate polling loops...`);
        Object.entries(this.connectors).forEach(([exchangeName, connector]) => {
            const exchangeConfig = this.globalConfig[exchangeName] || {};
            const pairsForThisExchange = this.pairsToMonitorByExchange[exchangeName] || [];

            if (pairsForThisExchange.length === 0) {
                this.logger.warn(`[MarketMonitor] No pairs to monitor for ${exchangeName.toUpperCase()}. Skipping polling.`);
                return;
            }
            
            pairsForThisExchange.forEach(pair => this._initializeMarketData(exchangeName, pair));
            
            const spotPollingIntervalMs = parseInt(exchangeConfig.spot_polling_interval_ms) || 1500;
            if (typeof connector.getAllSpotBookTickers === 'function') {
                const pollSpotTickers = () => this.pollSpotData(exchangeName, connector);
                pollSpotTickers(); // Executa imediatamente uma vez
                this.pollTimers.push(setInterval(pollSpotTickers, spotPollingIntervalMs));
            }
            
            const futuresPollingIntervalMs = parseInt(exchangeConfig.futures_polling_interval_ms) || 1500;
            if (typeof connector.getAllFuturesBookTickers === 'function') {
                const pollFuturesData = () => this.pollFuturesData(exchangeName, connector);
                pollFuturesData(); // Executa imediatamente uma vez
                this.pollTimers.push(setInterval(pollFuturesData, futuresPollingIntervalMs));
            }

            if (typeof connector.connectFuturesWebSocket === 'function') {
                connector.connectFuturesWebSocket(() => {
                    this.logger.info(`[MarketMonitor] WebSocket for ${exchangeName} (if used by connector) reported as open.`);
                });
            }
        });
        this.logger.info("[MarketMonitor] All polling routines initiated.");
    }

    async pollSpotData(exchangeName, connector) {
        try {
            const [spotTickersMap, spotStatsMap] = await Promise.all([
                connector.getAllSpotBookTickers(),
                connector.getAllSpot24hrStats()
            ]);

            if (!spotTickersMap || spotTickersMap.size === 0) return;
            
            const pairsForThisExchange = this.pairsToMonitorByExchange[exchangeName] || [];
            let updatedCount = 0; // A variável que estava faltando

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

                const statsData = spotStatsMap ? spotStatsMap.get(spotSymbol) : null;
                if (statsData) {
                    data.spot.volume24hQuote = statsData.quoteVolume24h;
                }
            });

            if (updatedCount > 0) {
                this.logger.info(`[MarketMonitor][${exchangeName.toUpperCase()}] Updated spot data for ${updatedCount} pairs.`);
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
            let updatedCount = 0; // A variável que estava faltando

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
                this.logger.info(`[MarketMonitor][${exchangeName.toUpperCase()}] Updated futures data for ${updatedCount} pairs.`);
                this.engine.processMarketUpdate(this.marketData);
                if (this.broadcastMarketData) this.broadcastMarketData();
            }
        } catch (error) {
            this.logger.error(`[MarketMonitor][${exchangeName.toUpperCase()}] Error polling Futures data: ${error.message}`);
        }
    }

    stop() {
        this.logger.info("[MarketMonitor] Stopping all polling routines...");
        this.pollTimers.forEach(timer => clearInterval(timer));
        this.pollTimers = [];
        this.logger.info("[MarketMonitor] All market polling stopped.");
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