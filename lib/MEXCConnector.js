// /lib/MEXCConnector.js (VERSÃO WEBSOCKET - REVISADO)

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
            // O WebSocket de Spot V3 usa um mecanismo de PING/PONG iniciado pelo servidor.
            // Apenas precisamos de responder aos PINGs.
        });

        this.spotWs.on('message', (data) => {
            this.logger.debug(`[MEXCConnector][Spot WS] Mensagem bruta recebida: ${data.toString().substring(0, 500)}...`);
            try {
                const message = JSON.parse(data.toString());
                this.logger.debug(`[MEXCConnector][Spot WS] Mensagem parseada: ${JSON.stringify(message).substring(0, 500)}...`);

                if (message.c && message.c.startsWith('spot@public.bookTicker.v3.api@')) {
                    if (this.onDataUpdate && message.d) {
                        const ticker = message.d;
                        // O parsing de dados de Spot já estava correto.
                        const formatted = {
                            symbol: message.s, // O símbolo também está na raiz da mensagem.
                            bidPrice: parseFloat(ticker.b),
                            askPrice: parseFloat(ticker.a),
                            ts: message.t
                        };
                        this.logger.debug(`[MEXCConnector][Spot WS] Ticker formatado: ${JSON.stringify(formatted)}`);
                        this.onDataUpdate('mexc', 'spot', formatted);
                    }
                } else if (message.method === 'PING') {
                    // Responde ao PING do servidor para manter a conexão ativa.
                    this.spotWs.send(JSON.stringify({ method: 'PONG', ts: message.ts }));
                    this.logger.debug(`[MEXCConnector][Spot WS] Enviado PONG.`);
                } else if (message.channel === "sub.status" && message.msg === "spot@public.bookTicker.v3.api") {
                    this.logger.info(`[MEXCConnector][Spot WS] Confirmação de subscrição recebida.`);
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
            // O WebSocket de Futuros requer que o cliente envie PINGs periodicamente.
            setInterval(() => {
              if (this.futuresWs.readyState === WebSocket.OPEN) {
                this.futuresWs.send(JSON.stringify({ method: "ping" }));
                this.logger.debug(`[MEXCConnector][Futuros WS] Enviado ping.`);
              }
            }, 20000); // A cada 20 segundos é um intervalo seguro.
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
                            bidPrice: parseFloat(ticker.bid1), 
                            askPrice: parseFloat(ticker.ask1),
                            volume24hQuote: parseFloat(ticker.amount24), 
                            fundingRate: parseFloat(ticker.fundingRate),
                            // === CORREÇÃO APLICADA AQUI ===
                            // Lemos o timestamp da raiz da mensagem (message.ts), não de ticker (message.data)
                            ts: message.ts 
                        };
                        this.logger.debug(`[MEXCConnector][Futuros WS] Ticker formatado: ${JSON.stringify(formatted)}`);
                        this.onDataUpdate("mexc", "futures", formatted);
                    }
                } else if (message.channel === "rs.sub.ticker") {
                    this.logger.info(`[MEXCConnector][Futuros WS] Confirmação de subscrição para ticker de Futuros recebida.`);
                } else if (message.method === "pong") {
                    this.logger.debug(`[MEXCConnector][Futuros WS] Recebido pong do servidor.`);
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
        this.pendingSubscriptions.spot = [...new Set(symbols)]; // Garante que não há símbolos duplicados
        if (!this.spotWs || this.spotWs.readyState !== WebSocket.OPEN) {
            this.logger.warn("[MEXCConnector] Spot WS não está aberto. Subscrições pendentes.");
            return;
        }
        if (symbols.length === 0) return;
        
        const params = this.pendingSubscriptions.spot.map(s => `spot@public.bookTicker.v3.api@${s}`);
        this.spotWs.send(JSON.stringify({ "method": "SUBSCRIPTION", "params": params }));
        this.logger.info(`[MEXCConnector] Enviada subscrição para ${symbols.length} tickers de Spot.`);
    }

    subscribeToFuturesTickers(symbols = []) {
        this.pendingSubscriptions.futures = [...new Set(symbols)]; // Garante que não há símbolos duplicados
        if (!this.futuresWs || this.futuresWs.readyState !== WebSocket.OPEN) {
            this.logger.warn("[MEXCConnector] Futuros WS não está aberto. Subscrições pendentes.");
            return;
        }
        if (symbols.length === 0) return;
        
        this.pendingSubscriptions.futures.forEach(symbol => {
            const subscriptionMsg = { "method": "sub.ticker", "param": { "symbol": symbol } };
            this.futuresWs.send(JSON.stringify(subscriptionMsg));
            this.logger.debug(`[MEXCConnector] Enviada subscrição para ticker de Futuros: ${symbol}`);
        });
        this.logger.info(`[MEXCConnector] Enviadas subscrições para ${symbols.length} tickers de Futuros.`);
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

    async getFuturesContractDetail() {
        const url = `${this.futuresRestUrl}/detail`;
        this.logger.debug(`[MEXCConnector] Chamando API REST de Futuros para detalhes do contrato: ${url}`);
        try {
            const response = await this._makeRequestWithRetry(url);
            this.logger.debug(`[MEXCConnector] Resposta bruta da API de Futuros para detalhes do contrato: ${JSON.stringify(response).substring(0, 500)}...`);
            
            if (!response || !Array.isArray(response.data)) {
                this.logger.error(`[MEXCConnector] Resposta inesperada da API de Futuros para detalhes do contrato: ${JSON.stringify(response)}`);
                return { success: false, data: [] };
            }

            const processedData = response.data.map(contract => ({
                symbol: contract.symbol,
                quoteCoin: contract.quoteCoin,
                settleCoin: contract.settleCoin
            }));
            this.logger.debug(`[MEXCConnector] Dados de contratos de Futuros processados: ${JSON.stringify(processedData).substring(0, 500)}...`);
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