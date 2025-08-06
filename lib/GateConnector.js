// /lib/GateConnector.js (VERSÃO WEBSOCKET)

const WebSocket = require('ws');
const axios = require("axios");

class GateConnector {
    constructor(config, logger) {
        this.config = config;
        this.logger = logger;

        this.spotWsUrl = "wss://api.gateio.ws/ws/v4/";
        this.futuresWsUrl = "wss://fx-ws.gateio.ws/v4/ws/usdt";
        this.futuresRestUrl = config.futures_api_url || "https://api.gateio.ws/api/v4/futures";
        
        this.spotWs = null;
        this.futuresWs = null;
        this.onDataUpdate = null; // Callback para o MarketMonitor
        this.axiosInstance = axios.create({ headers: { "User-Agent": "ArbitrageBot/2.0 GateConnector" }});
    }

    setTickerUpdateCallback(callback) {
        this.onDataUpdate = callback;
    }

    // --- LÓGICA DE WEBSOCKET ---

    connectSpotWebSocket(symbols = []) {
        if (this.spotWs && this.spotWs.readyState === WebSocket.OPEN) return;
        this.logger.info(`[GateConnector] Conectando ao WebSocket de Spot da Gate.io...`);
        this.spotWs = new WebSocket(this.spotWsUrl);

        this.spotWs.on('open', () => {
            this.logger.info("[GateConnector] WebSocket de Spot conectado.");
            this.subscribeToTickers(this.spotWs, 'spot.tickers', symbols);
            // Gate.io requer PING do cliente
            setInterval(() => {
                if (this.spotWs.readyState === WebSocket.OPEN) {
                    this.spotWs.ping();
                }
            }, 20000);
        });

        this.spotWs.on('message', (data) => this.handleMessage('spot', data));
        this.spotWs.on('close', () => {
            this.logger.warn(`[GateConnector] WebSocket de Spot fechado. Tentando reconectar...`);
            setTimeout(() => this.connectSpotWebSocket(symbols), 5000);
        });
        this.spotWs.on('error', (err) => this.logger.error(`[GateConnector] Erro no WebSocket de Spot: ${err.message}`));
    }

    connectFuturesWebSocket(symbols = []) {
        if (this.futuresWs && this.futuresWs.readyState === WebSocket.OPEN) return;
        this.logger.info(`[GateConnector] Conectando ao WebSocket de Futuros da Gate.io...`);
        this.futuresWs = new WebSocket(this.futuresWsUrl);

        this.futuresWs.on('open', () => {
            this.logger.info("[GateConnector] WebSocket de Futuros conectado.");
            this.subscribeToTickers(this.futuresWs, 'futures.tickers', symbols);
            // Gate.io requer PING do cliente
            setInterval(() => {
                if (this.futuresWs.readyState === WebSocket.OPEN) {
                    this.futuresWs.send(JSON.stringify({ "time": Math.floor(Date.now() / 1000), "channel": "futures.ping" }));
                }
            }, 20000);
        });

        this.futuresWs.on('message', (data) => this.handleMessage('futures', data));
        this.futuresWs.on('close', () => {
            this.logger.warn(`[GateConnector] WebSocket de Futuros fechado. Tentando reconectar...`);
            setTimeout(() => this.connectFuturesWebSocket(symbols), 5000);
        });
        this.futuresWs.on('error', (err) => this.logger.error(`[GateConnector] Erro no WebSocket de Futuros: ${err.message}`));
    }
    
    subscribeToTickers(wsInstance, channel, symbols = []) {
        if (wsInstance.readyState !== WebSocket.OPEN || symbols.length === 0) return;
        const subscriptionMsg = {
            "time": Math.floor(Date.now() / 1000),
            "channel": channel,
            "event": "subscribe",
            "payload": symbols
        };
        wsInstance.send(JSON.stringify(subscriptionMsg));
        this.logger.info(`[GateConnector] Subscrito em ${symbols.length} tickers no canal ${channel}.`);
    }

    handleMessage(marketType, data) {
        try {
            const message = JSON.parse(data.toString());
            if (message.event === 'update' && message.result) {
                const ticker = message.result;
                const symbolApi = ticker.contract || ticker.currency_pair;
                if (!symbolApi) return;

                const formatted = {
                    symbol: symbolApi,
                    bidPrice: parseFloat(ticker.highest_bid),
                    askPrice: parseFloat(ticker.lowest_ask),
                    volume24hQuote: parseFloat(ticker.quote_volume || ticker.volume_24h_usdt),
                    fundingRate: parseFloat(ticker.funding_rate), // Só existirá em futuros
                    ts: message.time_ms || Date.now()
                };
                
                if (this.onDataUpdate) {
                    this.onDataUpdate('gateio', marketType, formatted);
                }
            }
        } catch (error) {
            this.logger.error(`[GateConnector] Erro ao processar mensagem ${marketType}: ${error.message}`);
        }
    }

    // --- LÓGICA REST (Ainda necessária para a inicialização) ---
    async getFuturesContractDetail() {
        // ... (esta função continua igual à sua versão anterior, sem necessidade de alteração) ...
    }

    closeAll() {
        this.logger.info("[GateConnector] Fechando conexões WebSocket da Gate.io...");
        if(this.spotWs) this.spotWs.close();
        if(this.futuresWs) this.futuresWs.close();
    }
}

module.exports = GateConnector;