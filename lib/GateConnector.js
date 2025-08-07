// /lib/GateConnector.js - VERSÃO COM ESTRATÉGIA FINAL
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
                "User-Agent": "SeuBotDeArbitragem/1.9 GateConnector",
                "Accept": "application/json",
                "Content-Type": "application/json"
            }
        });
        this.logger.info(`[GateConnector] Initialized. Spot URL: ${this.spotRestUrl}, Futures URL: ${this.futuresRestUrl}, Futures WS: ${this.futuresWsUrl}`);
    }

    async _makeRequestWithRetry(url, params = {}, method = 'get', data = {}, timeout = 30000, retries = this.maxRetries) {
        // ... (código existente sem alterações)
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

    // ... (outras funções REST API sem alterações)

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
                // --- INÍCIO DA CORREÇÃO ---
                // Mudando para o canal 'futures.book_ticker', que é mais simples e direto
                this.futuresWs.send(JSON.stringify({
                    time: Math.floor(Date.now() / 1000),
                    channel: "futures.book_ticker",  // <-- ESTRATÉGIA NOVA
                    event: "subscribe",
                    payload: [symbol]                 // <-- PAYLOAD SIMPLIFICADO
                }));
                // --- FIM DA CORREÇÃO ---
                this.subscriptions.set(symbol, true);
            });
            this._startPingInterval();
            if (onOpenCallback) onOpenCallback();
        });

        this.futuresWs.on("message", (data) => {
            this.lastPong = Date.now();
            try {
                const message = JSON.parse(data.toString());

                if (message.event === "pong") return;

                if (message.event === "subscribe") {
                    this.logger.info(`[GateConnector] Subscription response for channel ${message.channel}: ${JSON.stringify(message.result)}`);
                    return;
                }
                
                // --- INÍCIO DA CORREÇÃO ---
                // Adaptando o código para processar mensagens do canal 'futures.book_ticker'
                if (message.event === "update" && message.channel === "futures.book_ticker" && message.result) {
                    const result = message.result;
                    const symbol = result.s;
                    
                    if (symbol) {
                        const ticker = {
                            bidPrice: parseFloat(result.b) || null, // Best bid price
                            askPrice: parseFloat(result.a) || null, // Best ask price
                            bidQty: parseFloat(result.B) || null,   // Best bid size
                            askQty: parseFloat(result.A) || null,   // Best ask size
                            ts: parseInt(result.t) || Date.now()
                        };

                        if (ticker.bidPrice && ticker.askPrice) {
                            const existing = this.futuresTickerMap.get(symbol) || {};
                            this.futuresTickerMap.set(symbol, { ...existing, ...ticker });
                        }
                    }
                }
                // --- FIM DA CORREÇÃO ---

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
        // ... (código existente sem alterações)
        if (this.isReconnecting) return;
        this.isReconnecting = true;
        this.logger.info(`[GateConnector] Attempting to reconnect Futures WebSocket in ${this.reconnectInterval}ms...`);
        setTimeout(() => {
            this.isReconnecting = false;
            this.connectFuturesWebSocket(pairs, onOpenCallback);
        }, this.reconnectInterval);
    }

    _startPingInterval() {
        // ... (código existente sem alterações)
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
        // ... (código existente sem alterações)
        if (this.pingInterval) {
            clearInterval(this.pingInterval);
            this.pingInterval = null;
        }
    }
    
    closeAll() {
        // ... (código existente sem alterações)
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