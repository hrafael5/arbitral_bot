// /lib/MarketMonitor.js - VERSÃO DEFINITIVA
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
        if (!this.marketData[exchange]) this.marketData[exchange] = {};
        if (!this.marketData[exchange][pair]) {
            const [baseAsset, quoteAsset] = pair.split("/");
            let spotSymbolApi = (exchange.toLowerCase() === 'gateio') ? `${baseAsset}_${quoteAsset}` : `${baseAsset}${quoteAsset}`;
            let futuresSymbolApi = `${baseAsset}_${quoteAsset}`;
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

            if (filteredPairs.length === 0) return;
            filteredPairs.forEach(pair => this._initializeMarketData(exchangeName, pair));

            if (typeof connector.connectSpotWebSocket === 'function' && exchangeConfig.enable_spot_ws) {
                connector.connectSpotWebSocket(filteredPairs, () => {
                    this.logger.info(`[MarketMonitor] Spot WebSocket for ${exchangeName} connected.`);
                    this.pollTimers.push(this._pollWebSocketData(exchangeName, connector, 'spot'));
                });
            }
            if (typeof connector.connectFuturesWebSocket === 'function' && exchangeConfig.enable_futures_ws) {
                connector.connectFuturesWebSocket(filteredPairs, () => {
                    this.logger.info(`[MarketMonitor] Futures WebSocket for ${exchangeName} connected.`);
                    this.pollTimers.push(this._pollWebSocketData(exchangeName, connector, 'futures'));
                });
            }

            const pollingInterval = parseInt(exchangeConfig.spot_polling_interval_ms) || 2500;
            const pollData = () => this.pollRestData(exchangeName, connector);
            pollData();
            this.pollTimers.push(setInterval(pollData, pollingInterval));
        });
        this.logger.info("[MarketMonitor] All WebSocket and polling routines initiated.");
    }
    
    async pollRestData(exchangeName, connector) {
        try {
            const [spotData, futuresData] = await Promise.all([
                connector.getAllSpotData ? connector.getAllSpotData() : Promise.resolve(new Map()),
                connector.getAllFuturesData ? connector.getAllFuturesData() : Promise.resolve(new Map())
            ]);

            const pairsForThisExchange = this.pairsToMonitorByExchange[exchangeName] || [];
            pairsForThisExchange.forEach(pair => {
                if (this._isPairBlacklisted(exchangeName, pair)) return;
                this._initializeMarketData(exchangeName, pair);
                
                const data = this.marketData[exchangeName][pair];

                const spotSymbol = data.spot.symbolApi.toUpperCase();
                const spotInfo = spotData.get(spotSymbol);
                if (spotInfo) {
                    if (!data.spot.ticker) data.spot.ticker = { bidPrice: spotInfo.bidPrice, askPrice: spotInfo.askPrice, bidQty: spotInfo.bidQty, askQty: spotInfo.askQty, ts: spotInfo.ts };
                    data.spot.volume24hQuote = spotInfo.quoteVolume24h;
                }

                const futuresSymbol = data.futures.symbolApi.toUpperCase();
                const futuresInfo = futuresData.get(futuresSymbol);
                if (futuresInfo) {
                    if (!data.futures.ticker) data.futures.ticker = { bidPrice: futuresInfo.bidPrice, askPrice: futuresInfo.askPrice, bidQty: futuresInfo.bidQty, askQty: futuresInfo.askQty, ts: futuresInfo.ts };
                    data.futures.volume24hQuote = futuresInfo.volume24hQuote;
                    data.futures.fundingRate = futuresInfo.fundingRate;
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
            let updatedCount = 0;
            const pairsForThisExchange = this.pairsToMonitorByExchange[exchangeName] || [];
            pairsForThisExchange.forEach(pair => {
                const data = this.marketData[exchangeName]?.[pair];
                if (!data) return;
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
            if (typeof connector.closeAll === 'function') connector.closeAll();
        });
        this.logger.info("[MarketMonitor] All activities stopped.");
    }

    getAllMarketData() {
        return this.marketData;
    }
}
module.exports = MarketMonitor;