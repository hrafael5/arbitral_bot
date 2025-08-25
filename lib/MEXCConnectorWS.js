const WebSocket = require("ws");
const path = require("path");

class MEXCConnectorWS {
    constructor(config, logger) {
        this.config = config;
        this.logger = logger;
        this.wsSpot = null;
        this.wsFutures = null;
        this.marketData = {}; 
        this.callbacks = {}; 
        this.subscribedPairs = new Set(); 
        this.isConnected = { spot: false, futures: false };
        this.reconnectAttempts = { spot: 0, futures: 0 };
        this.maxReconnectAttempts = 10;
        this.reconnectDelay = 5000;

        this.marketData.spot = {};
        this.marketData.futures = {};
    }

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
                    const messageString = event.data instanceof Buffer ? event.data.toString("utf8") : event.data.toString();
                    const jsonMessage = JSON.parse(messageString);
                    this.logger.debug("[MEXC SPOT WS] Mensagem JSON recebida:", jsonMessage);
                    this.handleSpotMessage(jsonMessage);
                } catch (e) {
                    this.logger.debug("[MEXC SPOT WS] Mensagem não JSON recebida (provavelmente Protobuf)");
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
        this.logger.debug("[MEXC SPOT WS] Mensagem recebida:", JSON.stringify(msg));

        switch (msg.method) {
            case "spot.ping":
                this.logger.debug("[MEXC SPOT WS] Ping recebido.");
                break;
            case "spot.pong":
                this.logger.debug("[MEXC SPOT WS] Pong recebido.");
                break;
            case "spot.ticker":
                let tickerSpotSymbol = msg.params?.symbol || msg.symbol;
                if (!tickerSpotSymbol && msg.data) {
                    tickerSpotSymbol = msg.data.s || msg.data.pair;
                }
                if (tickerSpotSymbol && typeof tickerSpotSymbol === 'string' && tickerSpotSymbol !== "UNKNOWN") {
                    if (!tickerSpotSymbol.includes("/") && tickerSpotSymbol.includes("USDT")) {
                        tickerSpotSymbol = tickerSpotSymbol.replace("USDT", "/USDT");
                    }
                } else {
                    tickerSpotSymbol = "UNKNOWN";
                    this.logger.warn("[MEXC SPOT WS] Símbolo do Ticker Spot não encontrado ou inválido. Mensagem completa:", JSON.stringify(msg));
                }

                const spotTickerData = {
                    symbol: tickerSpotSymbol,
                    last: parseFloat(msg.params?.lastPrice || msg.data?.lastPrice),
                    bid: parseFloat(msg.params?.bidPrice || msg.data?.bidPrice),
                    ask: parseFloat(msg.params?.askPrice || msg.data?.askPrice),
                    ts: msg.params?.timestamp || Date.now(),
                };
                this.logger.debug(`[MEXC SPOT WS] Ticker Spot data for ${spotTickerData.symbol}: Last=${spotTickerData.last}, Bid=${spotTickerData.bid}, Ask=${spotTickerData.ask}, TS=${spotTickerData.ts}`);
                if (this.callbacks.onSpotTicker) {
                    this.callbacks.onSpotTicker(spotTickerData);
                }
                break;
            case "spot.depth":
                let depthSpotSymbol = msg.params?.symbol || msg.symbol;
                if (!depthSpotSymbol && msg.data) {
                    depthSpotSymbol = msg.data.s || msg.data.pair;
                }
                if (depthSpotSymbol && typeof depthSpotSymbol === 'string' && depthSpotSymbol !== "UNKNOWN") {
                    if (!depthSpotSymbol.includes("/") && depthSpotSymbol.includes("USDT")) {
                        depthSpotSymbol = depthSpotSymbol.replace("USDT", "/USDT");
                    }
                } else {
                    depthSpotSymbol = "UNKNOWN";
                    this.logger.warn("[MEXC SPOT WS] Símbolo do Depth Spot não encontrado ou inválido. Mensagem completa:", JSON.stringify(msg));
                }

                const spotDepthData = {
                    symbol: depthSpotSymbol,
                    bids: msg.params?.bids || msg.data?.bids || [],
                    asks: msg.params?.asks || msg.data?.asks || [],
                    ts: msg.params?.timestamp || Date.now(),
                };
                this.logger.debug(`[MEXC SPOT WS] Depth Spot data for ${spotDepthData.symbol}: Bids=${spotDepthData.bids.length}, Asks=${spotDepthData.asks.length}, TS=${spotDepthData.ts}`);
                if (this.callbacks.onSpotDepth) {
                    this.callbacks.onSpotDepth(spotDepthData);
                }
                break;
            case "SUBSCRIPTION":
                this.logger.info("[MEXC SPOT WS] Subscrição confirmada:", msg);
                break;
            default:
                this.logger.debug("[MEXC SPOT WS] Canal desconhecido ou mensagem não tratada:", msg.method, "Dados:", JSON.stringify(msg));
                break;
        }
    }

    handleFuturesMessage(msg) {
    this.logger.debug("[MEXC FUTURES WS] Mensagem recebida:", JSON.stringify(msg));
    
    switch (msg.channel) {
        case "push.ticker":
            let tickerSymbol = msg.data?.symbol || msg.symbol;
            if (!tickerSymbol && msg.data) {
                tickerSymbol = msg.data.s || msg.data.pair;
            }
            if (!tickerSymbol && msg.data) {
                tickerSymbol = msg.data.symbol_name || msg.data.instId;
            }
            
            if (tickerSymbol && typeof tickerSymbol === 'string' && tickerSymbol !== "UNKNOWN") {
                if (!tickerSymbol.includes("_") && tickerSymbol.includes("USDT")) {
                    tickerSymbol = tickerSymbol.replace("USDT", "_USDT");
                }
            } else {
                tickerSymbol = "UNKNOWN";
                this.logger.warn("[MEXC FUTURES WS] Símbolo do Ticker não encontrado ou inválido. Mensagem completa:", JSON.stringify(msg));
            }
            
            const tickerData = {
                symbol: tickerSymbol,
                last: parseFloat(msg.data?.lastPrice || msg.data?.last),
                index: parseFloat(msg.data?.indexPrice),
                fair: parseFloat(msg.data?.fairPrice),
                ts: msg.ts || Date.now(),
            };

            this.logger.debug(`[MEXC FUTURES WS] Ticker data for ${tickerSymbol}: Last=${tickerData.last}, TS=${tickerData.ts}`);
            
            if (this.callbacks.onFuturesTicker) {
                this.callbacks.onFuturesTicker(tickerData);
            }
            break;

        case "push.deal":
            let dealSymbol = msg.data?.symbol || msg.symbol;
            if (!dealSymbol && msg.data) {
                dealSymbol = msg.data.s || msg.data.pair;
            }
            if (!dealSymbol && msg.data) {
                dealSymbol = msg.data.symbol_name || msg.data.instId;
            }
            
            if (dealSymbol && typeof dealSymbol === 'string' && dealSymbol !== "UNKNOWN") {
                if (!dealSymbol.includes("_") && dealSymbol.includes("USDT")) {
                    dealSymbol = dealSymbol.replace("USDT", "_USDT");
                }
            } else {
                dealSymbol = "UNKNOWN";
                this.logger.warn("[MEXC FUTURES WS] Símbolo do Deal não encontrado ou inválido. Mensagem completa:", JSON.stringify(msg));
            }
            
            this.logger.debug("[MEXC FUTURES WS] Deal symbol:", dealSymbol);
            
            this.updateMarketData("futures", "deals", {
                symbol: dealSymbol,
                price: parseFloat(msg.data?.p || msg.data?.price),
                qty: parseFloat(msg.data?.v || msg.data?.quantity),
                sideFlag: msg.data?.T || msg.data?.side,
                ts: msg.data?.t || msg.ts || Date.now(),
            });
            
            if (this.callbacks.onFuturesDeals) {
                this.callbacks.onFuturesDeals(this.marketData.futures.deals);
            }
            break;

        case "push.depth":
            let depthSymbol = msg.data?.symbol || msg.symbol;
            if (!depthSymbol && msg.data) {
                depthSymbol = msg.data.s || msg.data.pair;
            }
            if (!depthSymbol && msg.data) {
                depthSymbol = msg.data.symbol_name || msg.data.instId;
            }
            
            if (depthSymbol && typeof depthSymbol === 'string' && depthSymbol !== "UNKNOWN") {
                if (!depthSymbol.includes("_") && depthSymbol.includes("USDT")) {
                    depthSymbol = depthSymbol.replace("USDT", "_USDT");
                }
            } else {
                depthSymbol = "UNKNOWN";
                this.logger.warn("[MEXC FUTURES WS] Símbolo do Depth não encontrado ou inválido. Mensagem completa:", JSON.stringify(msg));
            }
            
            this.logger.debug("[MEXC FUTURES WS] Depth symbol:", depthSymbol);
            
            const bids = msg.data?.bids || [];
            const asks = msg.data?.asks || [];
            
            if (bids.length === 0 && asks.length === 0) {
                this.logger.warn(`[MEXC FUTURES WS] Empty depth data for ${depthSymbol}`);
                return;
            }
            
            this.updateMarketData("futures", "depth", {
                symbol: depthSymbol,
                bids: bids.map(([p, q]) => [Number(p), Number(q)]),
                asks: asks.map(([p, q]) => [Number(p), Number(q)]),
                ts: msg.ts || Date.now(),
            });
            
            if (this.callbacks.onFuturesDepth) {
                this.callbacks.onFuturesDepth(this.marketData.futures.depth);
            }
            break;

        case "push.kline":
            let klineSymbol = msg.data?.symbol || msg.symbol;
            if (!klineSymbol && msg.data) {
                klineSymbol = msg.data.s || msg.data.pair;
            }
            if (!klineSymbol && msg.data) {
                klineSymbol = msg.data.symbol_name || msg.data.instId;
            }
            
            if (klineSymbol && typeof klineSymbol === 'string' && klineSymbol !== "UNKNOWN") {
                if (!klineSymbol.includes("_") && klineSymbol.includes("USDT")) {
                    klineSymbol = klineSymbol.replace("USDT", "_USDT");
                }
            }
            
            this.logger.debug("[MEXC FUTURES WS] Kline symbol:", klineSymbol);
            
            this.updateMarketData("futures", "kline", {
                symbol: klineSymbol,
                open: parseFloat(msg.data?.o),
                close: parseFloat(msg.data?.c),
                high: parseFloat(msg.data?.h),
                low: parseFloat(msg.data?.l),
                volume: parseFloat(msg.data?.v),
                ts: msg.ts || Date.now(),
            });
            
            if (this.callbacks.onFuturesKline) {
                this.callbacks.onFuturesKline(this.marketData.futures.kline);
            }
            break;

        default:
            this.logger.debug("[MEXC FUTURES WS] Canal desconhecido ou mensagem não tratada:", msg.channel, "Dados:", JSON.stringify(msg));
            break;
    }
}

    registerCallback(type, callback) {
        this.callbacks[type] = callback;
    }

    subscribeSpotPair(symbol) {
        if (!this.isConnected.spot) {
            this.logger.warn("[MEXC SPOT WS] Não conectado, não é possível subscrever");
            return;
        }
        const payload = { symbol: symbol.replace("/USDT", "USDT") };
        this.wsSpot.send(JSON.stringify({ method: "SUBSCRIPTION", params: { channel: "spot.ticker", symbol: payload.symbol } }));
        this.wsSpot.send(JSON.stringify({ method: "SUBSCRIPTION", params: { channel: "spot.depth", symbol: payload.symbol, depth: 5 } }));
        this.subscribedPairs.add(`spot_${symbol}`);
        this.logger.info(`[MEXC SPOT WS] Subscrito ao par: ${symbol}`);
    }

    subscribeFuturesPair(symbol) {
        if (!this.isConnected.futures) {
            this.logger.warn("[MEXC FUTURES WS] Não conectado, não é possível subscrever");
            return;
        }
        const payload = { symbol: symbol.replace("/USDT", "_USDT") };
        this.wsFutures.send(JSON.stringify({ method: "SUBSCRIPTION", params: { channel: "push.ticker", symbol: payload.symbol } }));
        this.wsFutures.send(JSON.stringify({ method: "SUBSCRIPTION", params: { channel: "push.depth", symbol: payload.symbol, depth: 5 } }));
        this.subscribedPairs.add(`futures_${symbol}`);
        this.logger.info(`[MEXC FUTURES WS] Subscrito ao par: ${symbol}`);
    }

    reconnectSpot(delay) {
        if (this.reconnectAttempts.spot >= this.maxReconnectAttempts) {
            this.logger.error("[MEXC SPOT WS] Máximo de tentativas de reconexão atingido");
            return;
        }
        this.reconnectAttempts.spot++;
        setTimeout(() => this.initSpotWebSocket().then(() => {
            this.subscribedPairs.forEach(pair => {
                if (pair.startsWith("spot_")) {
                    this.subscribeSpotPair(pair.replace("spot_", ""));
                }
            });
        }), delay || this.reconnectDelay);
    }

    reconnectFutures(delay) {
        if (this.reconnectAttempts.futures >= this.maxReconnectAttempts) {
            this.logger.error("[MEXC FUTURES WS] Máximo de tentativas de reconexão atingido");
            return;
        }
        this.reconnectAttempts.futures++;
        setTimeout(() => this.initFuturesWebSocket().then(() => {
            this.subscribedPairs.forEach(pair => {
                if (pair.startsWith("futures_")) {
                    this.subscribeFuturesPair(pair.replace("futures_", ""));
                }
            });
        }), delay || this.reconnectDelay);
    }

    updateMarketData(type, dataType, data) {
        if (!this.marketData[type][data.symbol]) {
            this.marketData[type][data.symbol] = {};
        }
        this.marketData[type][data.symbol][dataType] = data;
    }

    closeAll() {
        if (this.wsSpot) {
            this.wsSpot.close();
        }
        if (this.wsFutures) {
            this.wsFutures.close();
        }
    }

    async getSpotPairs() {
        this.logger.info("[MEXCConnectorWS] getSpotPairs chamado. Retornando pares de exemplo.");
        return { data: ["BTCUSDT", "ETHUSDT", "ADAUSDT", "SOLUSDT"] };
    }
}

module.exports = MEXCConnectorWS;


