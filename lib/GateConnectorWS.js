const WebSocket = require("ws");

// ---------- utils ----------
const num = (x) => {
    const n = Number(x);
    return Number.isFinite(n) ? n : null;
};

function normalizeLevels(levels) {
    if (!levels) return [];
    if (Array.isArray(levels)) {
        return levels
            .map((lvl) => {
                if (Array.isArray(lvl)) return [num(lvl[0]), num(lvl[1])];
                if (lvl && typeof lvl === "object") {
                    const price = lvl.p ?? lvl.price ?? lvl[0];
                    const size = lvl.q ?? lvl.s ?? lvl.size ?? lvl[1];
                    return [num(price), num(size)];
                }
                return [num(lvl) ?? null, null];
            })
            .filter(([p, q]) => p !== null && q !== null);
    }
    if (typeof levels === "object") {
        return Object.entries(levels)
            .map(([price, size]) => [num(price), num(size)])
            .filter(([p, q]) => p !== null && q !== null);
    }
    return [];
}

class GateConnectorWS {
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
        this.logger.info("[GATE WS] Inicializando conexões WebSocket...");
        await Promise.all([
            this.initSpotWebSocket(),
            this.initFuturesWebSocket()
        ]);
    }

    buildSpotSub(channel, payload) {
        return { time: Math.floor(Date.now()/1000), channel, event: 'subscribe', payload };
    }

    buildFutSub(channel, payload) {
        return { time: Math.floor(Date.now()/1000), channel, event: 'subscribe', payload };
    }

    initSpotWebSocket() {
        return new Promise((resolve) => {
            const url = "wss://api.gateio.ws/ws/v4/";
            this.logger.info(`[GATE SPOT WS] 🔌 conectando: ${url}`);
            this.wsSpot = new WebSocket(url);

            let hb;
            let alive = false;
            let backoff = 1000;

            const send = (obj) => this.wsSpot?.readyState === WebSocket.OPEN && this.wsSpot.send(JSON.stringify(obj));

            const heartbeat = () => {
                clearInterval(hb);
                hb = setInterval(() => {
                    if (!alive) { try { this.wsSpot.terminate(); } catch (e) { this.logger.error("[GATE SPOT WS] Erro ao terminar WS inativo:", e.message); } return; }
                    alive = false; send({ time: Math.floor(Date.now()/1000), channel: "ping" });
                }, 15000);
            };

            this.wsSpot.onopen = () => {
                this.logger.info("[GATE SPOT WS] ✅ conectado");
                this.isConnected.spot = true;
                this.reconnectAttempts.spot = 0;
                alive = true;
                backoff = 1000;
                heartbeat();
                resolve();
            };

            this.wsSpot.onmessage = (raw) => {
                let messageString;
                try {
                    messageString = raw.data instanceof Buffer ? raw.data.toString("utf8") : raw.data.toString();
                    this.logger.debug("[GATE SPOT WS] Raw message received:", messageString);
                    
                    if (!messageString || messageString.trim() === '') {
                        this.logger.debug("[GATE SPOT WS] Mensagem vazia recebida, ignorando");
                        return;
                    }
                    
                    const m = JSON.parse(messageString);
                    if (m.event === "subscribe") { this.logger.info("[GATE SPOT WS] sub OK:", m.channel); return; }
                    if (m.event === "error" || m.error) { this.logger.warn("[GATE SPOT WS] erro canal", m.channel + ":", JSON.stringify(m)); return; }
                    if (m.channel === "pong") { alive = true; return; }
                    const r = m.result; if (!r) return;

                    switch (m.channel) {
                        case "spot.book_ticker":
                            const bookTickerItem = Array.isArray(r) ? r[0] : r;
                            this.updateMarketData("spot", "bookTicker", {
                                symbol: bookTickerItem?.s || bookTickerItem?.currency_pair,
                                bid: num(bookTickerItem?.b),
                                ask: num(bookTickerItem?.a),
                                ts: bookTickerItem?.t || m.time
                            });
                            if (this.callbacks.onSpotBookTicker) this.callbacks.onSpotBookTicker(this.marketData.spot.bookTicker);
                            break;
                        case "spot.tickers":
                            const tickerItem = Array.isArray(r) ? r[0] : r;
                            this.updateMarketData("spot", "ticker", {
                                symbol: tickerItem?.currency_pair || tickerItem?.s,
                                last: num(tickerItem?.last ?? tickerItem?.close ?? tickerItem?.close_price),
                                ts: m.time ? m.time*1000 : Date.now(),
                            });
                            if (this.callbacks.onSpotTicker) this.callbacks.onSpotTicker(this.marketData.spot.ticker);
                            break;
                        case "spot.trades":
                            const arrTrades = Array.isArray(r) ? r : [r];
                            for (const t of arrTrades) {
                                this.updateMarketData("spot", "trade", {
                                    symbol: t?.currency_pair || t?.s,
                                    price: num(t?.price),
                                    amount: num(t?.amount),
                                    side: t?.side,
                                    ts: Number(t?.create_time_ms) || Number(t?.create_time) * 1000 || m.time
                                });
                                if (this.callbacks.onSpotTrade) this.callbacks.onSpotTrade(this.marketData.spot.trade);
                            }
                            break;
                        case "spot.order_book_update":
                            const spotDepthItem = Array.isArray(r) ? r[0] : r;
                            const spotDepthSymbol = spotDepthItem?.s || spotDepthItem?.currency_pair;
                            const normalizedSpotDepthSymbol = spotDepthSymbol ? spotDepthSymbol.replace("_", "/") : "UNKNOWN";

                            this.updateMarketData("spot", "depth", {
                                symbol: normalizedSpotDepthSymbol,
                                bids: normalizeLevels(spotDepthItem?.b),
                                asks: normalizeLevels(spotDepthItem?.a),
                                ts: spotDepthItem?.t || m.time
                            });
                            if (this.callbacks.onSpotDepth) this.callbacks.onSpotDepth(this.marketData.spot.depth);
                            break;
                        default: break;
                    }
                } catch (e) {
                    this.logger.error("[GATE SPOT WS] Erro ao processar mensagem:", e.message, "Raw data:", messageString || "undefined");
                }
            };

            this.wsSpot.onerror = (err) => this.logger.error("[GATE SPOT WS] erro:", err.message);

            this.wsSpot.onclose = async () => {
                clearInterval(hb);
                this.logger.warn("[GATE SPOT WS] ❌ desconectou — retry em", backoff, "ms");
                this.isConnected.spot = false;
                this.reconnectSpot(backoff);
                backoff = Math.min(backoff * 2, 30000);
            };
        });
    }

    initFuturesWebSocket() {
        return new Promise((resolve) => {
            const url = "wss://fx-ws.gateio.ws/v4/ws/usdt";
            this.logger.info(`[GATE FUTURES WS] 🔌 conectando: ${url}`);
            this.wsFutures = new WebSocket(url);

            let hb;
            let alive = false;
            let backoff = 1000;

            const send = (obj) => this.wsFutures?.readyState === WebSocket.OPEN && this.wsFutures.send(JSON.stringify(obj));

            const heartbeat = () => {
                clearInterval(hb);
                hb = setInterval(() => {
                    if (!alive) { try { this.wsFutures.terminate(); } catch (e) { this.logger.error("[GATE FUTURES WS] Erro ao terminar WS inativo:", e.message); } return; }
                    alive = false; send({ time: Math.floor(Date.now()/1000), channel: "ping" });
                }, 15000);
            };

            this.wsFutures.onopen = () => {
                this.logger.info("[GATE FUTURES WS] ✅ conectado");
                this.isConnected.futures = true;
                this.reconnectAttempts.futures = 0;
                alive = true;
                backoff = 1000;
                heartbeat();
                resolve();
            };

            this.wsFutures.onmessage = (raw) => {
                let messageString;
                try {
                    messageString = raw.data instanceof Buffer ? raw.data.toString("utf8") : raw.data.toString();
                    this.logger.debug("[GATE FUTURES WS] Raw message received:", messageString);

                    if (!messageString || messageString.trim() === "") {
                        this.logger.debug("[GATE FUTURES WS] Mensagem vazia recebida, ignorando");
                        return;
                    }

                    const m = JSON.parse(messageString);
                    if (m.event === "subscribe") { this.logger.info("[GATE FUTURES WS] sub OK:", m.channel); return; }
                    if (m.event === "error" || m.error) { this.logger.warn("[GATE FUTURES WS] erro canal", m.channel + ":", JSON.stringify(m)); return; }
                    if (m.channel === "pong") { alive = true; return; }
                    const r = m.result; if (!r) return;

                    const ch = m.channel;
                    if (ch === "futures.book_ticker") {
                        const bookTickerItem = Array.isArray(r) ? r[0] : r;
                        this.updateMarketData("futures", "bookTicker", {
                            symbol: bookTickerItem?.contract || bookTickerItem?.s,
                            bid: num(bookTickerItem?.bid),
                            ask: num(bookTickerItem?.ask),
                            ts: bookTickerItem?.t || m.time
                        });
                        if (this.callbacks.onFuturesBookTicker) this.callbacks.onFuturesBookTicker(this.marketData.futures.bookTicker);
                    } else if (ch === "futures.tickers") {
                        const tickerItem = Array.isArray(r) ? r[0] : r;
                        this.updateMarketData("futures", "ticker", {
                            symbol: tickerItem?.contract || tickerItem?.s,
                            last: num(tickerItem?.last ?? tickerItem?.close),
                            fundingRate: tickerItem?.funding_rate != null ? num(tickerItem?.funding_rate) : undefined,
                            ts: m.time ? m.time*1000 : Date.now(),
                        });
                        if (this.callbacks.onFuturesTicker) this.callbacks.onFuturesTicker(this.marketData.futures.ticker);
                    } else if (ch === "futures.trades") {
                        const arrTrades = Array.isArray(r) ? r : [r];
                        for (const t of arrTrades) {
                            const sym  = t.contract || t.s;
                            const size = Number(t.size);
                            const side = size >= 0 ? 'buy' : 'sell';
                            this.updateMarketData("futures", "trade", {
                                symbol: sym,
                                price: num(t.price),
                                amount: Math.abs(size),
                                side: side,
                                ts: Number(t.create_time_ms) || Number(t.create_time) * 1000 || m.time
                            });
                            if (this.callbacks.onFuturesTrade) this.callbacks.onFuturesTrade(this.marketData.futures.trade);
                        }
                    } else if (ch === "futures.order_book_update") {
                        const item = Array.isArray(r) ? r[0] : r;
                        if (!item) return;
                        
                        const futuresDepthSymbol = item?.contract || item?.symbol || item?.s;
                        const normalizedFuturesDepthSymbol = futuresDepthSymbol ? futuresDepthSymbol.replace("_", "/") : "UNKNOWN";

                        this.updateMarketData("futures", "depth", {
                            symbol: normalizedFuturesDepthSymbol,
                            bids: normalizeLevels(item?.b || item?.bids),
                            asks: normalizeLevels(item?.a || item?.asks),
                            ts: item?.t || m.time
                        });
                        if (this.callbacks.onFuturesDepth) this.callbacks.onFuturesDepth(this.marketData.futures.depth);
                    }
                } catch (e) {
                    this.logger.error("[GATE FUTURES WS] Erro ao processar mensagem:", e.message, "Raw data:", messageString || "undefined");
                }
            };

            this.wsFutures.onerror = (err) => this.logger.error("[GATE FUTURES WS] erro:", err.message);

            this.wsFutures.onclose = async () => {
                clearInterval(hb);
                this.logger.warn("[GATE FUTURES WS] ❌ desconectou — retry em", backoff, "ms");
                this.isConnected.futures = false;
                this.reconnectFutures(backoff);
                backoff = Math.min(backoff * 2, 30000);
            };
        });
    }

    subscribeSpotPair(symbol) {
        if (!this.isConnected.spot) {
            this.logger.warn("[GATE SPOT WS] Não conectado, não é possível subscrever");
            return;
        }
        const payload = [symbol.replace("/", "_")];
        this.wsSpot.send(JSON.stringify(this.buildSpotSub("spot.book_ticker", payload)));
        this.wsSpot.send(JSON.stringify(this.buildSpotSub("spot.tickers", payload)));
        this.wsSpot.send(JSON.stringify(this.buildSpotSub("spot.trades", payload)));
        this.wsSpot.send(JSON.stringify(this.buildSpotSub("spot.order_book_update", [symbol.replace("/", "_"), "100ms"])));
        this.subscribedPairs.add(`spot_${symbol}`);
        this.logger.info(`[GATE SPOT WS] Subscrito ao par: ${symbol}`);
    }

    subscribeFuturesPair(symbol) {
        if (!this.isConnected.futures) {
            this.logger.warn("[GATE FUTURES WS] Não conectado, não é possível subscrever");
            return;
        }
        const payload = [symbol.replace("/", "_")];
        this.wsFutures.send(JSON.stringify(this.buildFutSub("futures.book_ticker", payload)));
        this.wsFutures.send(JSON.stringify(this.buildFutSub("futures.tickers", payload)));
        this.wsFutures.send(JSON.stringify(this.buildFutSub("futures.trades", payload)));
        this.wsFutures.send(JSON.stringify(this.buildFutSub("futures.order_book_update", [symbol.replace("/", "_"), "100ms"])));
        this.subscribedPairs.add(`futures_${symbol}`);
        this.logger.info(`[GATE FUTURES WS] Subscrito ao par: ${symbol}`);
    }

    reconnectSpot(delay) {
        if (this.reconnectAttempts.spot >= this.maxReconnectAttempts) {
            this.logger.error("[GATE SPOT WS] Máximo de tentativas de reconexão atingido");
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
            this.logger.error("[GATE FUTURES WS] Máximo de tentativas de reconexão atingido");
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

    registerCallback(type, callback) {
        this.callbacks[type] = callback;
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
        this.logger.info("[GateConnectorWS] getSpotPairs chamado. Retornando pares de exemplo.");
        return { data: ["BTC_USDT", "ETH_USDT"] };
    }
}

module.exports = GateConnectorWS;

