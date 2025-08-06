// /lib/MEXCConnector.js (VERSÃO WEBSOCKET)

const axios = require("axios");
const WebSocket = require("ws");

class MEXCConnector {
    constructor(config, logger) {
        this.config = config;
        this.logger = logger;
        this.spotRestUrl = this.config.spot_api_url || "https://api.mexc.com/api/v3";
        this.futuresRestUrl = this.config.futures_api_url || "https://contract.mexc.com/api/v1/contract";
        
        this.spotWs = null;
        this.futuresWs = null;
        this.spotWsUrl = "wss://wbs.mexc.com/ws";
        this.futuresWsUrl = "wss://contract.mexc.com/edge";
        
        this.onDataUpdate = null;
        this.pendingSubscriptions = { spot: [], futures: [] };

        this.maxRetries = 3;
        this.retryDelayBase = 1000;
        this.axiosInstance = axios.create({ headers: { "User-Agent": "ArbitrageBot/2.0 MEXCConnector" } });
        this.logger.info(`[MEXCConnector] Initialized for WebSocket mode.`);
    }

    setTickerUpdateCallback(callback) {
        this.onDataUpdate = callback;
    }

    connectSpotWebSocket(symbolsToSubscribe = []) {
        if (this.spotWs && this.spotWs.readyState === WebSocket.OPEN) return;
        this.logger.info(`[MEXCConnector] Conectando ao WebSocket de Spot...`);
        this.spotWs = new WebSocket(this.spotWsUrl);

        this.spotWs.on('open', () => {
            this.logger.info("[MEXCConnector] WebSocket de Spot conectado.");
            this.subscribeToSpotTickers(symbolsToSubscribe);
        });

        this.spotWs.on('message', (data) => {
            this.logger.debug(`[MEXCConnector][Spot WS] Mensagem bruta recebida: ${data.toString().substring(0, 500)}...`);
            try {
                const message = JSON.parse(data.toString());
                this.logger.debug(`[MEXCConnector][Spot WS] Mensagem parseada: ${JSON.stringify(message).substring(0, 500)}...`);
                if (message.c && message.c.startsWith('spot@public.bookTicker.v3.api@')) {
                    if (this.onDataUpdate && message.d) {
                        const ticker = message.d;
                        const formatted = {
                            symbol: ticker.s,
                            bidPrice: parseFloat(ticker.b), askPrice: parseFloat(ticker.a),
                            ts: message.t
                        };
                        this.logger.debug(`[MEXCConnector][Spot WS] Ticker formatado: ${JSON.stringify(formatted)}`);
                        this.onDataUpdate('mexc', 'spot', formatted);
                    }
                } else if (message.method === 'PING') {
                    this.spotWs.send(JSON.stringify({ method: 'PONG' }));
                    this.logger.debug(`[MEXCConnector][Spot WS] Enviado PONG.`);
                } else {
                    this.logger.debug(`[MEXCConnector][Spot WS] Mensagem não reconhecida: ${JSON.stringify(message)}`);
                }
            } catch (error) { this.logger.error(`[MEXCConnector] Erro ao processar mensagem do Spot WS: ${error.message}. Mensagem original: ${data.toString()}`); }
        });

        this.spotWs.on('close', (code, reason) => {
            this.logger.warn(`[MEXCConnector] WebSocket de Spot fechado. Código: ${code}, Razão: ${reason.toString()}. Tentando reconectar em 5s...`);
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
            setInterval(() => {
              if (this.futuresWs.readyState === WebSocket.OPEN) {
                this.futuresWs.send(JSON.stringify({ method: "ping" }))
              }
            }, 10000);
        });

        this.futuresWs.on("message", (data) => {
            this.logger.debug(`[MEXCConnector][Futuros WS] Mensagem bruta recebida: ${data.toString().substring(0, 500)}...`);
            try {
                const message = JSON.parse(data.toString());
                this.logger.debug(`[MEXCConnector][Futuros WS] Mensagem parseada: ${JSON.stringify(message).substring(0, 500)}...`);
                if (message.channel === "push.ticker") {
                     if (this.onDataUpdate && message.data) {
                        const ticker = message.data;
                        const formatted = {
                            symbol: ticker.symbol,
                            bidPrice: parseFloat(ticker.bid1), askPrice: parseFloat(ticker.ask1),
                            volume24hQuote: parseFloat(ticker.amount24), fundingRate: parseFloat(ticker.fundingRate),
                            ts: parseInt(ticker.timestamp)
                        };
                        this.logger.debug(`[MEXCConnector][Futuros WS] Ticker formatado: ${JSON.stringify(formatted)}`);
                        this.onDataUpdate("mexc", "futures", formatted);
                    }
                } else if (message.method === "ping") {
                    this.logger.debug(`[MEXCConnector][Futuros WS] Recebido ping.`);
                } else {
                    this.logger.debug(`[MEXCConnector][Futuros WS] Mensagem não reconhecida: ${JSON.stringify(message)}`);
                }
            } catch (error) { this.logger.error(`[MEXCConnector] Erro ao processar mensagem do Futuros WS: ${error.message}. Mensagem original: ${data.toString()}`); }
        });

        this.futuresWs.on("close", (code, reason) => {
            this.logger.warn(`[MEXCConnector] WebSocket de Futuros fechado. Código: ${code}, Razão: ${reason.toString()}. Tentando reconectar em 5s...`);
            setTimeout(() => this.connectFuturesWebSocket(this.pendingSubscriptions.futures), 5000);
        });
        this.futuresWs.on("error", (error) => this.logger.error(`[MEXCConnector] Erro no WebSocket de Futuros: ${error.message}`));
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

    async getAllSpotBookTickers() {
        // ... (código original mantido para fallback)
    }

    async getAllSpot24hrStats() {
        // ... (código original mantido para fallback)
    }

    async getFuturesContractDetail() {
        // ... (código original mantido para fallback)
    }

    async getAllFuturesBookTickers() {
        // ... (código original mantido para fallback)
    }

    closeAll() {
        this.logger.info("[MEXCConnector] Fechando conexões WebSocket da MEXC...");
        if(this.spotWs) {
            this.spotWs.removeAllListeners();
            this.spotWs.close();
        }
        if(this.futuresWs) {
            this.futuresWs.removeAllListeners();
            this.futuresWs.close();
        }
    }
}

module.exports = MEXCConnector;