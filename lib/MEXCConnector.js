const axios = require("axios");
const WebSocket = require("ws");

class MEXCConnector {
    constructor(config, logger) {
        this.config = config;
        this.logger = logger;
        this.spotRestUrl = config.spot_api_url || "https://api.mexc.com/api/v3";
        this.futuresRestUrl = config.futures_api_url || "https://contract.mexc.com/api/v1/contract";
        this.spotWsUrl = "wss://wbs.mexc.com/ws";
        this.futuresWsUrl = "wss://contract.mexc.com/edge";
        this.spotTickerMap = new Map();
        this.futuresTickerMap = new Map();
        this.reconnectInterval = 5000;
        this.pingInterval = null;
        this.lastPong = Date.now();
        this.pingTimeout = 30000;
        this.axiosInstance = axios.create({ headers: { "User-Agent": "ArbitrageBot/3.0" } });
        this.logger.info(`[MEXCConnector] Initialized.`);
    }

    async _makeRequestWithRetry(url, params = {}) {
        try {
            const response = await this.axiosInstance.get(url, { params, timeout: 10000 });
            return response.data;
        } catch (error) {
            this.logger.error(`[MEXCConnector] Request failed for ${url}: ${error.message}`);
            return null;
        }
    }

    async getAllTradablePairs() {
        this.logger.info("[MEXCConnector] Fetching all tradable pairs from MEXC...");
        try {
            const [spotResponse, futuresResponse] = await Promise.all([
                this._makeRequestWithRetry(`${this.spotRestUrl}/exchangeInfo`),
                this._makeRequestWithRetry(`${this.futuresRestUrl}/detail`)
            ]);

            // Log detalhado das respostas brutas
            this.logger.debug(`[MEXCConnector] Spot Response: ${JSON.stringify(spotResponse, null, 2)}`);
            this.logger.debug(`[MEXCConnector] Futures Response: ${JSON.stringify(futuresResponse, null, 2)}`);

            const pairs = new Set();

            // Processar pares do mercado spot
            if (spotResponse && Array.isArray(spotResponse.symbols)) {
                this.logger.debug(`[MEXCConnector] Found ${spotResponse.symbols.length} spot symbols`);
                spotResponse.symbols.forEach(s => {
                    if (s.status === 'ENABLED' && s.quoteAsset === 'USDT') {
                        pairs.add(`${s.baseAsset}/USDT`);
                        this.logger.debug(`[MEXCConnector] Added spot pair: ${s.baseAsset}/USDT`);
                    }
                });
            } else {
                this.logger.warn("[MEXCConnector] No valid spot symbols found or unexpected response format");
            }

            // Processar pares do mercado de futuros
            if (futuresResponse && futuresResponse.success && Array.isArray(futuresResponse.data)) {
                this.logger.debug(`[MEXCConnector] Found ${futuresResponse.data.length} futures contracts`);
                futuresResponse.data.forEach(c => {
                    // Aceitar state: 0 como válido, além de 'SHOW'
                    if ((c.state === 'SHOW' || c.state === 0) && c.quoteCoin === 'USDT') {
                        pairs.add(`${c.baseCoin}/USDT`);
                        this.logger.debug(`[MEXCConnector] Added futures pair: ${c.baseCoin}/USDT`);
                    }
                });
            } else {
                this.logger.warn("[MEXCConnector] No valid futures contracts found or unexpected response format");
            }

            this.logger.info(`[MEXCConnector] Found ${pairs.size} unique USDT pairs on MEXC: ${Array.from(pairs).join(', ')}`);
            return Array.from(pairs);
        } catch (error) {
            this.logger.error(`[MEXCConnector] Failed to fetch tradable pairs: ${error.message}`);
            return [];
        }
    }

    connectSpotWebSocket(pairs, onOpenCallback) {
        this.logger.info(`[MEXCConnector] Subscribing to spot WebSocket for pairs: ${pairs.join(', ')}`);
        this.spotWs = new WebSocket(this.spotWsUrl);
        this.spotWs.on("open", () => {
            this.logger.info("[MEXCConnector] Spot WebSocket Connected");
            pairs.forEach(pair => {
                const symbol = pair.replace("/", "");
                this.spotWs.send(JSON.stringify({ "method": "SUBSCRIPTION", "params": [`spot@public.bookTicker.v3.api@${symbol}`] }));
                this.logger.debug(`[MEXCConnector] Subscribed to spot pair: ${symbol}`);
            });
            if (onOpenCallback) onOpenCallback();
        });
        this.spotWs.on("message", (data) => {
            try {
                const message = JSON.parse(data.toString());
                if (message.c && message.s && message.d) {
                    this.spotTickerMap.set(message.s.toUpperCase(), {
                        bidPrice: parseFloat(message.d.b), askPrice: parseFloat(message.d.a),
                        bidQty: parseFloat(message.d.B), askQty: parseFloat(message.d.A),
                        ts: Date.now()
                    });
                    this.logger.debug(`[MEXCConnector] Updated spot ticker for ${message.s}`);
                }
            } catch (e) {
                this.logger.error(`[MEXCConnector] Error processing spot WebSocket message: ${e.message}`);
            }
        });
        this.spotWs.on("close", () => {
            this.logger.warn(`[MEXCConnector] Spot WebSocket closed. Reconnecting...`);
            setTimeout(() => this.connectSpotWebSocket(pairs, onOpenCallback), this.reconnectInterval);
        });
        this.spotWs.on("error", (err) => {
            this.logger.error(`[MEXCConnector] Spot WebSocket error: ${err.message}`);
        });
    }

