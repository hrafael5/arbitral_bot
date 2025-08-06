// /home/ubuntu/mexc_bot/lib/GateConnector.js
const axios = require("axios");
const WebSocket = require("ws");

class GateConnector {
    constructor(config, logger) {
        this.config = config;
        this.logger = logger;
        this.spotRestUrl = config.spot_api_url || "https://api.gateio.ws/api/v4/spot";
        this.futuresRestUrl = config.futures_api_url || "https://api.gateio.ws/api/v4/futures";
        this.spotWsUrl = "wss://ws.gate.io/v4/"; // Gate.io Spot WebSocket URL
        this.futuresWsUrl = "wss://fxws.gateio.ws/v4/"; // Gate.io Futures WebSocket URL
        this.maxRetries = 3;
        this.retryDelayBase = 1000;
        this.axiosInstance = axios.create({
            headers: {
                "User-Agent": "SeuBotDeArbitragem/1.6 GateConnector",
                "Accept": "application/json",
                "Content-Type": "application/json"
            }
        });
        this.logger.info(`[GateConnector] Initialized. Spot URL: ${this.spotRestUrl}, Futures URL: ${this.futuresRestUrl}`);
        this.onMarketDataUpdate = () => {}; // Callback para o MarketMonitor
        this.spotWs = null;
        this.futuresWs = null;
        this.isSpotReconnecting = false;
        this.isFuturesReconnecting = false;
        this.spotReconnectInterval = 5000;
        this.futuresReconnectInterval = 5000;
        this.spotPingInterval = null;
        this.futuresPingInterval = null;
        this.spotLastPong = Date.now();
        this.futuresLastPong = Date.now();
    }

    setOnMarketDataUpdateCallback(callback) {
        this.onMarketDataUpdate = callback;
    }

