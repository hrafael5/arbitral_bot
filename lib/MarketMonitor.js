class MarketMonitor {
    constructor(connectors, pairsByExchange, arbitrageEngine, logger, config, broadcastCallback) {
        this.connectors = connectors;
        this.pairsByExchange = pairsByExchange;
        this.arbitrageEngine = arbitrageEngine;
        this.logger = logger;
        this.config = config;
        this.broadcastCallback = broadcastCallback;
        this.isRunning = false;
        this.marketState = {};
        this.maxTimestampDiffMs = parseInt(config.arbitrage.max_timestamp_diff_ms, 10) || 2500;
        this.spotIntervals = {};
        this.futuresIntervals = {};
    }

    async start() {
        if (this.isRunning) return;
        this.isRunning = true;
        this.logger.info("Market monitor starting...");

        for (const [exchange, pairs] of Object.entries(this.pairsByExchange)) {
            if (!this.connectors[exchange]) continue;

            // Configurar polling para spot
            const spotIntervalMs = parseInt(this.config[exchange].spot_polling_interval_ms, 10) || 1000;
            this.spotIntervals[exchange] = setInterval(() => this.fetchAndProcessSpotData(exchange, pairs), spotIntervalMs);

            // Configurar polling para futuros
            const futuresIntervalMs = parseInt(this.config[exchange].futures_polling_interval_ms, 10) || 1000;
            this.futuresIntervals[exchange] = setInterval(() => this.fetchAndProcessFuturesData(exchange, pairs), futuresIntervalMs);

            // Conectar WebSocket (se disponível)
            if (this.connectors[exchange].connectFuturesWebSocket) {
                this.connectors[exchange].connectFuturesWebSocket(() => {
                    this.logger.info(`[${exchange}] Futures WebSocket connected`);
                });
                this.connectors[exchange].subscriptions.forEach((callback, pair) => {
                    callback = this.processFuturesUpdate.bind(this, exchange, pair);
                });
            }
        }
    }

    async fetchAndProcessSpotData(exchange, pairs) {
        const startTime = Date.now();
        try {
            const spotData = await Promise.all(pairs.map(async (pair) => {
                const ticker = await this.connectors[exchange].fetchSpotTicker(pair);
                return { pair, ticker };
            }));
            const validData = spotData.filter(({ ticker }) => ticker && ticker.ts && (Date.now() - ticker.ts < this.maxTimestampDiffMs));
            if (validData.length > 0) {
                this.marketState[exchange] = this.marketState[exchange] || {};
                validData.forEach(({ pair, ticker }) => {
                    this.marketState[exchange][pair] = { ...this.marketState[exchange][pair], spot: ticker };
                });
                this.processMarketUpdate();
            }
            const duration = Date.now() - startTime;
            if (duration > 100) {
                this.logger.warn(`[${exchange}] Spot data fetch took ${duration}ms for ${pairs.length} pairs`);
            }
        } catch (error) {
            this.logger.error(`[${exchange}] Error fetching spot data: ${error.message}`);
        }
    }

    async fetchAndProcessFuturesData(exchange, pairs) {
        const startTime = Date.now();
        try {
            const futuresData = await Promise.all(pairs.map(async (pair) => {
                const ticker = await this.connectors[exchange].fetchFuturesTicker(pair);
                return { pair, ticker };
            }));
            const validData = futuresData.filter(({ ticker }) => ticker && ticker.ts && (Date.now() - ticker.ts < this.maxTimestampDiffMs));
            if (validData.length > 0) {
                this.marketState[exchange] = this.marketState[exchange] || {};
                validData.forEach(({ pair, ticker }) => {
                    this.marketState[exchange][pair] = { ...this.marketState[exchange][pair], futures: ticker };
                });
                this.processMarketUpdate();
            }
            const duration = Date.now() - startTime;
            if (duration > 100) {
                this.logger.warn(`[${exchange}] Futures data fetch took ${duration}ms for ${pairs.length} pairs`);
            }
        } catch (error) {
            this.logger.error(`[${exchange}] Error fetching futures data: ${error.message}`);
        }
    }

    processMarketUpdate() {
        const startTime = Date.now();
        try {
            this.arbitrageEngine.processMarketUpdate(this.marketState);
            this.broadcastCallback(this.marketState);
            const duration = Date.now() - startTime;
            if (duration > 50) {
                this.logger.warn(`[MarketMonitor] Market update processing took ${duration}ms`);
            }
        } catch (error) {
            this.logger.error(`[MarketMonitor] Error processing market update: ${error.message}`);
        }
    }

    stop() {
        if (!this.isRunning) return;
        this.isRunning = false;
        for (const exchange in this.spotIntervals) {
            clearInterval(this.spotIntervals[exchange]);
            delete this.spotIntervals[exchange];
        }
        for (const exchange in this.futuresIntervals) {
            clearInterval(this.futuresIntervals[exchange]);
            delete this.futuresIntervals[exchange];
        }
        this.logger.info("Market monitor stopped.");
    }
}

module.exports = MarketMonitor;