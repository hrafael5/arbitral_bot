// /home/ubuntu/mexc_bot/lib/GateConnector.js
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
                "User-Agent": "SeuBotDeArbitragem/1.6 GateConnector", // Versão incrementada
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
        const requestUrl = `${this.futuresRestUrl}/${settle}/contracts`; // Armazena a URL exata da requisição
        this.logger.info(`[GateConnector] Fetching Gate.io futures contract details from ${requestUrl}...`);
        try {
            const responseArray = await this._makeRequestWithRetry(requestUrl);

            if (!Array.isArray(responseArray)) {
                this.logger.error(`[GateConnector] Gate.io futures contracts response is not an array. Received: ${JSON.stringify(responseArray)}`);
                return { success: false, message: "Invalid response format from Gate.io futures contracts API", data: null };
            }
            this.logger.info(`[GateConnector] Fetched ${responseArray.length} raw contract items from Gate.io.`);

            if (responseArray.length > 0) {
                this.logger.debug(`[GateConnector_DEBUG_STRUCTURE] First raw contract item from Gate.io: ${JSON.stringify(responseArray[0])}`);
            }

            let mappedCount = 0;

            const mappedContracts = responseArray
                .map(contract => {
                    const name = contract.name;
                    const type = contract.type;
                    let quoteAssetRaw = contract.quote_asset; // Campo original da API
                    let settleAssetRaw = contract.settle_asset; // Campo original da API
                    const inDelisting = contract.in_delisting;

                    let effectiveQuoteAsset = quoteAssetRaw;
                    let effectiveSettleAsset = settleAssetRaw;

                    // MODIFICAÇÃO INICIA AQUI
                    // Se a URL da requisição contém "/usdt/", é para contratos USDT.
                    // Se quote_asset ou settle_asset não vierem ou vierem como "undefined" (string), assumimos USDT.
                    if (requestUrl.includes(`/${settle}/contracts`)) { // Verifica se a URL é a de contratos com o 'settle' asset (usdt)
                        if (quoteAssetRaw === undefined || String(quoteAssetRaw).toUpperCase() === 'UNDEFINED') {
                            effectiveQuoteAsset = "USDT";
                            this.logger.debug(`[Gate_Asset_Override] Contract '${name}': Original quote_asset was '${quoteAssetRaw}'. Overriding to 'USDT' based on endpoint.`);
                        }
                        if (settleAssetRaw === undefined || String(settleAssetRaw).toUpperCase() === 'UNDEFINED') {
                            effectiveSettleAsset = "USDT";
                             this.logger.debug(`[Gate_Asset_Override] Contract '${name}': Original settle_asset was '${settleAssetRaw}'. Overriding to 'USDT' based on endpoint.`);
                        }
                    }
                    // MODIFICAÇÃO TERMINA AQUI

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
                            quoteCoin: quoteCoinForBot, // Usará "USDT" devido ao override
                            settleCoin: settleCoinForBot, // Usará "USDT" devido ao override
                            _gate_name: name, _gate_type: type, _gate_quote_asset: quoteAssetRaw, // Mantém o valor original para log/info
                            _gate_settle_asset: settleAssetRaw, // Mantém o valor original para log/info
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

    async getAllSpotBookTickers() {
        const url = `${this.spotRestUrl}/tickers`;
        this.logger.debug(`[GateConnector] Fetching all Gate.io spot book tickers from ${url}`);
        try {
            const response = await this._makeRequestWithRetry(url);
            const tickerMap = new Map();
            if (Array.isArray(response)) {
                response.forEach(ticker => {
                    const pairSymbolApi = ticker.currency_pair;
                    const askPrice = parseFloat(ticker.lowest_ask);
                    const bidPrice = parseFloat(ticker.highest_bid);
                    // Adicionando log para estrutura do ticker spot
                    if (tickerMap.size < 2 && pairSymbolApi) { // Loga apenas os primeiros para não poluir
                        this.logger.debug(`[GateConnector_SpotTicker_Structure] Pair: ${pairSymbolApi}, LowestAsk: ${ticker.lowest_ask}, HighestBid: ${ticker.highest_bid}, BaseVol: ${ticker.base_volume}`);
                    }
                    if (pairSymbolApi && askPrice > 0 && bidPrice > 0) {
                        tickerMap.set(pairSymbolApi.toUpperCase(), {
                            bidPrice: bidPrice, askPrice: askPrice,
                            bidQty: parseFloat(ticker.base_volume) || null, // Gate.io ticker não tem bid/ask qty individual, base_volume é o volume da moeda base
                            askQty: parseFloat(ticker.quote_volume) || null, // quote_volume é o volume da moeda de cotação
                            ts: Date.now()
                        });
                    }
                });
            }
            this.logger.info(`[GateConnector_DEBUG] getAllSpotBookTickers (Gate.io) fetched ${tickerMap.size} valid items.`);
            return tickerMap;
        } catch (error) {
            this.logger.error(`[GateConnector] Failed to fetch all Gate.io spot book tickers: ${error.message}`);
            return null;
        }
    }

    async getAllSpot24hrStats() {
        const url = `${this.spotRestUrl}/tickers`;
        this.logger.debug(`[GateConnector] Fetching all Gate.io spot 24hr stats from ${url}`);
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
            this.logger.info(`[GateConnector_DEBUG] getAllSpot24hrStats (Gate.io) fetched ${statsMap.size} valid items.`);
            return statsMap;
        } catch (error) {
            this.logger.error(`[GateConnector] Failed to fetch all Gate.io spot 24hr stats: ${error.message}`);
            return null;
        }
    }

    async getAllFuturesBookTickers() {
        const settle = "usdt";
        const url = `${this.futuresRestUrl}/${settle}/tickers`;
        this.logger.debug(`[GateConnector] Fetching all Gate.io futures book tickers from ${url}`);
        try {
            const response = await this._makeRequestWithRetry(url);
            const tickerMap = new Map();
            if (Array.isArray(response)) {
                response.forEach(ticker => {
                    const pairSymbolApi = ticker.contract;
                    const askPrice = parseFloat(ticker.lowest_ask);
                    const bidPrice = parseFloat(ticker.highest_bid);
                    const volume24hQuote = parseFloat(ticker.volume_24h_quote || ticker.volume_24h_usdt);
                    const fundingRate = parseFloat(ticker.funding_rate_indicative || ticker.funding_rate);

                    // Adicionando log para estrutura do ticker futuro
                     if (tickerMap.size < 2 && pairSymbolApi) { // Loga apenas os primeiros
                        this.logger.debug(`[GateConnector_FuturesTicker_Structure] Contract: ${pairSymbolApi}, LowestAsk: ${ticker.lowest_ask}, HighestBid: ${ticker.highest_bid}, VolQuote: ${ticker.volume_24h_quote || ticker.volume_24h_usdt}, FR: ${ticker.funding_rate_indicative || ticker.funding_rate}`);
                    }

                    if (pairSymbolApi && askPrice > 0 && bidPrice > 0) {
                         tickerMap.set(pairSymbolApi.toUpperCase(), {
                            bidPrice: bidPrice, askPrice: askPrice,
                            bidQty: null, askQty: null, // Gate.io /tickers não fornece bid/ask qty diretamente no contrato principal
                            volume24hQuote: isNaN(volume24hQuote) ? null : volume24hQuote,
                            fundingRate: isNaN(fundingRate) ? null : fundingRate,
                            ts: parseInt(ticker.last_timestamp_ms) || Date.now()
                        });
                    }
                });
            }
            this.logger.info(`[GateConnector_DEBUG] getAllFuturesBookTickers (Gate.io) fetched ${tickerMap.size} valid items.`);
            return tickerMap;
        } catch (error) {
            this.logger.error(`[GateConnector] Failed to fetch all Gate.io futures book tickers: ${error.message}`);
            return null;
        }
    }

    connectFuturesWebSocket(onOpenCallback) {
        this.logger.warn("[GateConnector] connectFuturesWebSocket not actively used for Gate.io in this REST-polling setup.");
        if (onOpenCallback) onOpenCallback();
    }
    closeAll() {
        this.logger.info("[GateConnector] Closing Gate.io connections (no-op for REST based).");
    }
}
module.exports = GateConnector;