    async _makeRequestWithRetry(url, params = {}, method = 'get', data = {}, timeout = 60000, retries = this.maxRetries) {
        for (let attempt = 1; attempt <= retries; attempt++) {
            try {
                this.logger.debug(`[GateConnector] Sending request to ${url} with params: ${JSON.stringify(params)}`);
                const reqConfig = { method, url, params: method.toLowerCase() === 'get' ? params : {}, data: method.toLowerCase() !== 'get' ? data : {}, timeout };
                const response = await this.axiosInstance(reqConfig);
                this.logger.debug(`[GateConnector] Received response from ${url}. Status: ${response.status}`);
                if (response.status === 200) return response.data;
                else {
                    const errorMessage = response.data?.message || response.data?.label || `Request failed with status code ${response.status}`;
                    throw new Error(errorMessage);
                }
            } catch (error) {
                let errMessage = error.message;
                if (error.response) errMessage = `Status ${error.response.status}: ${JSON.stringify(error.response.data?.message || error.response.data?.label || error.response.data).substring(0,300)}`;
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
            this.logger.info(`[GateConnector] Fetched ${responseArray.length} raw contract items from Gate.io.`);

            let mappedCount = 0;

            const mappedContracts = responseArray
                .map(contract => {
                    const name = contract.name;
                    const type = contract.type;
                    let quoteAssetRaw = contract.quote_asset;
                    let settleAssetRaw = contract.settle_asset;
                    const inDelisting = contract.in_delisting;

                    let effectiveQuoteAsset = quoteAssetRaw;
                    let effectiveSettleAsset = settleAssetRaw;

                    if (requestUrl.includes(`/${settle}/contracts`)) {
                        if (quoteAssetRaw === undefined || String(quoteAssetRaw).toUpperCase() === 'UNDEFINED') {
                            effectiveQuoteAsset = "USDT";
                            this.logger.debug(`[Gate_Asset_Override] Contract '${name}': Original quote_asset was '${quoteAssetRaw}'. Overriding to 'USDT' based on endpoint.`);
                        }
                        if (settleAssetRaw === undefined || String(settleAssetRaw).toUpperCase() === 'UNDEFINED') {
                            effectiveSettleAsset = "USDT";
                             this.logger.debug(`[Gate_Asset_Override] Contract '${name}': Original settle_asset was '${settleAssetRaw}'. Overriding to 'USDT' based on endpoint.`);
                        }
                    }

                    this.logger.debug(
                        `[Gate_RawContractValues_Processed] Name: '${name}', Type: '${type}', QuoteAsset (Raw): '${quoteAssetRaw}', SettleAsset (Raw): '${settleAssetRaw}', EffectiveQuote: '${effectiveQuoteAsset}', EffectiveSettle: '${effectiveSettleAsset}', InDelisting: ${inDelisting}`
                    );

                    const symbolForBot = name;
                    const quoteCoinForBot = effectiveQuoteAsset ? String(effectiveQuoteAsset).toUpperCase() : null;
                    const settleCoinForBot = effectiveSettleAsset ? String(effectiveSettleAsset).toUpperCase() : null;
                    const typeForFilter = type ? String(type).toLowerCase() : null;

                    const condSymbol = !!symbolForBot;
                    const condQuote = quoteCoinForBot === "USDT";
                    const condSettle = settleCoinForBot === "USDT";
                    const condType = typeForFilter === "direct";
                    const condTradable = (inDelisting === false);

                    const passesFilter = condSymbol && condQuote && condSettle && condType && condTradable;

                    if (passesFilter) {
                        mappedCount++;
                        return {
                            symbol: symbolForBot,
                            quoteCoin: quoteCoinForBot,
                            settleCoin: settleCoinForBot,
                            _gate_name: name, _gate_type: type, _gate_quote_asset: quoteAssetRaw,
                            _gate_settle_asset: settleAssetRaw,
                            _gate_in_delisting: inDelisting
                        };
                    } else {
                        this.logger.debug(
                            `[GateConnector_ContractMap_Fail] Contract '${name}' did not pass. ` +
                            `SymbolOK(${condSymbol}), QuoteOK(${condQuote}), SettleOK(${condSettle}), TypeOK(${condType}), TradableOK(${condTradable}). ` +
                            `Values: [Symbol: ${symbolForBot}, Quote (Eff): ${quoteCoinForBot}, Settle (Eff): ${settleCoinForBot}, Type: ${typeForFilter}, InDelisting: ${inDelisting}, OrigQuote: ${quoteAssetRaw}, OrigSettle: ${settleAssetRaw}]`
                        );
                        return null;
                    }
                })
                .filter(contract => contract !== null);

            this.logger.info(`[GateConnector] Mapped ${mappedCount} contracts after preliminary filtering (expected USDT perpetuals). Total raw items: ${responseArray.length}.`);

            return {
                success: true,
                data: mappedContracts
            };
        } catch (error) {
            this.logger.error(`[GateConnector] Failed to fetch/process Gate.io futures contract details: ${error.message} (URL: ${requestUrl})`);
            return { success: false, message: `Gate.io Futures Contracts Processing: ${error.message}`, data: null };
        }
    }

    // WebSocket for Spot Market Data
    connectSpotWebSocket(pairs) {
        if (this.spotWs && this.spotWs.readyState === WebSocket.OPEN) {
            this.logger.info("[GateConnector] Spot WebSocket already open.");
            return;
        }
        if (this.isSpotReconnecting) return;

        this.logger.info(`[GateConnector] Connecting to Spot WebSocket at ${this.spotWsUrl} for market data...`);
        this.spotWs = new WebSocket(this.spotWsUrl);

        this.spotWs.on("open", () => {
            this.logger.info("[GateConnector] Spot WebSocket Connected.");
            this.isSpotReconnecting = false;
            this.spotLastPong = Date.now();
            this._startSpotPingInterval();
            // Subscribe to market data for relevant pairs
            pairs.forEach(pair => {
                const symbol = pair.replace("/", "_").toLowerCase(); // BTC/USDT -> btc_usdt
                const subscriptionMessage = {
                    time: Math.floor(Date.now() / 1000),
                    channel: "spot.tickers",
                    event: "subscribe",
                    payload: [symbol]
                };
                this.spotWs.send(JSON.stringify(subscriptionMessage));
                this.logger.debug(`[GateConnector] Subscribed to Spot tickers for ${symbol}`);
            });
        });

        this.spotWs.on("message", (data) => {
            this.spotLastPong = Date.now();
            try {
                const message = JSON.parse(data.toString());
                if (message.event === "update" && message.channel === "spot.tickers" && message.result && message.result.currency_pair) {
                    const symbol = message.result.currency_pair.toUpperCase(); // btc_usdt -> BTC_USDT
                    const tickerData = {
                        bidPrice: parseFloat(message.result.highest_bid),
                        askPrice: parseFloat(message.result.lowest_ask),
                        bidQty: parseFloat(message.result.buy_amount) || null, // Gate.io spot WS provides buy/sell amount
                        askQty: parseFloat(message.result.sell_amount) || null,
                        ts: parseInt(message.result.last_update_time) * 1000 || Date.now()
                    };
                    this.onMarketDataUpdate("gateio", "spot", symbol, tickerData);
                } else if (message.event === "pong") {
                    // this.logger.debug("[GateConnector] Spot WebSocket pong received.");
                } else {
                    this.logger.debug(`[GateConnector] Received unknown Spot WS message: ${JSON.stringify(message)}`);
                }
            } catch (error) {
                this.logger.error(`[GateConnector] Error processing Spot WebSocket message: ${error.message}. Raw data: ${data}`);
            }
        });

        this.spotWs.on("close", (code, reason) => {
            const rS = reason ? reason.toString() : "";
            this.logger.warn(`[GateConnector] Spot WebSocket closed. Code: ${code}, Reason: ${rS}`);
            this._stopSpotPingInterval();
            this._reconnectSpotWebSocket(pairs);
        });

        this.spotWs.on("error", (error) => {
            this.logger.error("[GateConnector] Spot WebSocket error:", error.message);
        }); 
    }

    _reconnectSpotWebSocket(pairs) {
        if(this.isSpotReconnecting) return;
        this.isSpotReconnecting = true;
        this.logger.info(`[GateConnector] Attempting to reconnect Spot WebSocket in ${this.spotReconnectInterval}ms...`);
        setTimeout(() => {
            this.isSpotReconnecting = false;
            this.connectSpotWebSocket(pairs);
        }, this.spotReconnectInterval);
    }

    _startSpotPingInterval() {
        this._stopSpotPingInterval();
        this.spotPingInterval = setInterval(() => {
            if (this.spotWs && this.spotWs.readyState === WebSocket.OPEN) {
                if (Date.now() - this.spotLastPong > 30000) { // Gate.io expects ping every 30s
                    this.logger.warn("[GateConnector] Spot WebSocket pong timeout. Closing and reconnecting...");
                    this.spotWs.terminate(); 
                    this._reconnectSpotWebSocket([]);
                } else {
                    try {
                        this.spotWs.send(JSON.stringify({ time: Math.floor(Date.now() / 1000), channel: "spot.ping" }));
                        // this.logger.debug("[GateConnector] Spot WebSocket ping sent.");
                    } catch (e) {
                        this.logger.error("[GateConnector] Error sending ping to Spot WS:", e.message);
                    }
                }
            }
        }, 20000); // Send ping every 20 seconds
    }

    _stopSpotPingInterval() {
        if(this.spotPingInterval) {
            clearInterval(this.spotPingInterval);
            this.spotPingInterval = null;
        }
    }

    // WebSocket for Futures Market Data
    connectFuturesWebSocket(pairs) {
        if (this.futuresWs && this.futuresWs.readyState === WebSocket.OPEN) {
            this.logger.info("[GateConnector] Futures WebSocket already open.");
            return;
        }
        if (this.isFuturesReconnecting) return;

        this.logger.info(`[GateConnector] Connecting to Futures WebSocket at ${this.futuresWsUrl} for market data...`);
        this.futuresWs = new WebSocket(this.futuresWsUrl);

        this.futuresWs.on("open", () => {
            this.logger.info("[GateConnector] Futures WebSocket Connected.");
            this.isFuturesReconnecting = false;
            this.futuresLastPong = Date.now();
            this._startFuturesPingInterval();
            // Subscribe to market data for relevant pairs
            pairs.forEach(pair => {
                const symbol = pair.replace("/", "_").toLowerCase(); // BTC/USDT -> btc_usdt
                const subscriptionMessage = {
                    time: Math.floor(Date.now() / 1000),
                    channel: "futures.tickers",
                    event: "subscribe",
                    payload: [symbol, "usdt"]
                };
                this.futuresWs.send(JSON.stringify(subscriptionMessage));
                this.logger.debug(`[GateConnector] Subscribed to Futures tickers for ${symbol}`);
            });
        });

        this.futuresWs.on("message", (data) => {
            this.futuresLastPong = Date.now();
            try {
                const message = JSON.parse(data.toString());
                if (message.event === "update" && message.channel === "futures.tickers" && message.result && message.result.contract) {
                    const symbol = message.result.contract.toUpperCase(); // btc_usdt -> BTC_USDT
                    const tickerData = {
                        bidPrice: parseFloat(message.result.highest_bid),
                        askPrice: parseFloat(message.result.lowest_ask),
                        bidQty: null, // Not directly available in this stream
                        askQty: null, // Not directly available in this stream
                        volume24hQuote: parseFloat(message.result.volume_24h_base) || parseFloat(message.result.volume_24h_quote),
                        fundingRate: parseFloat(message.result.funding_rate_indicative || message.result.funding_rate),
                        ts: parseInt(message.result.last_update_time) * 1000 || Date.now()
                    };
                    this.onMarketDataUpdate("gateio", "futures", symbol, tickerData);
                } else if (message.event === "pong") {
                    // this.logger.debug("[GateConnector] Futures WebSocket pong received.");
                } else {
                    this.logger.debug(`[GateConnector] Received unknown Futures WS message: ${JSON.stringify(message)}`);
                }
            } catch (error) {
                this.logger.error(`[GateConnector] Error processing Futures WebSocket message: ${error.message}. Raw data: ${data}`);
            }
        });

        this.futuresWs.on("close", (code, reason) => {
            const rS = reason ? reason.toString() : "";
            this.logger.warn(`[GateConnector] Futures WebSocket closed. Code: ${code}, Reason: ${rS}`);
            this._stopFuturesPingInterval();
            this._reconnectFuturesWebSocket(pairs);
        });

        this.futuresWs.on("error", (error) => {
            this.logger.error("[GateConnector] Futures WebSocket error:", error.message);
        }); 
    }

    _reconnectFuturesWebSocket(pairs) {
        if(this.isFuturesReconnecting) return;
        this.isFuturesReconnecting = true;
        this.logger.info(`[GateConnector] Attempting to reconnect Futures WebSocket in ${this.futuresReconnectInterval}ms...`);
        setTimeout(() => {
            this.isFuturesReconnecting = false;
            this.connectFuturesWebSocket(pairs);
        }, this.futuresReconnectInterval);
    }

    _startFuturesPingInterval() {
        this._stopFuturesPingInterval();
        this.futuresPingInterval = setInterval(() => {
            if (this.futuresWs && this.futuresWs.readyState === WebSocket.OPEN) {
                if (Date.now() - this.futuresLastPong > 30000) { // Gate.io expects ping every 30s
                    this.logger.warn("[GateConnector] Futures WebSocket pong timeout. Closing and reconnecting...");
                    this.futuresWs.terminate(); 
                    this._reconnectFuturesWebSocket([]);
                } else {
                    try {
                        this.futuresWs.send(JSON.stringify({ time: Math.floor(Date.now() / 1000), channel: "futures.ping" }));
                        // this.logger.debug("[GateConnector] Futures WebSocket ping sent.");
                    } catch (e) {
                        this.logger.error("[GateConnector] Error sending ping to Futures WS:", e.message);
                    }
                }
            }
        }, 20000); // Send ping every 20 seconds
    }

    _stopFuturesPingInterval() {
        if(this.futuresPingInterval) {
            clearInterval(this.futuresPingInterval);
            this.futuresPingInterval = null;
        }
    }

    closeAll() {
        this.logger.info("[GateConnector] Closing Gate.io connections...");
        this._stopSpotPingInterval();
        this._stopFuturesPingInterval();
        if(this.spotWs) {
            this.spotWs.removeAllListeners();
            this.spotWs.close();
            this.spotWs = null;
            this.logger.info("[GateConnector] Spot WebSocket closed.");
        }
        if(this.futuresWs) {
            this.futuresWs.removeAllListeners();
            this.futuresWs.close();
            this.futuresWs = null;
            this.logger.info("[GateConnector] Futures WebSocket closed.");
        }
    }
}

module.exports = GateConnector;


