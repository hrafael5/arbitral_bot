// /home/ubuntu/mexc_bot/lib/MEXCConnector.js
const axios = require("axios");
const WebSocket = require("ws");

class MEXCConnector {
    constructor(config, logger) {
        this.config = config; 
        this.logger = logger;
        this.futuresWs = null;
        this.spotWs = null;
        this.futuresWsUrl = "wss://contract.mexc.com/edge";
        this.spotWsUrl = "wss://wbs-api.mexc.com/ws"; // MEXC Spot WebSocket URL
        this.spotRestUrl = this.config.spot_api_url || "https://api.mexc.com/api/v3";
        this.futuresRestUrl = this.config.futures_api_url || "https://contract.mexc.com/api/v1/contract";
        this.subscriptions = new Map();
        this.futuresReconnectInterval = 5000;
        this.spotReconnectInterval = 5000;
        this.futuresPingInterval = null;
        this.spotPingInterval = null;
        this.futuresPingTimeout = 30000;
        this.spotPingTimeout = 30000;
        this.futuresLastPong = Date.now();
        this.spotLastPong = Date.now();
        this.isFuturesReconnecting = false;
        this.isSpotReconnecting = false;
        this.maxRetries = 3;
        this.retryDelayBase = 1000;
        this.axiosInstance = axios.create({
            headers: { "User-Agent": "SeuBotDeArbitragem/1.1 MEXCConnector" }
        });
        this.logger.info(`[MEXCConnector] Initialized. Spot URL: ${this.spotRestUrl}, Futures URL: ${this.futuresRestUrl}`);
        this.onMarketDataUpdate = () => {}; // Callback para o MarketMonitor
    }

    setOnMarketDataUpdateCallback(callback) {
        this.onMarketDataUpdate = callback;
    }

