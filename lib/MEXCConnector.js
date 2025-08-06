// /lib/MEXCConnector.js (VERSÃO HÍBRIDA: WebSocket para Futuros, REST para Spot)

const axios = require("axios");
const WebSocket = require("ws");

class MEXCConnector {
    constructor(config, logger) {
        this.config = config;
        this.logger = logger;
        // URLs para API REST
        this.spotRestUrl = this.config.spot_api_url || "https://api.mexc.com/api/v3";
        this.futuresRestUrl = this.config.futures_api_url || "https://contract.mexc.com/api/v1/contract";
        
        // URL e instância para WebSocket de Futuros
        this.futuresWsUrl = "wss://contract.mexc.com/edge";
        this.futuresWs = null;
        
        this.onDataUpdate = null; // Callback para o WebSocket
        this.axiosInstance = axios.create({ headers: { "User-Agent": "ArbitrageBot/2.0 MEXCConnector" } });
        this.maxRetries = 3;
        this.retryDelayBase = 1000;

        this.logger.info(`[MEXCConnector] Initialized in HYBRID mode (Futures: WebSocket, Spot: REST).`);
    }

    // Método para o MarketMonitor nos entregar a função de callback
    setTickerUpdateCallback(callback) {
        this.onDataUpdate = callback;
    }

    // --- LÓGICA DE WEBSOCKET (APENAS PARA FUTUROS) ---
    connectFuturesWebSocket(symbolsToSubscribe = []) {
        if (this.futuresWs && this.futuresWs.readyState === WebSocket.OPEN) return;
        this.logger.info(`[MEXCConnector] Conectando ao WebSocket de Futuros...`);
        this.futuresWs = new WebSocket(this.futuresWsUrl);

        this.futuresWs.on("open", () => {
            this.logger.info("[MEXCConnector] WebSocket de Futuros conectado.");
            this.subscribeToFuturesTickers(symbolsToSubscribe);
            setInterval(() => {
                if (this.futuresWs && this.futuresWs.readyState === WebSocket.OPEN) {
                    this.futuresWs.send(JSON.stringify({ method: "ping" }));
                }
            }, 20000);
        });

        this.futuresWs.on("message", (data) => {
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
                            ts: message.ts
                        };
                        // Avisa o MarketMonitor que chegaram novos dados de FUTUROS
                        this.onDataUpdate("mexc", "futures", formatted);
                    }
                }
            } catch (error) { this.logger.error(`[MEXCConnector] Erro ao processar mensagem do Futuros WS: ${error.message}`); }
        });

        this.futuresWs.on("close", () => {
            this.logger.warn(`[MEXCConnector] WebSocket de Futuros fechado. Tentando reconectar em 5s...`);
            setTimeout(() => this.connectFuturesWebSocket(symbolsToSubscribe), 5000);
        });
        this.futuresWs.on("error", (error) => this.logger.error(`[MEXCConnector] Erro no WebSocket de Futuros: ${error.message}`));
    }
    
    subscribeToFuturesTickers(symbols = []) {
        if (!this.futuresWs || this.futuresWs.readyState !== WebSocket.OPEN) return;
        (symbols || []).forEach(symbol => {
            this.futuresWs.send(JSON.stringify({ "method": "sub.ticker", "param": { "symbol": symbol } }));
        });
        this.logger.info(`[MEXCConnector] Subscrito em ${symbols.length} tickers de Futuros via WebSocket.`);
    }

    // --- LÓGICA DE API REST (APENAS PARA SPOT) ---
    async _makeRequestWithRetry(url) {
        for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
            try {
                const response = await this.axiosInstance.get(url, { timeout: 5000 });
                if (response.status === 200) return response.data;
                throw new Error(`Request failed with status code ${response.status}`);
            } catch (error) {
                this.logger.warn(`[MEXCConnector] REST Attempt ${attempt} failed for ${url}: ${error.message}`);
                if (attempt === this.maxRetries) throw error;
                await new Promise(resolve => setTimeout(resolve, this.retryDelayBase * attempt));
            }
        }
    }

    async getAllSpotBookTickers() {
        this.logger.debug("[MEXCConnector] Buscando tickers de Spot via REST...");
        const url = `${this.spotRestUrl}/ticker/bookTicker`;
        const response = await this._makeRequestWithRetry(url);
        
        const tickersMap = new Map();
        if (Array.isArray(response)) {
            response.forEach(item => {
                tickersMap.set(item.symbol.toUpperCase(), {
                    bidPrice: parseFloat(item.bidPrice),
                    askPrice: parseFloat(item.askPrice),
                    ts: Date.now()
                });
            });
        }
        return tickersMap;
    }

    // Função de apoio ainda necessária para o server.js
    async getFuturesContractDetail() {
        const url = `${this.futuresRestUrl}/detail`;
        try {
            const response = await this._makeRequestWithRetry(url);
            if (!response || !Array.isArray(response.data)) return { success: false, data: [] };
            return { success: true, data: response.data };
        } catch (error) {
            this.logger.error(`[MEXCConnector] Erro ao obter detalhes de contratos de Futuros: ${error.message}`);
            return { success: false, data: [] };
        }
    }

    closeAll() {
        this.logger.info("[MEXCConnector] Fechando conexões...");
        if (this.futuresWs) {
            this.futuresWs.close();
        }
    }
}

module.exports = MEXCConnector;