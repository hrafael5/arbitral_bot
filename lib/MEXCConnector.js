// /lib/MEXCConnector.js
const axios = require("axios");
const WebSocket = require("ws");

class MEXCConnector {
    constructor(config, logger) {
        this.config = config;
        this.logger = logger;
        this.spotWs = null;
        this.futuresWs = null;
        this.spotWsUrl = "wss://wbs.mexc.com/ws";
        this.futuresWsUrl = "wss://contract.mexc.com/edge";
        this.spotRestUrl = this.config.spot_api_url || "https://api.mexc.com/api/v3";
        this.futuresRestUrl = this.config.futures_api_url || "https://contract.mexc.com/api/v1/contract";
        this.subscriptions = new Map();
        this.spotTickerMap = new Map();
        this.futuresTickerMap = new Map();
        this.reconnectInterval = 5000;
        this.pingInterval = null;
        this.pingTimeout = 30000;
        this.lastPong = Date.now();
        this.isReconnecting = false;
        this.maxRetries = 3;
        this.retryDelayBase = 1000;
        this.axiosInstance = axios.create({
            headers: { "User-Agent": "SeuBotDeArbitragem/1.1 MEXCConnector" }
        });
        this.logger.info(`[MEXCConnector] Initialized. Spot URL: ${this.spotRestUrl}, Futures URL: ${this.futuresRestUrl}`);
    }

    async connectSpotWebSocket(pairs, onOpenCallback) {
        if (this.spotWs && this.spotWs.readyState === WebSocket.OPEN) {
            if (onOpenCallback) onOpenCallback();
            return;
        }
        this.logger.info(`[MEXCConnector] Connecting to Spot WebSocket at ${this.spotWsUrl}`);
        this.spotWs = new WebSocket(this.spotWsUrl);
        this.spotWs.on("open", () => {
            this.logger.info("[MEXCConnector] Spot WebSocket Connected");
            pairs.forEach(pair => {
                const symbol = pair.replace("/", "");
                this.spotWs.send(JSON.stringify({
                    "method": "SUBSCRIPTION",
                    "params": [
                        `spot@public.deals.v3.api@${symbol}`,
                        `spot@public.book.v3.api@${symbol}@10@100ms`
                    ],
                    "id": 1
                }));
                this.subscriptions.set(symbol, true);
            });
            this._startPingInterval();
            if (onOpenCallback) onOpenCallback();
        });
        this.spotWs.on("message", (data) => {
            this.lastPong = Date.now();
            try {
                const message = JSON.parse(data.toString());
                if (message.c && message.s) {
                    const symbol = message.s.toUpperCase();
                    if (message.c.startsWith("spot@public.deals.v3.api")) {
                        this.spotTickerMap.set(symbol, {
                            bidPrice: null,
                            askPrice: parseFloat(message.d.deals[0].p),
                            bidQty: null,
                            askQty: parseFloat(message.d.deals[0].v),
                            ts: Date.now()
                        });
                    } else if (message.c.startsWith("spot@public.book.v3.api")) {
                        this.spotTickerMap.set(symbol, {
                            bidPrice: parseFloat(message.d.bids[0].p),
                            askPrice: parseFloat(message.d.asks[0].p),
                            bidQty: parseFloat(message.d.bids[0].v),
                            askQty: parseFloat(message.d.asks[0].v),
                            ts: Date.now()
                        });
                    }
                }
            } catch (error) {
                this.logger.error(`[MEXCConnector] Error processing Spot WebSocket message: ${error.message}`);
            }
        });
        this.spotWs.on("close", (code, reason) => {
            this.logger.warn(`[MEXCConnector] Spot WebSocket closed. Code: ${code}, Reason: ${reason}`);
            this._stopPingInterval();
            this._reconnectSpotWebSocket(pairs, onOpenCallback);
        });
        this.spotWs.on("error", (error) => {
            this.logger.error(`[MEXCConnector] Spot WebSocket error: ${error.message}`);
        });
    }

