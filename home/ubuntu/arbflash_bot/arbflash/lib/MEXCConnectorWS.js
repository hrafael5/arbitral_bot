// arbitral_bot/arbitral_bot/lib/MEXCConnectorWS.js
const WebSocket = require("ws");
const path = require("path");

class MEXCConnectorWS {
    constructor(config, logger) {
        this.config = config;
        this.logger = logger;
        this.wsSpot = null;
        this.wsFutures = null;
        this.marketData = {}; // Para armazenar os dados de mercado recebidos via WS
        this.callbacks = {}; // Para registrar callbacks para diferentes tipos de dados
        this.subscribedPairs = new Set(); // Para rastrear pares subscritos
        this.isConnected = { spot: false, futures: false };
        this.reconnectAttempts = { spot: 0, futures: 0 };
        this.maxReconnectAttempts = 10;
        this.reconnectDelay = 5000;

        // Inicializar dados de mercado
        this.marketData.spot = {};
        this.marketData.futures = {};
    }

    // Método para inicializar conexões WebSocket
    async initialize() {
        this.logger.info("[MEXC WS] Inicializando conexões WebSocket...");
        await Promise.all([
            this.initSpotWebSocket(),
            this.initFuturesWebSocket()
        ]);
    }

    initSpotWebSocket() {
        return new Promise((resolve) => {
            const websocketUrl = "wss://wbs-api.mexc.com/ws";
            this.wsSpot = new WebSocket(websocketUrl);

            this.wsSpot.onopen = () => {
                this.logger.info("[MEXC SPOT WS] Conexão aberta");
                this.isConnected.spot = true;
                this.reconnectAttempts.spot = 0;
                resolve();
            };

            this.wsSpot.onmessage = (event) => {
                try {
                    // Tenta decodificar como JSON primeiro
                    const messageString = event.data instanceof Buffer ? event.data.toString("utf8") : event.data.toString();
                    const jsonMessage = JSON.parse(messageString);
                    this.logger.debug("[MEXC SPOT WS] Mensagem JSON recebida:", jsonMessage);
                    this.handleSpotMessage(jsonMessage);
                } catch (e) {
                    // Se não for JSON, pode ser Protobuf
                    this.logger.debug("[MEXC SPOT WS] Mensagem não JSON recebida (provavelmente Protobuf)");
                    // Aqui você pode implementar a decodificação Protobuf se necessário
                    // Para agora, vamos apenas logar que recebemos dados
                }
            };

            this.wsSpot.onerror = (error) => {
                this.logger.error("[MEXC SPOT WS] Erro no WebSocket:", error.message);
            };

            this.wsSpot.onclose = (event) => {
                this.logger.warn(`[MEXC SPOT WS] Conexão fechada com código: ${event.code}, razão: ${event.reason}`);
                this.isConnected.spot = false;
                this.reconnectSpot();
            };
        });
    }

    initFuturesWebSocket() {
        return new Promise((resolve) => {
            const URLS = ["wss://contract.mexc.com/edge", "wss://contract.mexc.com/ws?locale=en-US"];
            const HEADERS = {
                Origin: "https://www.mexc.com",
                "User-Agent": "Mozilla/5.0",
                Host: "contract.mexc.com",
                "Cache-Control": "no-cache",
                Pragma: "no-cache",
            };

            let idx = 0;
            let pingTimer = null;
            let backoff = 1000;

            const connect = () => {
                const url = URLS[idx % URLS.length];
                this.logger.info(`[MEXC FUTURES WS] conectando: ${url}`);
                this.wsFutures = new WebSocket(url, { headers: HEADERS, perMessageDeflate: false });

                this.wsFutures.onopen = () => {
                    this.logger.info("[MEXC FUTURES WS] conectado");
                    this.isConnected.futures = true;
                    this.reconnectAttempts.futures = 0;
                    backoff = 1000;

                    clearInterval(pingTimer);
                    pingTimer = setInterval(() => {
                        try { 
                            if (this.wsFutures && this.wsFutures.readyState === WebSocket.OPEN) {
                                this.wsFutures.send(JSON.stringify({ ping: Date.now() })); 
                            }
                        } catch (e) { 
                            this.logger.error("[MEXC FUTURES WS] Erro ao enviar ping:", e.message); 
                        }
                    }, 15000);

                    resolve();
                };

                this.wsFutures.onmessage = (message) => {
                    const txt = message.data instanceof Buffer ? message.data.toString("utf8") : message.data.toString();

                    if (txt.includes("ping") && !txt.includes("\"ping\"")) {
                        try { 
                            if (this.wsFutures && this.wsFutures.readyState === WebSocket.OPEN) {
                                this.wsFutures.send(txt.replace("ping", "pong")); 
                            }
                        } catch (e) { 
                            this.logger.error("[MEXC FUTURES WS] Erro ao enviar pong (texto):", e.message); 
                        }
                        return;
                    }

                    let msg;
                    try { msg = JSON.parse(txt); } catch { return; }

                    if (msg.ping) { 
                        try { 
                            if (this.wsFutures && this.wsFutures.readyState === WebSocket.OPEN) {
                                this.wsFutures.send(JSON.stringify({ pong: msg.ping })); 
                            }
                        } catch (e) { 
                            this.logger.error("[MEXC FUTURES WS] Erro ao enviar pong (JSON):", e.message); 
                        }
                        return; 
                    }

                    if (msg.channel === "rs.error") { 
                        this.logger.warn("[MEXC FUTURES WS] rs.error:", msg); 
                        return; 
                    }

                    this.handleFuturesMessage(msg);
                };

                this.wsFutures.onerror = (e) => {
                    this.logger.error("[MEXC FUTURES WS] erro:", e.message);
                };

                this.wsFutures.onclose = () => {
                    clearInterval(pingTimer);
                    this.logger.warn("[MEXC FUTURES WS] fechado, reconectando…");
                    this.isConnected.futures = false;
                    idx++; 
                    setTimeout(connect, backoff);
                    backoff = Math.min(backoff * 2, 15000);
                };
            };

            connect();
        });
    }

