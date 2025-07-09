// /home/ubuntu/mexc_bot/lib/MEXCConnector.js
const axios = require("axios");
const WebSocket = require("ws");

class MEXCConnector {
    constructor(config, logger) {
        this.config = config; 
        this.logger = logger;
        this.futuresWs = null;
        this.futuresWsUrl = "wss://contract.mexc.com/edge";
        this.spotRestUrl = this.config.spot_api_url || "https://api.mexc.com/api/v3";
        this.futuresRestUrl = this.config.futures_api_url || "https://contract.mexc.com/api/v1/contract";
        this.subscriptions = new Map();
        this.futuresReconnectInterval = 5000;
        this.futuresPingInterval = null;
        this.futuresPingTimeout = 30000;
        this.futuresLastPong = Date.now();
        this.isReconnecting = false;
        this.maxRetries = 3;
        this.retryDelayBase = 1000;
        this.axiosInstance = axios.create({
            headers: { "User-Agent": "SeuBotDeArbitragem/1.1 MEXCConnector" }
        });
        this.logger.info(`[MEXCConnector] Initialized. Spot URL: ${this.spotRestUrl}, Futures URL: ${this.futuresRestUrl}`);
    }

    async _makeRequestWithRetry(url, params = {}, timeout = 15000, retries = this.maxRetries) {
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

    async getAllSpotBookTickers() {
        const url = `${this.spotRestUrl}/ticker/bookTicker`;
        try {
            const response = await this._makeRequestWithRetry(url, {}, 20000);
            const tickerMap = new Map();
            if (Array.isArray(response)) {
                response.forEach(ticker => {
                    const bidPrice = parseFloat(ticker.bidPrice);
                    const askPrice = parseFloat(ticker.askPrice);
                    // MEXC usa "BTCUSDT"
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
            this.logger.info(`[MEXCConnector_DEBUG] getAllSpotBookTickers fetched ${tickerMap.size} valid items.`);
            return tickerMap;
        } catch (error) {
            this.logger.error(`[MEXCConnector] Failed to fetch all MEXC spot book tickers: ${error.message}`);
            return null;
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
            this.logger.info(`[MEXCConnector_DEBUG] getAllSpot24hrStats fetched ${statsMap.size} valid items.`);
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

    async getAllFuturesBookTickers() {
        const endpointPath = "ticker";
        const url = `${this.futuresRestUrl}/${endpointPath}`;
        try {
            const response = await this._makeRequestWithRetry(url, {}, 20000);
            const tickerMap = new Map();
            if (response && response.success && Array.isArray(response.data)) {
                response.data.forEach(ticker => {
                    // MEXC futuros usa "BTC_USDT"
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
            this.logger.info(`[MEXCConnector_DEBUG] getAllFuturesBookTickers fetched ${tickerMap.size} valid items.`);
            return tickerMap;
        } catch (error) {
            this.logger.error(`[MEXCConnector] Failed to fetch all MEXC futures book tickers: ${error.message}`);
            return null;
        }
    }
    
    // Métodos WebSocket ... (mantidos como na sua última versão, que parecia estar ok)
    connectFuturesWebSocket(onOpenCallback) { /* ... (código da sua última versão) ... */ 
        if (this.futuresWs && this.futuresWs.readyState === WebSocket.OPEN) { if (onOpenCallback) onOpenCallback(); return; }
        if (this.isReconnecting) return;
        this.logger.info(`[MEXCConnector] Connecting to Futures WebSocket at ${this.futuresWsUrl} (for ping/pong)...`);
        this.futuresWs = new WebSocket(this.futuresWsUrl);
        this.futuresWs.on("open", () => { this.logger.info("[MEXCConnector] Futures WebSocket Connected (onOpen event)."); this.isReconnecting = false; this.futuresLastPong = Date.now(); this._startPingInterval(); if (onOpenCallback) onOpenCallback(); });
        this.futuresWs.on("message", (data) => { this.futuresLastPong = Date.now(); try { const message = JSON.parse(data.toString()); if (message.method === "pong") { /*this.logger.debug('[MEXCConnector] Futures WebSocket pong received.');*/ } } catch (error) { this.logger.error(`[MEXCConnector] Error processing WebSocket message: ${error.message}. Raw data: ${data}`); }});
        this.futuresWs.on("close", (code, reason) => { const rS = reason ? reason.toString() : ''; this.logger.warn(`[MEXCConnector] Futures WebSocket closed. Code: ${code}, Reason: ${rS}`); this._stopPingInterval(); this._reconnectFuturesWebSocket(onOpenCallback); });
        this.futuresWs.on("error", (error) => { this.logger.error("[MEXCConnector] Futures WebSocket error:", error.message); }); 
        this.futuresWs.on('unexpected-response', (req, res) => { this.logger.error(`[MEXCConnector] Futures WebSocket unexpected response. Status Code: ${res.statusCode}`); });
    }
    _reconnectFuturesWebSocket(onOpenCallback) { /* ... (código da sua última versão) ... */ 
        if(this.isReconnecting)return;this.isReconnecting=true;this.logger.info(`[MEXCConnector] Attempting to reconnect Futures WebSocket in ${this.futuresReconnectInterval}ms...`);setTimeout(()=>{this.isReconnecting=false;this.connectFuturesWebSocket(onOpenCallback);},this.futuresReconnectInterval);
    }
    _startPingInterval() { /* ... (código da sua última versão) ... */ 
        this._stopPingInterval();this.futuresPingInterval=setInterval(()=>{if(this.futuresWs&&this.futuresWs.readyState===WebSocket.OPEN){if(Date.now()-this.futuresLastPong>this.futuresPingTimeout){this.logger.warn("[MEXCConnector] Futures WebSocket pong timeout. Closing and reconnecting...");this.futuresWs.terminate(); this._reconnectFuturesWebSocket(()=>{});}else{try{this.futuresWs.send(JSON.stringify({method:"ping"})); /*this.logger.debug('[MEXCConnector] Futures WebSocket ping sent.');*/}catch(e){this.logger.error('[MEXCConnector] Error sending ping to Futures WS:', e.message);}}}},10000);
    }
    _stopPingInterval() { /* ... (código da sua última versão) ... */ 
        if(this.futuresPingInterval){clearInterval(this.futuresPingInterval);this.futuresPingInterval=null;}
    }
    closeAll() { /* ... (código da sua última versão) ... */ 
        this.logger.info("[MEXCConnector] Closing MEXC connections...");this._stopPingInterval();if(this.futuresWs){this.futuresWs.removeAllListeners();this.futuresWs.close();this.futuresWs=null;this.logger.info("[MEXCConnector] Futures WebSocket closed (if it was used).");}this.subscriptions.clear();
    }
}

module.exports = MEXCConnector;