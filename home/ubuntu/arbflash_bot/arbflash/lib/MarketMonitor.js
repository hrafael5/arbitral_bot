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
        this.logger.info(`[MarketMonitor] Initialized. Will monitor exchanges: ${Object.keys(this.connectors).join(", ")}.`);

        // Inicializar dados de mercado para todos os pares
        Object.entries(this.pairsToMonitorByExchange).forEach(([exchangeName, pairs]) => {
            pairs.forEach(pair => this._initializeMarketData(exchangeName, pair));
        });

        // Registrar callbacks para MEXC
        if (this.connectors.mexc) {
            this.connectors.mexc.registerCallback("onFuturesTicker", (data) => this.handleMexcFuturesTicker(data));
            this.connectors.mexc.registerCallback("onFuturesDepth", (data) => this.handleMexcFuturesDepth(data));
            // Adicionar mais callbacks para MEXC Spot se necessário (Protobuf)
        }

        // Registrar callbacks para Gate.io
        if (this.connectors.gateio) {
            this.connectors.gateio.registerCallback("onSpotBookTicker", (data) => this.handleGateSpotBookTicker(data));
            this.connectors.gateio.registerCallback("onSpotTicker", (data) => this.handleGateSpotTicker(data));
            this.connectors.gateio.registerCallback("onSpotDepth", (data) => this.handleGateSpotDepth(data));
            this.connectors.gateio.registerCallback("onFuturesBookTicker", (data) => this.handleGateFuturesBookTicker(data));
            this.connectors.gateio.registerCallback("onFuturesTicker", (data) => this.handleGateFuturesTicker(data));
            this.connectors.gateio.registerCallback("onFuturesDepth", (data) => this.handleGateFuturesDepth(data));
        }
    }

    _initializeMarketData(exchange, pair) {
        if (!this.marketData[exchange]) {
            this.marketData[exchange] = {};
        }
        if (!this.marketData[exchange][pair]) {
            const [baseAsset, quoteAsset] = pair.split("/");
            let spotSymbolApi = `${baseAsset}${quoteAsset}`;
            let futuresSymbolApi = `${baseAsset}_${quoteAsset}`;

            if (exchange.toLowerCase() === "gateio") {
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
        this.logger.info(`[MarketMonitor] Starting WebSocket subscriptions...`);
        Object.entries(this.connectors).forEach(([exchangeName, connector]) => {
            const pairsForThisExchange = this.pairsToMonitorByExchange[exchangeName] || [];

            if (pairsForThisExchange.length === 0) {
                this.logger.warn(`[MarketMonitor] No pairs to monitor for ${exchangeName.toUpperCase()}. Skipping subscriptions.`);
                return;
            }
            
            pairsForThisExchange.forEach(pair => {
                // Assumindo que os conectores têm métodos de subscrição específicos
                if (exchangeName === "mexc") {
                    // MEXC Spot usa Protobuf, então a subscrição é mais complexa ou pré-definida
                    // Por enquanto, vamos subscrever apenas futuros para MEXC, pois o spot é Protobuf e mais complexo
                    connector.subscribeFuturesPair(pair);
                } else if (exchangeName === "gateio") {
                    connector.subscribeSpotPair(pair);
                    connector.subscribeFuturesPair(pair);
                }
            });
        });
        this.logger.info("[MarketMonitor] All WebSocket subscriptions initiated.");
    }

    // Handlers para dados MEXC Futures
    handleMexcFuturesTicker(data) {
        const pair = data.symbol.replace("_", "/");
        this._initializeMarketData("mexc", pair);
        this.marketData.mexc[pair].futures.ticker = {
            bidPrice: data.last, // MEXC ticker tem apenas lastPrice, não bid/ask separados
            askPrice: data.last,
            ts: data.ts
        };
        this.logger.debug(`[MarketMonitor][MEXC FUT] Ticker for ${pair}: ${data.last}`);
        this.engine.processMarketUpdate(this.marketData);
        if (this.broadcastMarketData) this.broadcastMarketData();
    }

    handleMexcFuturesDepth(data) {
        const pair = data.symbol.replace("_", "/");
        this._initializeMarketData("mexc", pair);
        // Atualizar bid/ask do ticker com base no depth, se disponível e mais preciso
        if (data.bids && data.bids.length > 0) {
        if (!this.marketData.mexc[pair].futures.ticker) {
            this.marketData.mexc[pair].futures.ticker = {};
        }
        this.marketData.mexc[pair].futures.ticker.bidPrice = data.bids[0][0];
        }
        if (data.asks && data.asks.length > 0) {
            this.marketData.mexc[pair].futures.ticker.askPrice = data.asks[0][0];
        }
        this.logger.debug(`[MarketMonitor][MEXC FUT] Depth for ${pair}: Bids ${data.bids.length}, Asks ${data.asks.length}`);
        this.engine.processMarketUpdate(this.marketData);
        if (this.broadcastMarketData) this.broadcastMarketData();
    }

    // Handlers para dados Gate.io Spot
    handleGateSpotBookTicker(data) {
        const pair = data.symbol.replace("_", "/");
        this._initializeMarketData("gateio", pair);
        this.marketData.gateio[pair].spot.ticker = {
            bidPrice: data.bid,
            askPrice: data.ask,
            ts: data.ts
        };
        this.logger.debug(`[MarketMonitor][GATE SPOT] BookTicker for ${pair}: Bid ${data.bid}, Ask ${data.ask}`);
        this.engine.processMarketUpdate(this.marketData);
        if (this.broadcastMarketData) this.broadcastMarketData();
    }

    handleGateSpotTicker(data) {
        const pair = data.symbol.replace("_", "/");
        this._initializeMarketData("gateio", pair);
        // Atualizar last price, mas manter bid/ask do book_ticker se for mais preciso
        if (!this.marketData.gateio[pair].spot.ticker) {
            this.marketData.gateio[pair].spot.ticker = {};
        }
        this.marketData.gateio[pair].spot.ticker.last = data.last;
        this.marketData.gateio[pair].spot.ticker.ts = data.ts;
        this.logger.debug(`[MarketMonitor][GATE SPOT] Ticker for ${pair}: ${data.last}`);
        this.engine.processMarketUpdate(this.marketData);
        if (this.broadcastMarketData) this.broadcastMarketData();
    }

    handleGateSpotDepth(data) {
        const pair = data.symbol.replace("_", "/");
        this._initializeMarketData("gateio", pair);
        // Atualizar bid/ask do ticker com base no depth, se disponível e mais preciso
        if (data.bids && data.bids.length > 0) {
            if (!this.marketData.gateio[pair].spot.ticker) {
                this.marketData.gateio[pair].spot.ticker = {};
            }
            this.marketData.gateio[pair].spot.ticker.bidPrice = data.bids[0][0];
        }
        if (data.asks && data.asks.length > 0) {
            this.marketData.gateio[pair].spot.ticker.askPrice = data.asks[0][0];
        }
        this.logger.debug(`[MarketMonitor][GATE SPOT] Depth for ${pair}: Bids ${data.bids.length}, Asks ${data.asks.length}`);
        this.engine.processMarketUpdate(this.marketData);
        if (this.broadcastMarketData) this.broadcastMarketData();
    }

    // Handlers para dados Gate.io Futures
    handleGateFuturesBookTicker(data) {
        const pair = data.symbol.replace("_", "/");
        this._initializeMarketData("gateio", pair);
        this.marketData.gateio[pair].futures.ticker = {
            bidPrice: data.bid,
            askPrice: data.ask,
            ts: data.ts
        };
        this.logger.debug(`[MarketMonitor][GATE FUT] BookTicker for ${pair}: Bid ${data.bid}, Ask ${data.ask}`);
        this.engine.processMarketUpdate(this.marketData);
        if (this.broadcastMarketData) this.broadcastMarketData();
    }

    handleGateFuturesTicker(data) {
        const pair = data.symbol.replace("_", "/");
        this._initializeMarketData("gateio", pair);
        if (!this.marketData.gateio[pair].futures.ticker) {
            this.marketData.gateio[pair].futures.ticker = {};
        }
        this.marketData.gateio[pair].futures.ticker.last = data.last;
        this.marketData.gateio[pair].futures.ticker.ts = data.ts;
        this.marketData.gateio[pair].futures.fundingRate = data.fundingRate;
        this.logger.debug(`[MarketMonitor][GATE FUT] Ticker for ${pair}: ${data.last}, FundingRate: ${data.fundingRate}`);
        this.engine.processMarketUpdate(this.marketData);
        if (this.broadcastMarketData) this.broadcastMarketData();
    }

    handleGateFuturesDepth(data) {
        const pair = data.symbol.replace("_", "/");
        this._initializeMarketData("gateio", pair);
        if (data.bids && data.bids.length > 0) {
            if (!this.marketData.gateio[pair].futures.ticker) {
                this.marketData.gateio[pair].futures.ticker = {};
            }
            this.marketData.gateio[pair].futures.ticker.bidPrice = data.bids[0][0];
        }
        if (data.asks && data.asks.length > 0) {
            this.marketData.gateio[pair].futures.ticker.askPrice = data.asks[0][0];
        }
        this.logger.debug(`[MarketMonitor][GATE FUT] Depth for ${pair}: Bids ${data.bids.length}, Asks ${data.asks.length}`);
        this.engine.processMarketUpdate(this.marketData);
        if (this.broadcastMarketData) this.broadcastMarketData();
    }

    stop() {
        this.logger.info("[MarketMonitor] Stopping all WebSocket connections...");
        if (this.connectors.mexc) this.connectors.mexc.closeAll();
        if (this.connectors.gateio) this.connectors.gateio.closeAll();
        this.logger.info("[MarketMonitor] All WebSocket connections closed.");
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

