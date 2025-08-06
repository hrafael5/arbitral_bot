const axios = require("axios");

class GateConnector {
    constructor(config, logger) {
        this.config = config;
        this.logger = logger;
        this.spotRestUrl = config.spot_api_url || "https://api.gateio.ws/api/v4/spot";
        this.futuresRestUrl = config.futures_api_url || "https://api.gateio.ws/api/v4/futures";
        this.maxRetries = 3;
        this.retryDelayBase = 1000;
        this.axiosInstance = axios.create({
            headers: {
                "User-Agent": "ArbitrageBot/1.6 GateConnector",
                "Accept": "application/json",
                "Content-Type": "application/json"
            }
        });
        this.logger.info(`[GateConnector] Initialized. Spot URL: ${this.spotRestUrl}, Futures URL: ${this.futuresRestUrl}`);
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
                this.logger.error(`[GateConnector] Gate.io futures contracts response is not an array.`);
                return { success: false, message: "Invalid response format from Gate.io futures contracts API", data: null };
            }

            const mappedContracts = responseArray.map(contract => {
                let effectiveQuoteAsset = contract.quote_asset || "USDT";
                let effectiveSettleAsset = contract.settle_asset || "USDT";

                if (String(effectiveQuoteAsset).toUpperCase() !== 'USDT' || String(effectiveSettleAsset).toUpperCase() !== 'USDT' || contract.type !== 'direct' || contract.in_delisting) {
                    return null;
                }
                
                return {
                    symbol: contract.name,
                    quoteCoin: "USDT",
                    settleCoin: "USDT"
                };
            }).filter(Boolean);

            this.logger.info(`[GateConnector] Mapped ${mappedContracts.length} contracts from Gate.io.`);
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
                response.forEach(ticker => {
                    const pairSymbolApi = ticker.currency_pair;
                    const askPrice = parseFloat(ticker.lowest_ask);
                    const bidPrice = parseFloat(ticker.highest_bid);
                    if (pairSymbolApi && askPrice > 0 && bidPrice > 0) {
                        tickerMap.set(pairSymbolApi.toUpperCase(), {
                            bidPrice: bidPrice, askPrice: askPrice, ts: Date.now()
                        });
                    }
                });
            }
            return tickerMap;
        } catch (error) {
            this.logger.error(`[GateConnector] Failed to fetch all Gate.io spot book tickers: ${error.message}`);
            return null;
        }
    }

    async getAllSpot24hrStats() {
        const url = `${this.spotRestUrl}/tickers`;
        try {
            const response = await this._makeRequestWithRetry(url);
            const statsMap = new Map();
            if (Array.isArray(response)) {
                response.forEach(stat => {
                    const pairSymbolApi = stat.currency_pair;
                    const quoteVol = parseFloat(stat.quote_volume);
                    if (pairSymbolApi) {
                        statsMap.set(pairSymbolApi.toUpperCase(), {
                            quoteVolume24h: isNaN(quoteVol) ? null : quoteVol,
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
                response.forEach(ticker => {
                    const pairSymbolApi = ticker.contract;
                    const askPrice = parseFloat(ticker.lowest_ask);
                    const bidPrice = parseFloat(ticker.highest_bid);
                    if (pairSymbolApi && askPrice > 0 && bidPrice > 0) {
                         tickerMap.set(pairSymbolApi.toUpperCase(), {
                            bidPrice: bidPrice, askPrice: askPrice,
                            volume24hQuote: parseFloat(ticker.volume_24h_quote || ticker.volume_24h_usdt) || null,
                            fundingRate: parseFloat(ticker.funding_rate_indicative || ticker.funding_rate) || null,
                            ts: parseInt(ticker.last_timestamp_ms) || Date.now()
                        });
                    }
                });
            }
            return tickerMap;
        } catch (error) {
            this.logger.error(`[GateConnector] Failed to fetch all Gate.io futures book tickers: ${error.message}`);
            return null;
        }
    }
    
    closeAll() {
        this.logger.info("[GateConnector] Closing Gate.io connections (no-op for REST based).");
    }
}
module.exports = GateConnector;