// /lib/MEXCConnector.js - VERSÃO DEFINITIVA
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
        this.spotTickerMap = new Map();
        this.futuresTickerMap = new Map();
        this.reconnectInterval = 5000;
        this.pingInterval = null;
        this.lastPong = Date.now();
        this.pingTimeout = 30000;
        this.axiosInstance = axios.create({ headers: { "User-Agent": "ArbitrageBot/2.3" } });
        this.logger.info(`[MEXCConnector] Initialized.`);
    }

    async _makeRequestWithRetry(url, params = {}) {
        try {
            const response = await this.axiosInstance.get(url, { params, timeout: 5000 });
            return response.data;
        } catch (error) {
            this.logger.error(`[MEXCConnector] Request failed for ${url}: ${error.message}`);
            return null;
        }
    }

    connectSpotWebSocket(pairs, onOpenCallback) {
        this.spotWs = new WebSocket(this.spotWsUrl);
        this.spotWs.on("open", () => {
            this.logger.info("[MEXCConnector] Spot WebSocket Connected");
            pairs.forEach(pair => {
                const symbol = pair.replace("/", "");
                this.spotWs.send(JSON.stringify({ "method": "SUBSCRIPTION", "params": [`spot@public.bookTicker.v3.api@${symbol}`] }));
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
                } else if (message.ping) { this.spotWs.send(JSON.stringify({ "pong": message.ping })); }
            } catch (e) {}
        });
        this.spotWs.on("close", () => { this.logger.warn(`[MEXCConnector] Spot WebSocket closed. Reconnecting...`); setTimeout(() => this.connectSpotWebSocket(pairs, onOpenCallback), this.reconnectInterval); });
        this.spotWs.on("error", (err) => { this.logger.error(`[MEXCConnector] Spot WebSocket error: ${err.message}`); });
    }

    connectFuturesWebSocket(pairs, onOpenCallback) {
        this.futuresWs = new WebSocket(this.futuresWsUrl);
        this.futuresWs.on("open", () => {
            this.logger.info("[MEXCConnector] Futures WebSocket Connected");
            pairs.forEach(pair => {
                const symbol = pair.replace("/", "_");
                this.futuresWs.send(JSON.stringify({ "method": "sub.ticker", "param": { "symbol": symbol } }));
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
                } else if (message.channel === "ping") { this.futuresWs.send(JSON.stringify({ "method": "pong" })); this.lastPong = Date.now(); }
            } catch (e) {}
        });
        this.futuresWs.on("close", () => { this.logger.warn(`[MEXCConnector] Futures WebSocket closed. Reconnecting...`); this._stopPingInterval(); setTimeout(() => this.connectFuturesWebSocket(pairs, onOpenCallback), this.reconnectInterval); });
        this.futuresWs.on("error", (err) => { this.logger.error(`[MEXCConnector] Futures WebSocket error: ${err.message}`); });
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
        return dataMap;
    }

    closeAll() {
        this._stopPingInterval();
        if (this.spotWs) this.spotWs.close();
        if (this.futuresWs) this.futuresWs.close();
    }
}
module.exports = MEXCConnector;