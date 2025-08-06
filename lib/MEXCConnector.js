const axios = require("axios");
const WebSocket = require("ws");

class MEXCConnector {
    constructor(config, logger) {
        this.config = config;
        this.logger = logger;
        this.spotRestUrl = this.config.spot_api_url || "https://api.mexc.com/api/v3";
        this.futuresRestUrl = this.config.futures_api_url || "https://contract.mexc.com/api/v1/contract";
        
        // Propriedades para WebSockets de dados em tempo real
        this.spotWs = null;
        this.futuresWs = null;
        this.spotWsUrl = "wss://wbs.mexc.com/ws";
        this.futuresWsUrl = "wss://contract.mexc.com/edge";
        
        this.onDataUpdate = null; // Callback para notificar o MarketMonitor
        this.pendingSubscriptions = { spot: [], futures: [] }; // Para guardar subscrições se o WS não estiver pronto

        this.maxRetries = 3;
        this.retryDelayBase = 1000;
        this.axiosInstance = axios.create({
            headers: { "User-Agent": "ArbitrageBot/2.0 MEXCConnector" }
        });
        this.logger.info(`[MEXCConnector] Initialized for WebSocket mode.`);
    }

    // Método para o MarketMonitor se registrar para receber atualizações
    setTickerUpdateCallback(callback) {
        this.onDataUpdate = callback;
    }

    // --- SEÇÃO DE WEBSOCKETS ---

    connectSpotWebSocket(symbolsToSubscribe = []) {
        if (this.spotWs && this.spotWs.readyState === WebSocket.OPEN) return;
        this.logger.info(`[MEXCConnector] Conectando ao WebSocket de Spot...`);
        this.spotWs = new WebSocket(this.spotWsUrl);

        this.spotWs.on('open', () => {
            this.logger.info("[MEXCConnector] WebSocket de Spot conectado.");
            this.subscribeToSpotTickers(symbolsToSubscribe);
        });

        this.spotWs.on('message', (data) => {
            // Log de depuração para dados brutos
            console.log(`[DEBUG SPOT MEXC - DADO BRUTO]: ${data.toString()}`);
            try {
                const message = JSON.parse(data.toString());
                if (message.c && message.c.startsWith('spot@public.bookTicker.v3.api@')) {
                    if (this.onDataUpdate && message.d) {
                        const ticker = message.d;
                        const formatted = {
                            symbol: ticker.s,
                            bidPrice: parseFloat(ticker.b),
                            askPrice: parseFloat(ticker.a),
                            ts: message.t
                        };
                        this.onDataUpdate('mexc', 'spot', formatted);
                    }
                } else if (message.method === 'PING') {
                    this.spotWs.send(JSON.stringify({ method: 'PONG' }));
                }
            } catch (error) { this.logger.error(`[MEXCConnector] Erro ao processar mensagem do Spot WS: ${error.message}`); }
        });

        this.spotWs.on('close', () => {
            this.logger.warn("[MEXCConnector] WebSocket de Spot fechado. Tentando reconectar em 5s...");
            setTimeout(() => this.connectSpotWebSocket(this.pendingSubscriptions.spot), 5000);
        });
        this.spotWs.on('error', (error) => this.logger.error(`[MEXCConnector] Erro no WebSocket de Spot: ${error.message}`));
    }
    
    connectFuturesWebSocket(symbolsToSubscribe = []) {
        if (this.futuresWs && this.futuresWs.readyState === WebSocket.OPEN) return;
        this.logger.info(`[MEXCConnector] Conectando ao WebSocket de Futuros...`);
        this.futuresWs = new WebSocket(this.futuresWsUrl);

        this.futuresWs.on("open", () => {
            this.logger.info("[MEXCConnector] WebSocket de Futuros conectado.");
            this.subscribeToFuturesTickers(symbolsToSubscribe);
            // Ping para manter a conexão viva
            setInterval(() => {
              if (this.futuresWs && this.futuresWs.readyState === WebSocket.OPEN) {
                this.futuresWs.send(JSON.stringify({ method: "ping" }));
              }
            }, 10000);
        });

        this.futuresWs.on("message", (data) => {
            // Log de depuração para dados brutos
            console.log(`[DEBUG FUTUROS MEXC - DADO BRUTO]: ${data.toString()}`);
            try {
                const message = JSON.parse(data.toString());
                if (message.channel === "push.ticker") {
                     if (this.onDataUpdate && message.data) {
                        const ticker = message.data;
                        const formatted = {
                            symbol: ticker.symbol,
                            bidPrice: parseFloat(ticker.bid1),
                            askPrice: parseFloat(ticker.ask1),
                            volume24hQuote: parseFloat(ticker.amount24),
                            fundingRate: parseFloat(ticker.fundingRate),
                            ts: parseInt(ticker.timestamp)
                        };
                        this.onDataUpdate('mexc', 'futures', formatted);
                    }
                }
            } catch (error) { this.logger.error(`[MEXCConnector] Erro ao processar mensagem do Futuros WS: ${error.message}`); }
        });

        this.futuresWs.on("close", () => {
            this.logger.warn("[MEXCConnector] WebSocket de Futuros fechado. Tentando reconectar em 5s...");
            setTimeout(() => this.connectFuturesWebSocket(this.pendingSubscriptions.futures), 5000);
        });
        this.futuresWs.on("error", (error) => this.logger.error("[MEXCConnector] Erro no WebSocket de Futuros:", error.message));
    }

