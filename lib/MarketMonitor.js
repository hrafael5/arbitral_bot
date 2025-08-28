// /lib/MarketMonitor.js (Otimizado para REST Polling Escalonado)

class MarketMonitor {
    constructor(connectors, pairsToMonitorByExchange, engine, logger, globalConfig, broadcastCallback) {
        this.connectors = connectors;
        this.pairsToMonitorByExchange = pairsToMonitorByExchange;
        this.engine = engine;
        this.logger = logger;
        this.globalConfig = globalConfig;
        this.broadcastMarketData = broadcastCallback;
        this.marketData = {};
        this.mainTimer = null; // Usaremos um único timer
        this.taskQueue = []; // Fila de tarefas de polling
        this.taskIndex = 0; // Índice da próxima tarefa a ser executada

        this.logger.info(`[MarketMonitor] Initialized with Staggered Polling model.`);
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
        this.logger.info(`[MarketMonitor] Building task queue for staggered polling...`);

        // 1. Construir a fila de tarefas
        Object.entries(this.connectors).forEach(([exchangeName, connector]) => {
            const pairsForThisExchange = this.pairsToMonitorByExchange[exchangeName] || [];
            if (pairsForThisExchange.length === 0) {
                this.logger.warn(`[MarketMonitor] No pairs to monitor for ${exchangeName.toUpperCase()}. Skipping.`);
                return;
            }
            
            pairsForThisExchange.forEach(pair => this._initializeMarketData(exchangeName, pair));

            if (typeof connector.getAllSpotBookTickers === 'function') {
                this.taskQueue.push({ name: `${exchangeName}-SPOT`, task: () => this.pollSpotData(exchangeName, connector) });
            }
            if (typeof connector.getAllFuturesBookTickers === 'function') {
                this.taskQueue.push({ name: `${exchangeName}-FUTURES`, task: () => this.pollFuturesData(exchangeName, connector) });
            }
        });

        if (this.taskQueue.length === 0) {
            this.logger.error("[MarketMonitor] Task queue is empty. No data will be polled.");
            return;
        }

        // 2. Iniciar o "maestro" (o único timer)
        const mainTickInterval = parseInt(this.globalConfig.general.main_tick_interval_ms) || 250;
        this.logger.info(`[MarketMonitor] Starting main tick loop with interval: ${mainTickInterval}ms. Total tasks: ${this.taskQueue.length}.`);
        this.mainTimer = setInterval(() => this._tick(), mainTickInterval);
    }
    
    async _tick() {
        if (this.taskQueue.length === 0) return;

        this.taskIndex = (this.taskIndex + 1) % this.taskQueue.length;
        const { name, task } = this.taskQueue[this.taskIndex];
        
        this.logger.debug(`[MarketMonitor] Tick! Executing task: ${name}`);
        try {
            await task();
        } catch (error) {
            this.logger.error(`[MarketMonitor] Error executing task ${name}: ${error.message}`);
        }
    }

    // NOVA FUNÇÃO PARA ATUALIZAR O INTERVALO
    updateTickInterval(newIntervalMs) {
        this.logger.info(`[MarketMonitor] Attempting to update tick interval to ${newIntervalMs}ms.`);
        
        if (this.mainTimer) {
            clearInterval(this.mainTimer);
            this.logger.info(`[MarketMonitor] Old timer stopped.`);
        }

        this.globalConfig.general.main_tick_interval_ms = newIntervalMs;

        this.mainTimer = setInterval(() => this._tick(), newIntervalMs);
        this.logger.info(`[MarketMonitor] New timer started with interval: ${newIntervalMs}ms.`);
    }

    async pollSpotData(exchangeName, connector) {
        try {
            const [spotTickersMap, spotStatsMap] = await Promise.all([
                connector.getAllSpotBookTickers(),
                connector.getAllSpot24hrStats()
            ]);

            if (!spotTickersMap || spotTickersMap.size === 0) return;
            
            const pairsForThisExchange = this.pairsToMonitorByExchange[exchangeName] || [];
            let updated = false;

            pairsForThisExchange.forEach(pair => {
                this._initializeMarketData(exchangeName, pair);
                const data = this.marketData[exchangeName][pair];
                const spotSymbol = data.spot.symbolApi.toUpperCase();

                const tickerData = spotTickersMap.get(spotSymbol);
                if (tickerData) {
                    data.spot.ticker = tickerData;
                    updated = true;
                }

                if (spotStatsMap) {
                    const statsData = spotStatsMap.get(spotSymbol);
                    if (statsData) {
                        data.spot.volume24hQuote = statsData.quoteVolume24h;
                    }
                }
            });

            if (updated) {
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
            let updated = false;

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
                    updated = true;
                }
            });

            if (updated) {
                this.engine.processMarketUpdate(this.marketData);
                if (this.broadcastMarketData) this.broadcastMarketData();
            }
        } catch (error) {
            this.logger.error(`[MarketMonitor][${exchangeName.toUpperCase()}] Error polling Futures data: ${error.message}`);
        }
    }

    stop() {
        this.logger.info("[MarketMonitor] Stopping main tick loop...");
        if (this.mainTimer) clearInterval(this.mainTimer);
        this.mainTimer = null;
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