    async connectFuturesWebSocket(pairs, onOpenCallback) {
        if (this.futuresWs && this.futuresWs.readyState === WebSocket.OPEN) {
            if (onOpenCallback) onOpenCallback();
            return;
        }
        this.logger.info(`[MEXCConnector] Connecting to Futures WebSocket at ${this.futuresWsUrl}`);
        this.futuresWs = new WebSocket(this.futuresWsUrl);
        this.futuresWs.on("open", () => {
            this.logger.info("[MEXCConnector] Futures WebSocket Connected");
            pairs.forEach(pair => {
                const symbol = pair.replace("/", "_");
                this.futuresWs.send(JSON.stringify({
                    "method": "SUBSCRIPTION",
                    "params": [
                        `contract@public.deals.v3.api@${symbol}`,
                        `contract@public.book.v3.api@${symbol}@10@100ms`
                    ],
                    "id": 2
                }));
                this.subscriptions.set(symbol, true);
            });
            this._startPingInterval();
            if (onOpenCallback) onOpenCallback();
        });
        this.futuresWs.on("message", (data) => {
            this.lastPong = Date.now();
            try {
                const message = JSON.parse(data.toString());
                if (message.method === "pong") {
                    return;
                }
                if (message.c && message.s) {
                    const symbol = message.s.toUpperCase();
                    if (message.c.startsWith("contract@public.deals.v3.api")) {
                        this.futuresTickerMap.set(symbol, {
                            bidPrice: null,
                            askPrice: parseFloat(message.d.deals[0].p),
                            bidQty: null,
                            askQty: parseFloat(message.d.deals[0].v),
                            volume24hQuote: null,
                            fundingRate: null,
                            ts: Date.now()
                        });
                    } else if (message.c.startsWith("contract@public.book.v3.api")) {
                        this.futuresTickerMap.set(symbol, {
                            bidPrice: parseFloat(message.d.bids[0].p),
                            askPrice: parseFloat(message.d.asks[0].p),
                            bidQty: parseFloat(message.d.bids[0].v),
                            askQty: parseFloat(message.d.asks[0].v),
                            volume24hQuote: null,
                            fundingRate: null,
                            ts: Date.now()
                        });
                    }
                }
            } catch (error) {
                this.logger.error(`[MEXCConnector] Error processing Futures WebSocket message: ${error.message}`);
            }
        });
        this.futuresWs.on("close", (code, reason) => {
            this.logger.warn(`[MEXCConnector] Futures WebSocket closed. Code: ${code}, Reason: ${reason}`);
            this._stopPingInterval();
            this._reconnectFuturesWebSocket(pairs, onOpenCallback);
        });
        this.futuresWs.on("error", (error) => {
            this.logger.error(`[MEXCConnector] Futures WebSocket error: ${error.message}`);
        });
    }

    _reconnectSpotWebSocket(pairs, onOpenCallback) {
        if (this.isReconnecting) return;
        this.isReconnecting = true;
        this.logger.info(`[MEXCConnector] Attempting to reconnect Spot WebSocket in ${this.reconnectInterval}ms...`);
        setTimeout(() => {
            this.isReconnecting = false;
            this.connectSpotWebSocket(pairs, onOpenCallback);
        }, this.reconnectInterval);
    }

    _reconnectFuturesWebSocket(pairs, onOpenCallback) {
        if (this.isReconnecting) return;
        this.isReconnecting = true;
        this.logger.info(`[MEXCConnector] Attempting to reconnect Futures WebSocket in ${this.reconnectInterval}ms...`);
        setTimeout(() => {
            this.isReconnecting = false;
            this.connectFuturesWebSocket(pairs, onOpenCallback);
        }, this.reconnectInterval);
    }

    _startPingInterval() {
        this._stopPingInterval();
        this.pingInterval = setInterval(() => {
            if ((this.spotWs && this.spotWs.readyState === WebSocket.OPEN) ||
                (this.futuresWs && this.futuresWs.readyState === WebSocket.OPEN)) {
                if (Date.now() - this.lastPong > this.pingTimeout) {
                    this.logger.warn("[MEXCConnector] WebSocket pong timeout. Closing and reconnecting...");
                    if (this.spotWs) this.spotWs.terminate();
                    if (this.futuresWs) this.futuresWs.terminate();
                } else {
                    try {
                        if (this.spotWs) this.spotWs.send(JSON.stringify({ method: "ping" }));
                        if (this.futuresWs) this.futuresWs.send(JSON.stringify({ method: "ping" }));
                    } catch (e) {
                        this.logger.error(`[MEXCConnector] Error sending ping: ${e.message}`);
                    }
                }
            }
        }, 10000);
    }

    _stopPingInterval() {
        if (this.pingInterval) {
            clearInterval(this.pingInterval);
            this.pingInterval = null;
        }
    }

