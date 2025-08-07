// /lib/GateConnector.js - VERSÃO COMPLETA E CORRIGIDA
const axios = require("axios");
const WebSocket = require("ws");

class GateConnector {
    constructor(config, logger) {
        this.config = config;
        this.logger = logger;
        this.spotRestUrl = config.spot_api_url || "https://api.gateio.ws/api/v4/spot";
        this.futuresRestUrl = config.futures_api_url || "https://api.gateio.ws/api/v4/futures";
        this.futuresWsUrl = config.futures_ws_url || "wss://fx-ws.gateio.ws/v4/ws/usdt";
        this.maxRetries = 3;
        this.retryDelayBase = 1000;
        this.futuresWs = null;
        this.futuresTickerMap = new Map();
        this.spotTickerMap = new Map();
        this.subscriptions = new Map();
        this.reconnectInterval = 5000;
        this.pingInterval = null;
        this.pingTimeout = 30000;
        this.lastPong = Date.now();
        this.isReconnecting = false;
        this.axiosInstance = axios.create({
            headers: {
                "User-Agent": "SeuBotDeArbitragem/1.8 GateConnector",
                "Accept": "application/json",
                "Content-Type": "application/json"
            }
        });
        this.logger.info(`[GateConnector] Initialized. Spot URL: ${this.spotRestUrl}, Futures URL: ${this.futuresRestUrl}, Futures WS: ${this.futuresWsUrl}`);
    }