    async _makeRequestWithRetry(url, params = {}, timeout = 30000, retries = this.maxRetries) {
        for (let attempt = 1; attempt <= retries; attempt++) {
            try {
                const response = await this.axiosInstance.get(url, { params, timeout });
                if (response.status === 200) {
                    return response.data;
                } else {
                    const mexcErrorMessage = response.data?.msg || response.data?.message || `Request failed with status code ${response.status}`;
                    throw new Error(mexcErrorMessage);
                }
            } catch (error) {
                const errMessage = error.response?.data?.msg || error.response?.data?.message || error.message;
                this.logger.error(`[MEXCConnector] Attempt ${attempt} failed for ${url}: ${errMessage}`);
                if (attempt === retries) {
                    this.logger.error(`[MEXCConnector] Max retries reached for ${url}. Giving up.`);
                    throw error; 
                }
                const delay = this.retryDelayBase * Math.pow(2, attempt - 1) + (Math.random() * 1000);
                this.logger.warn(`[MEXCConnector] Retrying in ${Math.round(delay)}ms...`);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }

    // REST API methods (kept for contract details, but market data will use WS)
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

    // WebSocket for Futures Market Data
    connectFuturesWebSocket(pairs) {
        if (this.futuresWs && this.futuresWs.readyState === WebSocket.OPEN) {
            this.logger.info("[MEXCConnector] Futures WebSocket already open.");
            return;
        }
        if (this.isFuturesReconnecting) return;

        this.logger.info(`[MEXCConnector] Connecting to Futures WebSocket at ${this.futuresWsUrl} for market data...`);
        this.futuresWs = new WebSocket(this.futuresWsUrl);

        this.futuresWs.on("open", () => {
            this.logger.info("[MEXCConnector] Futures WebSocket Connected.");
            this.isFuturesReconnecting = false;
            this.futuresLastPong = Date.now();
            this._startFuturesPingInterval();
            // Subscribe to market data for relevant pairs
            pairs.forEach(pair => {
                const symbol = pair.replace("/", "_"); // BTC/USDT -> BTC_USDT
                const subscriptionMessage = {
                    method: "sub.ticker",
                    param: {
                        symbol: symbol
                    }
                };
                this.futuresWs.send(JSON.stringify(subscriptionMessage));
                this.logger.debug(`[MEXCConnector] Subscribed to Futures ticker for ${symbol}`);
            });
        });

        this.futuresWs.on("message", (data) => {
            this.futuresLastPong = Date.now();
            try {
                const message = JSON.parse(data.toString());
                if (message.method === "pong") {
                    // this.logger.debug("[MEXCConnector] Futures WebSocket pong received.");
                } else if (message.code === 0 && message.data && message.data.symbol) {
                    // Process futures ticker data
                    const symbol = message.data.symbol.replace("_", "/").toUpperCase(); // BTC_USDT -> BTC/USDT
                    const tickerData = {
                        bidPrice: parseFloat(message.data.bid1),
                        askPrice: parseFloat(message.data.ask1),
                        bidQty: parseFloat(message.data.bidSize1),
                        askQty: parseFloat(message.data.askSize1),
                        volume24hQuote: parseFloat(message.data.amount24),
                        fundingRate: parseFloat(message.data.fundingRate),
                        ts: parseInt(message.data.timestamp)
                    };
                    this.onMarketDataUpdate("mexc", "futures", symbol, tickerData);
                } else {
                    this.logger.debug(`[MEXCConnector] Received unknown Futures WS message: ${JSON.stringify(message)}`);
                }
            } catch (error) {
                this.logger.error(`[MEXCConnector] Error processing Futures WebSocket message: ${error.message}. Raw data: ${data}`);
            }
        });

        this.futuresWs.on("close", (code, reason) => {
            const rS = reason ? reason.toString() : "";
            this.logger.warn(`[MEXCConnector] Futures WebSocket closed. Code: ${code}, Reason: ${rS}`);
            this._stopFuturesPingInterval();
            this._reconnectFuturesWebSocket(pairs);
        });

        this.futuresWs.on("error", (error) => {
            this.logger.error("[MEXCConnector] Futures WebSocket error:", error.message);
        }); 

        this.futuresWs.on("unexpected-response", (req, res) => {
            this.logger.error(`[MEXCConnector] Futures WebSocket unexpected response. Status Code: ${res.statusCode}`);
        });
    }

    _reconnectFuturesWebSocket(pairs) {
        if(this.isFuturesReconnecting) return;
        this.isFuturesReconnecting = true;
        this.logger.info(`[MEXCConnector] Attempting to reconnect Futures WebSocket in ${this.futuresReconnectInterval}ms...`);
        setTimeout(() => {
            this.isFuturesReconnecting = false;
            this.connectFuturesWebSocket(pairs);
        }, this.futuresReconnectInterval);
    }

    _startFuturesPingInterval() {
        this._stopFuturesPingInterval();
        this.futuresPingInterval = setInterval(() => {
            if (this.futuresWs && this.futuresWs.readyState === WebSocket.OPEN) {
                if (Date.now() - this.futuresLastPong > this.futuresPingTimeout) {
                    this.logger.warn("[MEXCConnector] Futures WebSocket pong timeout. Closing and reconnecting...");
                    this.futuresWs.terminate(); 
                    this._reconnectFuturesWebSocket([]); // Pass empty array as pairs will be resubscribed on open
                } else {
                    try {
                        this.futuresWs.send(JSON.stringify({ method: "ping" }));
                        // this.logger.debug("[MEXCConnector] Futures WebSocket ping sent.");
                    } catch (e) {
                        this.logger.error("[MEXCConnector] Error sending ping to Futures WS:", e.message);
                    }
                }
            }
        }, 10000);
    }

    _stopFuturesPingInterval() {
        if(this.futuresPingInterval) {
            clearInterval(this.futuresPingInterval);
            this.futuresPingInterval = null;
        }
    }

    // WebSocket for Spot Market Data
    connectSpotWebSocket(pairs) {
        if (this.spotWs && this.spotWs.readyState === WebSocket.OPEN) {
            this.logger.info("[MEXCConnector] Spot WebSocket already open.");
            return;
        }
        if (this.isSpotReconnecting) return;

        this.logger.info(`[MEXCConnector] Connecting to Spot WebSocket at ${this.spotWsUrl} for market data...`);
        this.spotWs = new WebSocket(this.spotWsUrl);

        this.spotWs.on("open", () => {
            this.logger.info("[MEXCConnector] Spot WebSocket Connected.");
            this.isSpotReconnecting = false;
            this.spotLastPong = Date.now();
            this._startSpotPingInterval();
            // Subscribe to market data for relevant pairs
            pairs.forEach(pair => {
                const symbol = pair.replace("/", ""); // BTC/USDT -> BTCUSDT
                const subscriptionMessage = {
                    method: "SUBSCRIPTION",
                    params: [`spot@public.bookTicker.v3.api@${symbol}`],
                    id: 1 // Unique ID for subscription
                };
                this.spotWs.send(JSON.stringify(subscriptionMessage));
                this.logger.debug(`[MEXCConnector] Subscribed to Spot bookTicker for ${symbol}`);
            });
        });

        this.spotWs.on("message", (data) => {
            this.spotLastPong = Date.now();
            try {
                const message = JSON.parse(data.toString());
                if (message.code === 0 && message.data && message.data.s) {
                    // Process spot ticker data
                    const symbol = message.data.s.toUpperCase(); // BTCUSDT -> BTCUSDT
                    const tickerData = {
                        bidPrice: parseFloat(message.data.b),
                        askPrice: parseFloat(message.data.a),
                        bidQty: parseFloat(message.data.B),
                        askQty: parseFloat(message.data.A),
                        ts: Date.now() // MEXC spot WS doesn't provide timestamp, use local
                    };
                    this.onMarketDataUpdate("mexc", "spot", symbol, tickerData);
                } else if (message.method === "ping") {
                    // this.logger.debug("[MEXCConnector] Spot WebSocket ping received.");
                    this.spotWs.send(JSON.stringify({ method: "pong" }));
                } else {
                    this.logger.debug(`[MEXCConnector] Received unknown Spot WS message: ${JSON.stringify(message)}`);
                }
            } catch (error) {
                this.logger.error(`[MEXCConnector] Error processing Spot WebSocket message: ${error.message}. Raw data: ${data}`);
            }
        });

        this.spotWs.on("close", (code, reason) => {
            const rS = reason ? reason.toString() : ";
            this.logger.warn(`[MEXCConnector] Spot WebSocket closed. Code: ${code}, Reason: ${rS}`);
            this._stopSpotPingInterval();
            this._reconnectSpotWebSocket(pairs);
        });

        this.spotWs.on("error", (error) => {
            this.logger.error("[MEXCConnector] Spot WebSocket error:", error.message);
        }); 

        this.spotWs.on("unexpected-response", (req, res) => {
            this.logger.error(`[MEXCConnector] Spot WebSocket unexpected response. Status Code: ${res.statusCode}`);
        });
    }

    _reconnectSpotWebSocket(pairs) {
        if(this.isSpotReconnecting) return;
        this.isSpotReconnecting = true;
        this.logger.info(`[MEXCConnector] Attempting to reconnect Spot WebSocket in ${this.spotReconnectInterval}ms...`);
        setTimeout(() => {
            this.isSpotReconnecting = false;
            this.connectSpotWebSocket(pairs);
        }, this.spotReconnectInterval);
    }

    _startSpotPingInterval() {
        this._stopSpotPingInterval();
        this.spotPingInterval = setInterval(() => {
            if (this.spotWs && this.spotWs.readyState === WebSocket.OPEN) {
                if (Date.now() - this.spotLastPong > this.spotPingTimeout) {
                    this.logger.warn("[MEXCConnector] Spot WebSocket pong timeout. Closing and reconnecting...");
                    this.spotWs.terminate(); 
                    this._reconnectSpotWebSocket([]); // Pass empty array as pairs will be resubscribed on open
                } else {
                    try {
                        this.spotWs.send(JSON.stringify({ method: "ping" }));
                        // this.logger.debug("[MEXCConnector] Spot WebSocket ping sent.");
                    } catch (e) {
                        this.logger.error("[MEXCConnector] Error sending ping to Spot WS:", e.message);
                    }
                }
            }
        }, 10000);
    }

    _stopSpotPingInterval() {
        if(this.spotPingInterval) {
            clearInterval(this.spotPingInterval);
            this.spotPingInterval = null;
        }
    }

    closeAll() {
        this.logger.info("[MEXCConnector] Closing MEXC connections...");
        this._stopFuturesPingInterval();
        this._stopSpotPingInterval();
        if(this.futuresWs) {
            this.futuresWs.removeAllListeners();
            this.futuresWs.close();
            this.futuresWs = null;
            this.logger.info("[MEXCConnector] Futures WebSocket closed.");
        }
        if(this.spotWs) {
            this.spotWs.removeAllListeners();
            this.spotWs.close();
            this.spotWs = null;
            this.logger.info("[MEXCConnector] Spot WebSocket closed.");
        }
        this.subscriptions.clear();
    }
}

module.exports = MEXCConnector;