    async getAllSpotBookTickers() {
        if (this.spotTickerMap.size > 0) {
            return this.spotTickerMap;
        }
        const url = `${this.spotRestUrl}/ticker/bookTicker`;
        try {
            const response = await this._makeRequestWithRetry(url, {}, 20000);
            const tickerMap = new Map();
            if (Array.isArray(response)) {
                response.forEach(ticker => {
                    const bidPrice = parseFloat(ticker.bidPrice);
                    const askPrice = parseFloat(ticker.askPrice);
                    if (ticker.symbol && askPrice > 0 && bidPrice > 0) {
                        tickerMap.set(ticker.symbol.toUpperCase(), {
                            bidPrice: isNaN(bidPrice) ? null : bidPrice,
                            askPrice: isNaN(askPrice) ? null : askPrice,
                            bidQty: parseFloat(ticker.bidQty) || null,
                            askQty: parseFloat(ticker.askQty) || null,
                            ts: Date.now()
                        });
                    }
                });
            }
            this.logger.info(`[MEXCConnector_DEBUG] getAllSpotBookTickers fetched ${tickerMap.size} valid items via REST`);
            return tickerMap;
        } catch (error) {
            this.logger.error(`[MEXCConnector] Failed to fetch all MEXC spot book tickers: ${error.message}`);
            return this.spotTickerMap;
        }
    }

    async getAllFuturesBookTickers() {
        if (this.futuresTickerMap.size > 0) {
            return this.futuresTickerMap;
        }
        const endpointPath = "ticker";
        const url = `${this.futuresRestUrl}/${endpointPath}`;
        try {
            const response = await this._makeRequestWithRetry(url, {}, 20000);
            const tickerMap = new Map();
            if (response && response.success && Array.isArray(response.data)) {
                response.data.forEach(ticker => {
                    if (ticker.symbol && parseFloat(ticker.ask1) > 0 && parseFloat(ticker.bid1) > 0) {
                        tickerMap.set(ticker.symbol.toUpperCase(), {
                            bidPrice: parseFloat(ticker.bid1) || null,
                            askPrice: parseFloat(ticker.ask1) || null,
                            bidQty: parseFloat(ticker.bidSize1) || null,
                            askQty: parseFloat(ticker.askSize1) || null,
                            volume24hQuote: parseFloat(ticker.amount24) || null,
                            fundingRate: parseFloat(ticker.fundingRate) || null,
                            ts: parseInt(ticker.timestamp) || Date.now()
                        });
                    }
                });
            }
            this.logger.info(`[MEXCConnector_DEBUG] getAllFuturesBookTickers fetched ${tickerMap.size} valid items via REST`);
            return tickerMap;
        } catch (error) {
            this.logger.error(`[MEXCConnector] Failed to fetch all MEXC futures book tickers: ${error.message}`);
            return this.futuresTickerMap;
        }
    }

    async getAllSpot24hrStats() {
        const url = `${this.spotRestUrl}/ticker/24hr`;
        try {
            const response = await this._makeRequestWithRetry(url, {}, 20000);
            const statsMap = new Map();
            if (Array.isArray(response)) {
                response.forEach(stat => {
                    const quoteVol = parseFloat(stat.quoteVolume);
                    if (stat.symbol) {
                        statsMap.set(stat.symbol.toUpperCase(), {
                            quoteVolume24h: isNaN(quoteVol) ? null : quoteVol,
                        });
                    }
                });
            }
            this.logger.info(`[MEXCConnector_DEBUG] getAllSpot24hrStats fetched ${statsMap.size} valid items`);
            return statsMap;
        } catch (error) {
            this.logger.error(`[MEXCConnector] Failed to fetch all MEXC spot 24hr stats: ${error.message}`);
            return null;
        }
    }

    async getFuturesContractDetail() {
        const url = `${this.futuresRestUrl}/detail`;
        this.logger.info(`[MEXCConnector] Fetching MEXC futures contract details from ${url}...`);
        try {
            const response = await this._makeRequestWithRetry(url, {}, 20000);
            this.logger.info(`[MEXCConnector] Fetched MEXC futures contract details. Success: ${response?.success}, Data length: ${response?.data?.length || 0}`);
            return response;
        } catch (error) {
            this.logger.error(`[MEXCConnector] Failed to fetch MEXC futures contract details: ${error.message}`);
            return { success: false, message: `MEXC Futures Contracts: ${error.message}`, data: null };
        }
    }

    closeAll() {
        this.logger.info("[MEXCConnector] Closing MEXC connections...");
        this._stopPingInterval();
        if (this.spotWs) {
            this.spotWs.removeAllListeners();
            this.spotWs.close();
            this.spotWs = null;
            this.logger.info("[MEXCConnector] Spot WebSocket closed");
        }
        if (this.futuresWs) {
            this.futuresWs.removeAllListeners();
            this.futuresWs.close();
            this.futuresWs = null;
            this.logger.info("[MEXCConnector] Futures WebSocket closed");
        }
        this.subscriptions.clear();
    }
}

module.exports = MEXCConnector;