    handleSpotMessage(msg) {
        // Processar mensagens do spot aqui
        if (msg.method === "SUBSCRIPTION") {
            this.logger.info("[MEXC SPOT WS] Subscrição confirmada:", msg);
        }
        // Adicionar mais lógica de processamento conforme necessário
    }

    handleFuturesMessage(msg) {
        switch (msg.channel) {
            case "push.ticker":
                this.updateMarketData("futures", "ticker", {
                    symbol: msg.data.symbol,
                    last: msg.data.lastPrice,
                    index: msg.data.indexPrice,
                    fair: msg.data.fairPrice,
                    ts: msg.ts || Date.now(),
                });
                if (this.callbacks.onFuturesTicker) {
                    this.callbacks.onFuturesTicker(this.marketData.futures.ticker);
                }
                break;

            case "push.deal":
                this.updateMarketData("futures", "deals", {
                    symbol: msg.symbol || msg.data.symbol || "UNKNOWN",
                    price: msg.data.p,
                    qty: msg.data.v,
                    sideFlag: msg.data.T,
                    ts: msg.data.t,
                });
                if (this.callbacks.onFuturesDeals) {
                    this.callbacks.onFuturesDeals(this.marketData.futures.deals);
                }
                break;

            case "push.depth":
                this.updateMarketData("futures", "depth", {
                    symbol: msg.symbol || msg.data.symbol || "UNKNOWN",
                    bids: (msg.data.bids || []).map(([p, q]) => [Number(p), Number(q)]),
                    asks: (msg.data.asks || []).map(([p, q]) => [Number(p), Number(q)]),
                    ts: msg.ts || Date.now(),
                });
                if (this.callbacks.onFuturesDepth) {
                    this.callbacks.onFuturesDepth(this.marketData.futures.depth);
                }
                break;

            case "push.kline":
                this.updateMarketData("futures", "kline", {
                    symbol: msg.symbol || msg.data.symbol || "UNKNOWN",
                    interval: msg.data.interval,
                    open: msg.data.o,
                    close: msg.data.c,
                    high: msg.data.h,
                    low: msg.data.l,
                    baseVol: msg.data.q,
                    quoteVol: msg.data.a,
                    openTime: msg.data.t,
                });
                if (this.callbacks.onFuturesKline) {
                    this.callbacks.onFuturesKline(this.marketData.futures.kline);
                }
                break;

            default:
                // Respostas de subscrição ou outros canais
                if (msg.channel && msg.channel.startsWith("rs.sub")) {
                    this.logger.debug("[MEXC FUTURES WS] Subscrição confirmada:", msg.channel);
                }
                break;
        }
    }

    // Método para subscrever a um par no spot
    subscribeSpotPair(symbol) {
        if (!this.isConnected.spot) {
            this.logger.warn("[MEXC SPOT WS] Não conectado, não é possível subscrever");
            return;
        }

        const subscribeMessage = {
            method: "SUBSCRIPTION",
            params: [`spot@public.aggre.deals.v3.api.pb@100ms@${symbol.replace("/", "")}`],
        };
        
        try {
            this.wsSpot.send(JSON.stringify(subscribeMessage));
            this.subscribedPairs.add(`spot_${symbol}`);
            this.logger.info(`[MEXC SPOT WS] Subscrito ao par: ${symbol}`);
        } catch (error) {
            this.logger.error(`[MEXC SPOT WS] Erro ao subscrever ${symbol}:`, error.message);
        }
    }

    // Método para subscrever a um par no futures
    subscribeFuturesPair(symbol, depthLimit = 5) {
        if (!this.isConnected.futures) {
            this.logger.warn("[MEXC FUTURES WS] Não conectado, não é possível subscrever");
            return;
        }

        const symbolFormatted = symbol.replace("/", "_");
        const subs = [
            { method: "sub.ticker", param: { symbol: symbolFormatted }, id: Date.now() + 1 },
            { method: "sub.deal", param: { symbol: symbolFormatted }, id: Date.now() + 2 },
            { method: "sub.depth", param: { symbol: symbolFormatted, limit: depthLimit }, id: Date.now() + 3 },
            { method: "sub.kline", param: { symbol: symbolFormatted, interval: "Min1" }, id: Date.now() + 4 },
        ];

        try {
            for (const sub of subs) {
                this.wsFutures.send(JSON.stringify(sub));
            }
            this.subscribedPairs.add(`futures_${symbol}`);
            this.logger.info(`[MEXC FUTURES WS] Subscrito ao par: ${symbol}`);
        } catch (error) {
            this.logger.error(`[MEXC FUTURES WS] Erro ao subscrever ${symbol}:`, error.message);
        }
    }