    connectFuturesWebSocket(pairs, onOpenCallback) {
        this.logger.info(`[MEXCConnector] Subscribing to futures WebSocket for pairs: ${pairs.join(', ')}`);
        this.futuresWs = new WebSocket(this.futuresWsUrl);
        this.futuresWs.on("open", () => {
            this.logger.info("[MEXCConnector] Futures WebSocket Connected");
            pairs.forEach(pair => {
                const symbol = pair.replace("/", "_");
                this.futuresWs.send(JSON.stringify({ "method": "sub.ticker", "param": { "symbol": symbol } }));
                this.logger.debug(`[MEXCConnector] Subscribed to futures pair: ${symbol}`);
            });
            this._startPingInterval();
            if (onOpenCallback) onOpenCallback();
        });
        this.futuresWs.on("message", (data) => {
            try {
                const message = JSON.parse(data.toString());
                if (message.channel === "push.ticker" && message.data) {
                    this.futuresTickerMap.set(message.data.symbol.toUpperCase(), {
                        bidPrice: parseFloat(message.data.bid1), askPrice: parseFloat(message.data.ask1),
                        bidQty: parseFloat(message.data.bidSize1), askQty: parseFloat(message.data.askSize1),
                        ts: parseInt(message.data.ts)
                    });
                    this.logger.debug(`[MEXCConnector] Updated futures ticker for ${message.data.symbol}`);
                } else if (message.channel === "ping") {
                    this.futuresWs.send(JSON.stringify({ "method": "pong" }));
                    this.lastPong = Date.now();
                }
            } catch (e) {
                this.logger.error(`[MEXCConnector] Error processing futures WebSocket message: ${e.message}`);
            }
        });
        this.futuresWs.on("close", () => {
            this.logger.warn(`[MEXCConnector] Futures WebSocket closed. Reconnecting...`);
            this._stopPingInterval();
            setTimeout(() => this.connectFuturesWebSocket(pairs, onOpenCallback), this.reconnectInterval);
        });
        this.futuresWs.on("error", (err) => {
            this.logger.error(`[MEXCConnector] Futures WebSocket error: ${err.message}`);
        });
    }

    _startPingInterval() {
        this._stopPingInterval();
        this.pingInterval = setInterval(() => {
            if (Date.now() - this.lastPong > this.pingTimeout) {
                this.logger.warn("[MEXCConnector] Futures WS Pong timeout. Terminating.");
                if (this.futuresWs) this.futuresWs.terminate();
                return;
            }
            if (this.futuresWs && this.futuresWs.readyState === WebSocket.OPEN) {
                this.futuresWs.send(JSON.stringify({ "method": "ping" }));
            }
        }, 10000);
    }
    
    _stopPingInterval() {
        if (this.pingInterval) clearInterval(this.pingInterval);
    }

    async getAllSpotData() {
        const response = await this._makeRequestWithRetry(`${this.spotRestUrl}/ticker/24hr`);
        const dataMap = new Map();
        if (Array.isArray(response)) {
            response.forEach(s => {
                dataMap.set(s.symbol.toUpperCase(), { 
                    quoteVolume24h: parseFloat(s.quoteVolume),
                    bidPrice: parseFloat(s.bidPrice),
                    askPrice: parseFloat(s.askPrice),
                    ts: Date.now()
                });
            });
        }
        this.logger.debug(`[MEXCConnector] Fetched spot data for ${dataMap.size} symbols`);
        return dataMap;
    }

    async getAllFuturesData() {
        const response = await this._makeRequestWithRetry(`${this.futuresRestUrl}/ticker`);
        const dataMap = new Map();
        if (Array.isArray(response)) {
            response.forEach(t => {
                dataMap.set(t.symbol.toUpperCase(), {
                    bidPrice: parseFloat(t.bid1), askPrice: parseFloat(t.ask1),
                    bidQty: parseFloat(t.bidSize1), askQty: parseFloat(t.askSize1),
                    volume24hQuote: parseFloat(t.amount24),
                    fundingRate: parseFloat(t.fundingRate),
                    ts: parseInt(t.timestamp)
                });
            });
        }
        this.logger.debug(`[MEXCConnector] Fetched futures data for ${dataMap.size} symbols`);
        return dataMap;
    }

    closeAll() {
        this._stopPingInterval();
        if (this.spotWs) this.spotWs.close();
        if (this.futuresWs) this.futuresWs.close();
    }
}
module.exports = MEXCConnector;