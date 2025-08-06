// /lib/MEXCConnector.js (VERSÃO WEBSOCKET - REVISADO E MELHORADO)

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
            this.logger.debug(`[MEXCConnector][Spot WS] Mensagem bruta recebida: ${data.toString()}`);
            try {
                const message = JSON.parse(data.toString());
                
                // Mensagem com dados de preço do ticker
                if (message.c && message.c.startsWith('spot@public.bookTicker.v3.api@')) {
                    this.logger.info(`[MEXCConnector][Spot] Ticker DATA recebido para o símbolo: ${message.s}`);
                    if (this.onDataUpdate && message.d) {
                        const ticker = message.d;
                        const formatted = {
                            symbol: message.s, // Usar o 's' da raiz da mensagem
                            bidPrice: parseFloat(ticker.b), 
                            askPrice: parseFloat(ticker.a),
                            ts: message.t
                        };
                        this.onDataUpdate('mexc', 'spot', formatted);
                    }
                } 
                // Mensagem de PING do servidor
                else if (message.method === 'PING') {
                    // Resposta correta ao PING, incluindo o timestamp recebido
                    this.spotWs.send(JSON.stringify({ method: 'PONG', ts: message.ts }));
                    this.logger.debug(`[MEXCConnector][Spot WS] Enviado PONG.`);
                }
                // Mensagem de confirmação de subscrição
                else if (message.id && message.code === 0) {
                    this.logger.info(`[MEXCConnector][Spot WS] Confirmação de subscrição recebida com sucesso (ID: ${message.id}).`);
                }
                else {
                    this.logger.debug(`[MEXCConnector][Spot WS] Mensagem não reconhecida: ${JSON.stringify(message)}`);
                }
            } catch (error) { this.logger.error(`[MEXCConnector] Erro ao processar mensagem do Spot WS: ${error.message}.`); }
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
            // Cliente envia PING para manter a conexão de Futuros ativa
            setInterval(() => {
              if (this.futuresWs && this.futuresWs.readyState === WebSocket.OPEN) {
                this.futuresWs.send(JSON.stringify({ method: "ping" }));
              }
            }, 20000);
        });

        this.futuresWs.on("message", (data) => {
            this.logger.debug(`[MEXCConnector][Futuros WS] Mensagem bruta recebida: ${data.toString()}`);
            try {
                const message = JSON.parse(data.toString());
                
                // Mensagem com os dados de preço que queremos receber
                if (message.channel === "push.ticker") {
                     this.logger.info(`[MEXCConnector][Futuros] Ticker DATA recebido para o símbolo: ${message.symbol}`);
                     if (this.onDataUpdate && message.data) {
                        const ticker = message.data;
                        const formatted = {
                            symbol: ticker.symbol,
                            bidPrice: parseFloat(ticker.bid1), 
                            askPrice: parseFloat(ticker.ask1),
                            volume24hQuote: parseFloat(ticker.amount24), 
                            fundingRate: parseFloat(ticker.fundingRate),
                            ts: message.ts // <-- CORREÇÃO DEFINITIVA APLICADA
                        };
                        this.onDataUpdate("mexc", "futures", formatted);
                    }
                } 
                // Mensagem de confirmação de subscrição
                else if (message.channel === "rs.sub.ticker" && message.data === "success") {
                    this.logger.info(`[MEXCConnector][Futuros WS] Confirmação de subscrição para Futuros recebida.`);
                }
                // Mensagem de PONG do servidor
                else if (message.method === "pong") {
                    this.logger.debug(`[MEXCConnector][Futuros WS] Recebido PONG do servidor.`);
                }
                else {
                    this.logger.debug(`[MEXCConnector][Futuros WS] Mensagem não reconhecida: ${JSON.stringify(message)}`);
                }
            } catch (error) { this.logger.error(`[MEXCConnector] Erro ao processar mensagem do Futuros WS: ${error.message}.`); }
        });

        this.futuresWs.on("close", (code, reason) => {
            this.logger.warn(`[MEXCConnector] WebSocket de Futuros fechado. Código: ${code}, Razão: ${reason.toString()}. Tentando reconectar em 5s...`);
            setTimeout(() => this.connectFuturesWebSocket(this.pendingSubscriptions.futures), 5000);
        });
        this.futuresWs.on("error", (error) => this.logger.error(`[MEXCConnector] Erro no WebSocket de Futuros: ${error.message}`));
    }

    subscribeToSpotTickers(symbols = []) {
        if (!symbols || symbols.length === 0) return;
        this.pendingSubscriptions.spot = [...new Set(symbols)]; // Garante unicidade
        if (!this.spotWs || this.spotWs.readyState !== WebSocket.OPEN) {
            this.logger.warn("[MEXCConnector] Spot WS não está aberto. Subscrições ficarão pendentes.");
            return;
        }
        const params = this.pendingSubscriptions.spot.map(s => `spot@public.bookTicker.v3.api@${s}`);
        const subscriptionMessage = {
            method: "SUBSCRIPTION",
            params: params,
            id: `spot_sub_${Date.now()}` // ID único para rastrear a resposta
        };
        this.spotWs.send(JSON.stringify(subscriptionMessage));
        this.logger.info(`[MEXCConnector] Enviada subscrição para ${this.pendingSubscriptions.spot.length} tickers de Spot.`);
    }

    subscribeToFuturesTickers(symbols = []) {
        if (!symbols || symbols.length === 0) return;
        this.pendingSubscriptions.futures = [...new Set(symbols)]; // Garante unicidade
        if (!this.futuresWs || this.futuresWs.readyState !== WebSocket.OPEN) {
            this.logger.warn("[MEXCConnector] Futuros WS não está aberto. Subscrições ficarão pendentes.");
            return;
        }
        this.pendingSubscriptions.futures.forEach(symbol => {
            const subscriptionMsg = { "method": "sub.ticker", "param": { "symbol": symbol } };
            this.futuresWs.send(JSON.stringify(subscriptionMsg));
        });
        this.logger.info(`[MEXCConnector] Enviadas subscrições para ${this.pendingSubscriptions.futures.length} tickers de Futuros.`);
    }
    
    async _makeRequestWithRetry(url, params = {}, timeout = 30000, retries = this.maxRetries) {
        // ... (código original mantido sem alterações)
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
        // ... (código original mantido sem alterações)
        const url = `${this.futuresRestUrl}/detail`;
        this.logger.debug(`[MEXCConnector] Chamando API REST de Futuros para detalhes do contrato: ${url}`);
        try {
            const response = await this._makeRequestWithRetry(url);
            if (!response || !Array.isArray(response.data)) {
                this.logger.error(`[MEXCConnector] Resposta inesperada da API de Futuros para detalhes do contrato: ${JSON.stringify(response)}`);
                return { success: false, data: [] };
            }
            const processedData = response.data.map(contract => ({
                symbol: contract.symbol,
                quoteCoin: contract.quoteCoin,
                settleCoin: contract.settleCoin
            }));
            return { success: true, data: processedData };
        } catch (error) {
            this.logger.error(`[MEXCConnector] Erro ao obter detalhes de contratos de Futuros: ${error.message}`);
            return { success: false, data: [] };
        }
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