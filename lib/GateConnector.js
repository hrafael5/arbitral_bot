// /lib/GateConnector.js - VERSÃO ATUALIZADA
const axios = require("axios");
const WebSocket = require("ws");

class GateConnector {
    constructor(config, logger) {
        this.config = config;
        this.logger = logger;
        this.spotRestUrl = config.spot_api_url || "https://api.gateio.ws/api/v4/spot";
        this.futuresRestUrl = config.futures_api_url || "https://api.gateio.ws/api/v4/futures";
        this.futuresWsUrl = "wss://fx-ws.gateio.ws/v4/ws/usdt";
        this.futuresTickerMap = new Map();
        this.spotTickerMap = new Map();
        this.pingInterval = null;
        this.lastPong = Date.now();
        this.pingTimeout = 30000;
        this.reconnectInterval = 5000;
        this.axiosInstance = axios.create({ headers: { "User-Agent": "ArbitrageBot/3.0" } });
        this.logger.info(`[GateConnector] Initialized.`);
    }

    async _makeRequestWithRetry(url, params = {}) {
        try {
            const response = await this.axiosInstance.get(url, { params, timeout: 10000 });
            return response.data;
        } catch (error) {
            this.logger.error(`[GateConnector] Request failed for ${url}: ${error.message}`);
            return null;
        }
    }

    async getAllTradablePairs() {
        this.logger.info("[GateConnector] Fetching all tradable pairs from Gate.io...");
        try {
            const [spotResponse, futuresResponse] = await Promise.all([
                this._makeRequestWithRetry(`${this.spotRestUrl}/currency_pairs`),
                this._makeRequestWithRetry(`${this.futuresRestUrl}/usdt/contracts`)
            ]);
            const pairs = new Set();
            if (Array.isArray(spotResponse)) {
                spotResponse.forEach(p => {
                    if (p.trade_status === 'tradable' && p.quote === 'USDT') {
                        pairs.add(`${p.base}/USDT`);
                    }
                });
            }
            if (Array.isArray(futuresResponse)) {
                futuresResponse.forEach(c => {
                    if (c.in_delisting === false && c.quote_asset === 'USDT') {
                        pairs.add(`${c.base_asset}/USDT`);
                    }
                });
            }
            this.logger.info(`[GateConnector] Found ${pairs.size} unique USDT pairs on Gate.io.`);
            return Array.from(pairs);
        } catch (error) {
            this.logger.error(`[GateConnector] Failed to fetch tradable pairs: ${error.message}`);
            return [];
        }
    }

    connectFuturesWebSocket(pairs, onOpenCallback) {
        this.futuresWs = new WebSocket(this.futuresWsUrl);
        this.futuresWs.on("open", () => {
            this.logger.info("[GateConnector] Futures WebSocket Connected");
            pairs.forEach(pair => {
                const symbol = pair.replace("/", "_").toUpperCase();
                this.futuresWs.send(JSON.stringify({
                    time: Math.floor(Date.now() / 1000),
                    channel: "futures.book_ticker",
                    event: "subscribe",
                    payload: [symbol]
                }));
            });
            this._startPingInterval();
            if (onOpenCallback) onOpenCallback();
        });
        this.futuresWs.on("message", (data) => {
            try {
                const message = JSON.parse(data.toString());
                if (message.event === "update" && message.channel === "futures.book_ticker" && message.result) {
                    const r = message.result;
                    this.futuresTickerMap.set(r.s, {
                        bidPrice: parseFloat(r.b), askPrice: parseFloat(r.a),
                        bidQty: parseFloat(r.B), askQty: parseFloat(r.A),
                        ts: parseInt(r.t)
                    });
                } else if (message.event === "subscribe") { this.logger.info(`[GateConnector] Subscription response: ${JSON.stringify(message.result)}`); }
                 else if (message.channel === "futures.ping") { this.lastPong = Date.now(); this.futuresWs.send(JSON.stringify({ time: Math.floor(Date.now() / 1000), channel: "futures.pong"})); }
            } catch (e) {}
        });
        this.futuresWs.on("close", () => { this.logger.warn(`[GateConnector] Futures WebSocket closed. Reconnecting...`); this._stopPingInterval(); setTimeout(() => this.connectFuturesWebSocket(pairs, onOpenCallback), this.reconnectInterval); });
        this.futuresWs.on("error", (err) => { this.logger.error(`[GateConnector] Futures WebSocket error: ${err.message}`); });
    }

    _startPingInterval() {
        this._stopPingInterval();
        this.pingInterval = setInterval(() => {
            if (Date.now() - this.lastPong > this.pingTimeout) {
                this.logger.warn("[GateConnector] Futures WS Pong timeout. Terminating.");
                if (this.futuresWs) this.futuresWs.terminate();
                return;
            }
            if (this.futuresWs && this.futuresWs.readyState === WebSocket.OPEN) {
                this.futuresWs.send(JSON.stringify({ time: Math.floor(Date.now() / 1000), channel: "futures.ping" }));
            }
        }, 10000);
    }

    _stopPingInterval() {
        if (this.pingInterval) clearInterval(this.pingInterval);
    }
    
    async getAllSpotData() {
        const response = await this._makeRequestWithRetry(`${this.spotRestUrl}/tickers`);
        const dataMap = new Map();
        if (Array.isArray(response)) {
            response.forEach(t => {
                dataMap.set(t.currency_pair.toUpperCase(), {
                    bidPrice: parseFloat(t.highest_bid), askPrice: parseFloat(t.lowest_ask),
                    quoteVolume24h: parseFloat(t.quote_volume),
                    ts: Date.now()
                });
            });
        }
        return dataMap;
    }
    
    async getAllFuturesData() {
        const response = await this._makeRequestWithRetry(`${this.futuresRestUrl}/usdt/tickers`);
        const dataMap = new Map();
        if (Array.isArray(response)) {
            response.forEach(t => {
                dataMap.set(t.contract.toUpperCase(), {
                    bidPrice: parseFloat(t.highest_bid), askPrice: parseFloat(t.lowest_ask),
                    volume24hQuote: parseFloat(t.volume_24h),
                    fundingRate: parseFloat(t.funding_rate),
                    ts: parseInt(t.last_timestamp_ms)
                });
            });
        }
        return dataMap;
    }

    closeAll() {
        this._stopPingInterval();
        if (this.futuresWs) this.futuresWs.close();
    }
}
module.exports = GateConnector;