    async _makeRequestWithRetry(url, params = {}, method = 'get', data = {}, timeout = 30000, retries = this.maxRetries) {
        for (let attempt = 1; attempt <= retries; attempt++) {
            try {
                const reqConfig = { method, url, params: method.toLowerCase() === 'get' ? params : {}, data: method.toLowerCase() !== 'get' ? data : {}, timeout };
                const response = await this.axiosInstance(reqConfig);
                if (response.status === 200) return response.data;
                else {
                    const errorMessage = response.data?.message || response.data?.label || `Request failed with status code ${response.status}`;
                    throw new Error(errorMessage);
                }
            } catch (error) {
                let errMessage = error.message;
                if (error.response) errMessage = `Status ${error.response.status}: ${JSON.stringify(error.response.data?.message || error.response.data?.label || error.response.data).substring(0, 300)}`;
                this.logger.error(`[GateConnector] Attempt ${attempt} for ${url} failed: ${errMessage}`);
                if (attempt === retries) {
                    this.logger.error(`[GateConnector] Max retries reached for ${url}. Giving up.`);
                    throw error;
                }
                const delay = this.retryDelayBase * Math.pow(2, attempt - 1) + (Math.random() * 1000);
                this.logger.warn(`[GateConnector] Retrying in ${Math.round(delay)}ms...`);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }

    async getFuturesContractDetail() {
        const settle = "usdt";
        const requestUrl = `${this.futuresRestUrl}/${settle}/contracts`;
        this.logger.info(`[GateConnector] Fetching Gate.io futures contract details from ${requestUrl}...`);
        try {
            const responseArray = await this._makeRequestWithRetry(requestUrl);
            if (!Array.isArray(responseArray)) {
                this.logger.error(`[GateConnector] Gate.io futures contracts response is not an array. Received: ${JSON.stringify(responseArray)}`);
                return { success: false, message: "Invalid response format from Gate.io futures contracts API", data: null };
            }
            const mappedContracts = responseArray.map(contract => {
                if (contract.in_delisting === false && contract.type === 'direct' && contract.settle_asset === 'USDT') {
                    return {
                        symbol: contract.name,
                        quoteCoin: contract.quote_asset,
                        settleCoin: contract.settle_asset,
                        contractType: contract.type
                    };
                }
                return null;
            }).filter(c => c !== null);
            this.logger.info(`[GateConnector] Mapped ${mappedContracts.length} contracts after filtering (expected USDT perpetuals).`);
            return { success: true, data: mappedContracts };
        } catch (error) {
            this.logger.error(`[GateConnector] Failed to fetch/process Gate.io futures contract details: ${error.message}`);
            return { success: false, message: `Gate.io Futures Contracts Processing: ${error.message}`, data: null };
        }
    }

    async getAllSpotBookTickers() {
        const url = `${this.spotRestUrl}/tickers`;
        try {
            const response = await this._makeRequestWithRetry(url);
            const tickerMap = new Map();
            if (Array.isArray(response)) {
                for (const ticker of response) {
                    const pairSymbolApi = ticker.currency_pair;
                    const askPrice = parseFloat(ticker.lowest_ask);
                    const bidPrice = parseFloat(ticker.highest_bid);
                    if (pairSymbolApi && askPrice > 0 && bidPrice > 0) {
                        tickerMap.set(pairSymbolApi.toUpperCase(), {
                            bidPrice: bidPrice,
                            askPrice: askPrice,
                            bidQty: null, // Gate.io /tickers não fornece qty
                            askQty: null,
                            ts: Date.now()
                        });
                    }
                }
            }
            this.spotTickerMap = tickerMap;
            return tickerMap;
        } catch (error) {
            this.logger.error(`[GateConnector] Failed to fetch all Gate.io spot book tickers: ${error.message}`);
            return this.spotTickerMap;
        }
    }

    async getAllSpot24hrStats() {
        const url = `${this.spotRestUrl}/tickers`; // A rota /tickers contém o volume
        try {
            const response = await this._makeRequestWithRetry(url);
            const statsMap = new Map();
            if (Array.isArray(response)) {
                response.forEach(stat => {
                    const pairSymbolApi = stat.currency_pair;
                    const quoteVol = parseFloat(stat.quote_volume);
                    if (pairSymbolApi) {
                        statsMap.set(pairSymbolApi.toUpperCase(), {
                            quoteVolume24h: isNaN(quoteVol) ? null : quoteVol
                        });
                    }
                });
            }
            return statsMap;
        } catch (error) {
            this.logger.error(`[GateConnector] Failed to fetch all Gate.io spot 24hr stats: ${error.message}`);
            return null;
        }
    }

    async getAllFuturesBookTickers() {
        const settle = "usdt";
        const url = `${this.futuresRestUrl}/${settle}/tickers`;
        try {
            const response = await this._makeRequestWithRetry(url);
            const tickerMap = new Map();
            if (Array.isArray(response)) {
                for (const ticker of response) {
                    const pairSymbolApi = ticker.contract;
                    const askPrice = parseFloat(ticker.lowest_ask);
                    const bidPrice = parseFloat(ticker.highest_bid);
                    let volume24hQuote = parseFloat(ticker.volume_24h_quote || ticker.volume_24h_usdt);
                    let fundingRate = parseFloat(ticker.funding_rate);
                    if (pairSymbolApi && askPrice > 0 && bidPrice > 0) {
                        tickerMap.set(pairSymbolApi.toUpperCase(), {
                            bidPrice: bidPrice,
                            askPrice: askPrice,
                            bidQty: null, // Gate.io /tickers não fornece qty
                            askQty: null,
                            volume24hQuote: isNaN(volume24hQuote) ? null : volume24hQuote,
                            fundingRate: isNaN(fundingRate) ? null : fundingRate,
                            ts: parseInt(ticker.last_timestamp_ms) || Date.now()
                        });
                    }
                }
            }
            this.futuresTickerMap = tickerMap;
            return tickerMap;
        } catch (error) {
            this.logger.error(`[GateConnector] Failed to fetch all Gate.io futures book tickers: ${error.message}`);
            return this.futuresTickerMap;
        }
    }

    connectFuturesWebSocket(pairs, onOpenCallback) {
        if (!this.config.enable_futures_ws) {
            this.logger.info("[GateConnector] Futures WebSocket disabled in config.");
            if (onOpenCallback) onOpenCallback();
            return;
        }
        if (this.futuresWs && this.futuresWs.readyState === WebSocket.OPEN) {
            if (onOpenCallback) onOpenCallback();
            return;
        }
        this.logger.info(`[GateConnector] Connecting to Futures WebSocket at ${this.futuresWsUrl}`);
        this.futuresWs = new WebSocket(this.futuresWsUrl);
        
        this.futuresWs.on("open", () => {
            this.logger.info("[GateConnector] Futures WebSocket Connected");
            pairs.forEach(pair => {
                const symbol = pair.replace("/", "_").toUpperCase();
                this.futuresWs.send(JSON.stringify({
                    time: Math.floor(Date.now() / 1000),
                    channel: "futures.order_book_update",
                    event: "subscribe",
                    payload: [symbol, "20", "0"] // 0 para updates mais rápidos
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

                if (message.event === "pong") {
                    return;
                }

                if (message.event === "subscribe") {
                    this.logger.info(`[GateConnector] Successfully subscribed to channel: ${JSON.stringify(message.result)}`);
                    return;
                }

                if (message.event === "update" && message.channel === "futures.order_book_update" && message.result) {
                    const result = message.result;
                    
                    const hasBids = Array.isArray(result.b) && result.b.length > 0;
                    const hasAsks = Array.isArray(result.a) && result.a.length > 0;

                    if (result.s && (hasBids || hasAsks)) {
                        const symbol = result.s;
                        const ticker = {
                            bidPrice: hasBids ? parseFloat(result.b[0]?.p) : null,
                            askPrice: hasAsks ? parseFloat(result.a[0]?.p) : null,
                            bidQty: hasBids ? parseFloat(result.b[0]?.s) : null,
                            askQty: hasAsks ? parseFloat(result.a[0]?.s) : null,
                            ts: parseInt(message.time_ms) || Date.now()
                        };

                        if (ticker.bidPrice || ticker.askPrice) {
                            const existing = this.futuresTickerMap.get(symbol) || {};
                            this.futuresTickerMap.set(symbol, { ...existing, ...ticker });
                        }
                    }
                }
            } catch (error) {
                this.logger.error(`[GateConnector] Error processing Futures WebSocket message: ${error.message}. Raw Data: ${data.toString().substring(0, 300)}`);
            }
        });

        this.futuresWs.on("close", (code, reason) => {
            this.logger.warn(`[GateConnector] Futures WebSocket closed. Code: ${code}, Reason: ${String(reason)}`);
            this._stopPingInterval();
            this._reconnectFuturesWebSocket(pairs, onOpenCallback);
        });

        this.futuresWs.on("error", (error) => {
            this.logger.error(`[GateConnector] Futures WebSocket error: ${error.message}`);
        });
    }

    _reconnectFuturesWebSocket(pairs, onOpenCallback) {
        if (this.isReconnecting) return;
        this.isReconnecting = true;
        this.logger.info(`[GateConnector] Attempting to reconnect Futures WebSocket in ${this.reconnectInterval}ms...`);
        setTimeout(() => {
            this.isReconnecting = false;
            this.connectFuturesWebSocket(pairs, onOpenCallback);
        }, this.reconnectInterval);
    }

    _startPingInterval() {
        this._stopPingInterval();
        this.pingInterval = setInterval(() => {
            if (this.futuresWs && this.futuresWs.readyState === WebSocket.OPEN) {
                if (Date.now() - this.lastPong > this.pingTimeout) {
                    this.logger.warn("[GateConnector] Futures WebSocket pong timeout. Closing and reconnecting...");
                    this.futuresWs.terminate();
                } else {
                    try {
                        this.futuresWs.send(JSON.stringify({ time: Math.floor(Date.now() / 1000), channel: "futures.ping" }));
                    } catch (e) {
                        this.logger.error(`[GateConnector] Error sending ping: ${e.message}`);
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

    closeAll() {
        this.logger.info("[GateConnector] Closing Gate.io connections...");
        this._stopPingInterval();
        if (this.futuresWs) {
            this.futuresWs.removeAllListeners();
            this.futuresWs.close();
            this.futuresWs = null;
            this.logger.info("[GateConnector] Futures WebSocket closed");
        }
        this.subscriptions.clear();
        this.spotTickerMap.clear();
        this.futuresTickerMap.clear();
    }
}

module.exports = GateConnector;