    subscribeToSpotTickers(symbols = []) {
        this.pendingSubscriptions.spot = symbols;
        if (!this.spotWs || this.spotWs.readyState !== WebSocket.OPEN) {
            this.logger.warn("[MEXCConnector] Spot WS não está aberto. Subscrições pendentes.");
            return;
        }
        const params = symbols.map(s => `spot@public.bookTicker.v3.api@${s}`);
        this.spotWs.send(JSON.stringify({ "method": "SUBSCRIPTION", "params": params }));
        this.logger.info(`[MEXCConnector] Subscrito em ${symbols.length} tickers de Spot.`);
    }

    subscribeToFuturesTickers(symbols = []) {
        this.pendingSubscriptions.futures = symbols;
        if (!this.futuresWs || this.futuresWs.readyState !== WebSocket.OPEN) {
            this.logger.warn("[MEXCConnector] Futuros WS não está aberto. Subscrições pendentes.");
            return;
        }
        symbols.forEach(symbol => {
            this.futuresWs.send(JSON.stringify({ "method": "sub.ticker", "param": { "symbol": symbol } }));
        });
        this.logger.info(`[MEXCConnector] Subscrito em ${symbols.length} tickers de Futuros.`);
    }

    // --- MÉTODOS REST (MANTIDOS PARA FALLBACK E DADOS INICIAIS) ---

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

    // --- MÉTODOS DE POLLING (AGORA USADOS APENAS COMO FALLBACK OU PARA DADOS NÃO-TICKER) ---

    async getAllSpotBookTickers() {
        this.logger.warn("[MEXCConnector] Usando método REST (getAllSpotBookTickers) como fallback.");
        const url = `${this.spotRestUrl}/ticker/bookTicker`;
        try {
            const response = await this._makeRequestWithRetry(url, {}, 20000);
            const tickerMap = new Map();
            if (Array.isArray(response)) {
                response.forEach(ticker => {
                    const bidPrice = parseFloat(ticker.bidPrice);
                    const askPrice = parseFloat(ticker.askPrice);
                    if (ticker.symbol && askPrice > 0 && bidPrice > 0) {
                        tickerMap.set(ticker.symbol.toUpperCase(), { 
                            bidPrice: isNaN(bidPrice) ? null : bidPrice,
                            askPrice: isNaN(askPrice) ? null : askPrice,
                            ts: Date.now() 
                        });
                    }
                });
            }
            return tickerMap;
        } catch (error) {
            this.logger.error(`[MEXCConnector] Falha ao buscar tickers de spot via REST: ${error.message}`);
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
            return statsMap;
        } catch (error) {
            this.logger.error(`[MEXCConnector] Falha ao buscar estatísticas 24h de spot via REST: ${error.message}`);
            return null;
        }
    }

    async getAllFuturesBookTickers() {
        this.logger.warn("[MEXCConnector] Usando método REST (getAllFuturesBookTickers) como fallback.");
        const url = `${this.futuresRestUrl}/ticker`;
        try {
            const response = await this._makeRequestWithRetry(url, {}, 20000);
            const tickerMap = new Map();
            if (response && response.success && Array.isArray(response.data)) {
                response.data.forEach(ticker => {
                    if (ticker.symbol && parseFloat(ticker.ask1) > 0 && parseFloat(ticker.bid1) > 0) {
                        tickerMap.set(ticker.symbol.toUpperCase(), { 
                            bidPrice: parseFloat(ticker.bid1) || null,
                            askPrice: parseFloat(ticker.ask1) || null,
                            volume24hQuote: parseFloat(ticker.amount24) || null,
                            fundingRate: parseFloat(ticker.fundingRate) || null,
                            ts: parseInt(ticker.timestamp) || Date.now()
                        });
                    }
                });
            }
            return tickerMap;
        } catch (error) {
            this.logger.error(`[MEXCConnector] Falha ao buscar tickers de futuros via REST: ${error.message}`);
            return null;
        }
    }
    
    closeAll() {
        this.logger.info("[MEXCConnector] Fechando conexões WebSocket da MEXC...");
        if(this.spotWs) {
            this.spotWs.removeAllListeners();
            this.spotWs.close();
            this.spotWs = null;
        }
        if(this.futuresWs) {
            this.futuresWs.removeAllListeners();
            this.futuresWs.close();
            this.futuresWs = null;
        }
    }
}

module.exports = MEXCConnector;