    reconnectSpot() {
        if (this.reconnectAttempts.spot >= this.maxReconnectAttempts) {
            this.logger.error("[MEXC SPOT WS] Máximo de tentativas de reconexão atingido");
            return;
        }

        this.reconnectAttempts.spot++;
        this.logger.info(`[MEXC SPOT WS] Tentativa de reconexão ${this.reconnectAttempts.spot}/${this.maxReconnectAttempts} em ${this.reconnectDelay}ms`);
        
        setTimeout(() => {
            this.initSpotWebSocket().then(() => {
                // Resubscrever aos pares após reconexão
                this.subscribedPairs.forEach(pair => {
                    if (pair.startsWith("spot_")) {
                        const symbol = pair.replace("spot_", "");
                        this.subscribeSpotPair(symbol);
                    }
                });
            });
        }, this.reconnectDelay);
    }

    updateMarketData(type, key, data) {
        if (!this.marketData[type]) {
            this.marketData[type] = {};
        }
        this.marketData[type][key] = data;
    }

    getMarketData(type, key) {
        return this.marketData[type] ? this.marketData[type][key] : null;
    }

    registerCallback(type, callback) {
        this.callbacks[type] = callback;
    }

    // Métodos de compatibilidade com a interface existente
    async getFuturesContractDetail() {
        this.logger.info("[MEXC WS] Retornando contratos de exemplo para WebSocket.");
        // Em um cenário real, isso viria de uma API REST ou cache
        return { 
            success: true, 
            data: [
                { symbol: "BTC_USDT", quoteCoin: "USDT", settleCoin: "USDT" }, 
                { symbol: "ETH_USDT", quoteCoin: "USDT", settleCoin: "USDT" },
                { symbol: "ADA_USDT", quoteCoin: "USDT", settleCoin: "USDT" },
                { symbol: "SOL_USDT", quoteCoin: "USDT", settleCoin: "USDT" }
            ] 
        };
    }

    async getSpotPairs() {
        this.logger.info("[MEXC WS] Retornando pares spot de exemplo para WebSocket.");
        return { 
            success: true, 
            data: ["BTCUSDT", "ETHUSDT", "ADAUSDT", "SOLUSDT"] 
        };
    }

    // Métodos REST ainda necessários para operações que não são via WS
    async getAllSpotBookTickers() {
        this.logger.warn("[MEXC WS] getAllSpotBookTickers ainda usa REST. Considere implementar via WS se necessário.");
        return new Map();
    }

    async getAllSpot24hrStats() {
        this.logger.warn("[MEXC WS] getAllSpot24hrStats ainda usa REST. Considere implementar via WS se necessário.");
        return new Map();
    }

    async getAllFuturesBookTickers() {
        this.logger.warn("[MEXC WS] getAllFuturesBookTickers ainda usa REST. Considere implementar via WS se necessário.");
        return new Map();
    }

    // Métodos de ordem e saldo (ainda via REST)
    async getBalance(currency) {
        this.logger.warn("[MEXC WS] getBalance ainda usa REST. Implementar WS se necessário.");
        return { success: false, message: "Não implementado via WS" };
    }

    async placeOrder(symbol, side, type, quantity, price) {
        this.logger.warn("[MEXC WS] placeOrder ainda usa REST. Implementar WS se necessário.");
        return { success: false, message: "Não implementado via WS" };
    }

    async cancelOrder(symbol, orderId) {
        this.logger.warn("[MEXC WS] cancelOrder ainda usa REST. Implementar WS se necessário.");
        return { success: false, message: "Não implementado via WS" };
    }

    // Métodos de conexão WebSocket para compatibilidade
    connectFuturesWebSocket(onOpenCallback) {
        if (this.isConnected.futures) {
            if (onOpenCallback) onOpenCallback();
            return;
        }
        
        this.initFuturesWebSocket().then(() => {
            if (onOpenCallback) onOpenCallback();
        });
    }

    closeAll() {
        this.logger.info("[MEXC WS] Fechando conexões WebSocket...");
        
        if (this.wsSpot) {
            this.wsSpot.removeAllListeners();
            this.wsSpot.close();
            this.wsSpot = null;
        }
        
        if (this.wsFutures) {
            this.wsFutures.removeAllListeners();
            this.wsFutures.close();
            this.wsFutures = null;
        }
        
        this.isConnected.spot = false;
        this.isConnected.futures = false;
        this.subscribedPairs.clear();
        this.logger.info("[MEXC WS] Conexões WebSocket fechadas.");
    }
}

module.exports = MEXCConnectorWS;

