// arbitral_bot/arbitral_bot/lib/GateConnectorWS.js
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

    initSpotWebSocket() {
        return new Promise((resolve) => {
            const url = "wss://api.gateio.ws/ws/v4/";
            this.logger.info(`[GATE SPOT WS] 🔌 conectando: ${url}`);
            this.wsSpot = new WebSocket(url);

            let hb;
            let alive = false;
            let backoff = 1000;

            const send = (obj) => this.wsSpot?.readyState === WebSocket.OPEN && this.wsSpot.send(JSON.stringify(obj));
            const sub = (channel, payload) => send({ time: Date.now(), channel, event: "subscribe", payload });

            const heartbeat = () => {
                clearInterval(hb);
                hb = setInterval(() => {
                    if (!alive) { try { this.wsSpot.terminate(); } catch (e) { this.logger.error("[GATE SPOT WS] Erro ao terminar WS inativo:", e.message); } return; }
                    alive = false; send({ time: Date.now(), channel: "ping" });
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
                try {
                    const messageString = raw instanceof Buffer ? raw.toString("utf8") : raw.toString();
                    this.logger.debug("[GATE SPOT WS] Raw message received:", messageString);
                    const m = JSON.parse(messageString);
                    if (m.event === "subscribe") { this.logger.info("[GATE SPOT WS] sub OK:", m.channel); return; }
                    if (m.event === "error" || m.error) { this.logger.warn("[GATE SPOT WS] erro canal", m.channel + ":", JSON.stringify(m)); return; }
                    if (m.channel === "pong") { alive = true; return; }
                    const r = m.result; if (!r) return;

                    switch (m.channel) {
                        case "spot.book_ticker":
                            this.updateMarketData("spot", "bookTicker", {
                                symbol: r?.s || r?.currency_pair,
                                bid: num(r?.b),
                                ask: num(r?.a),
                                ts: r?.t || m.time
                            });
                            if (this.callbacks.onSpotBookTicker) this.callbacks.onSpotBookTicker(this.marketData.spot.bookTicker);
                            break;
                        case "spot.tickers":
                            const arrTickers = Array.isArray(r) ? r : [r];
                            for (const it of arrTickers) {
                                this.updateMarketData("spot", "ticker", {
                                    symbol: it?.currency_pair || it?.s,
                                    last: num(it?.last ?? it?.close ?? it?.close_price),
                                    ts: m.time
                                });
                                if (this.callbacks.onSpotTicker) this.callbacks.onSpotTicker(this.marketData.spot.ticker);
                            }
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
                            this.updateMarketData("spot", "depth", {
                                symbol: r?.s || r?.currency_pair,
                                bids: normalizeLevels(r?.b),
                                asks: normalizeLevels(r?.a),
                                ts: r?.t || m.time
                            });
                            if (this.callbacks.onSpotDepth) this.callbacks.onSpotDepth(this.marketData.spot.depth);
                            break;
                        default: break;
                    }
                } catch (e) {
                    this.logger.error("[GATE SPOT WS] Erro ao processar mensagem:", e.stack, "Raw data:", messageString);
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
            const sub = (channel, payload) => send({ time: Date.now(), channel, event: "subscribe", payload });

            const heartbeat = () => {
                clearInterval(hb);
                hb = setInterval(() => {
                    if (!alive) { try { this.wsFutures.terminate(); } catch (e) { this.logger.error("[GATE FUTURES WS] Erro ao terminar WS inativo:", e.message); } return; }
                    alive = false; send({ time: Date.now(), channel: "ping" });
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
                try {
                    const messageString = raw instanceof Buffer ? raw.toString("utf8") : raw.toString();
                    this.logger.debug("[GATE FUTURES WS] Raw message received:", messageString);
                    const m = JSON.parse(messageString);
                    if (m.event === "subscribe") { this.logger.info("[GATE FUTURES WS] sub OK:", m.channel); return; }
                    if (m.event === "error" || m.error) { this.logger.warn("[GATE FUTURES WS] erro canal", m.channel + ":", JSON.stringify(m)); return; }
                    if (m.channel === "pong") { alive = true; return; }
                    const r = m.result; if (!r) return;

                    const ch = m.channel;
                    if (ch === "futures.book_ticker") {
                        this.updateMarketData("futures", "bookTicker", {
                            symbol: r?.contract || r?.s,
                            bid: num(r?.bid),
                            ask: num(r?.ask),
                            ts: r?.t || m.time
                        });
                        if (this.callbacks.onFuturesBookTicker) this.callbacks.onFuturesBookTicker(this.marketData.futures.bookTicker);
                    } else if (ch === "futures.tickers") {
                        const arrTickers = Array.isArray(r) ? r : [r];
                        for (const it of arrTickers) {
                            this.updateMarketData("futures", "ticker", {
                                symbol: it?.contract || it?.s,
                                last: num(it?.last ?? it?.close),
                                fundingRate: num(it?.funding_rate) ?? 0,
                                ts: m.time
                            });
                            if (this.callbacks.onFuturesTicker) this.callbacks.onFuturesTicker(this.marketData.futures.ticker);
                        }
                    } else if (ch === "futures.trades") {
                        const arrTrades = Array.isArray(r) ? r : [r];
                        for (const t of arrTrades) {
                            this.updateMarketData("futures", "trade", {
                                symbol: t?.contract || t?.s,
                                price: num(t?.price),
                                amount: num(t?.size ?? t?.amount),
                                side: t?.side,
                                ts: Number(t?.create_time_ms) || Number(t?.create_time) * 1000 || m.time
                            });
                            if (this.callbacks.onFuturesTrade) this.callbacks.onFuturesTrade(this.marketData.futures.trade);
                        }
                    } else if (ch === "futures.order_book_update") {
                        const item = Array.isArray(r) ? r[0] : r;
                        if (!item) return;
                        this.updateMarketData("futures", "depth", {
                            symbol: item?.contract || item?.symbol || item?.s,
                            bids: normalizeLevels(item?.b || item?.bids),
                            asks: normalizeLevels(item?.a || item?.asks),
                            ts: item?.t || m.time
                        });
                        if (this.callbacks.onFuturesDepth) this.callbacks.onFuturesDepth(this.marketData.futures.depth);
                    }
                } catch (e) {
                    this.logger.error("[GATE FUTURES WS] Erro ao processar mensagem:", e.stack, "Raw data:", messageString);
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
        this.wsSpot.send(JSON.stringify({ time: Date.now(), channel: "spot.book_ticker", event: "subscribe", payload }));
        this.wsSpot.send(JSON.stringify({ time: Date.now(), channel: "spot.tickers", event: "subscribe", payload }));
        this.wsSpot.send(JSON.stringify({ time: Date.now(), channel: "spot.trades", event: "subscribe", payload }));
        this.wsSpot.send(JSON.stringify({ time: Date.now(), channel: "spot.order_book_update", event: "subscribe", payload: [symbol.replace("/", "_"), "100ms"] }));
        this.subscribedPairs.add(`spot_${symbol}`);
        this.logger.info(`[GATE SPOT WS] Subscrito ao par: ${symbol}`);
    }

    subscribeFuturesPair(symbol) {
        if (!this.isConnected.futures) {
            this.logger.warn("[GATE FUTURES WS] Não conectado, não é possível subscrever");
            return;
        }
        const payload = [symbol.replace("/", "_")];
        this.wsFutures.send(JSON.stringify({ time: Date.now(), channel: "futures.book_ticker", event: "subscribe", payload }));
        this.wsFutures.send(JSON.stringify({ time: Date.now(), channel: "futures.tickers", event: "subscribe", payload }));
        this.wsFutures.send(JSON.stringify({ time: Date.now(), channel: "futures.trades", event: "subscribe", payload }));
        this.wsFutures.send(JSON.stringify({ time: Date.now(), channel: "futures.order_book_update", event: "subscribe", payload: [symbol.replace("/", "_"), "100ms"] }));
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
        this.logger.info("[GATE WS] Retornando contratos de exemplo para WebSocket.");
        return { 
            success: true, 
            data: [
                { symbol: "BTC_USDT", quoteCoin: "USDT", settleCoin: "USDT", type: "direct", in_delisting: false }, 
                { symbol: "ETH_USDT", quoteCoin: "USDT", settleCoin: "USDT", type: "direct", in_delisting: false }
            ] 
        };
    }

    async getSpotPairs() {
        this.logger.info("[GATE WS] Retornando pares spot de exemplo para WebSocket.");
        return { 
            success: true, 
            data: ["BTC_USDT", "ETH_USDT"] 
        };
    }

    // Métodos REST ainda necessários para operações que não são via WS
    async getAllSpotBookTickers() {
        this.logger.warn("[GATE WS] getAllSpotBookTickers ainda usa REST. Considere implementar via WS se necessário.");
        return new Map();
    }

    async getAllSpot24hrStats() {
        this.logger.warn("[GATE WS] getAllSpot24hrStats ainda usa REST. Considere implementar via WS se necessário.");
        return new Map();
    }

    async getAllFuturesBookTickers() {
        this.logger.warn("[GATE WS] getAllFuturesBookTickers ainda usa REST. Considere implementar via WS se necessário.");
        return new Map();
    }

    async getBalance(currency) {
        this.logger.warn("[GATE WS] getBalance ainda usa REST. Implementar WS se necessário.");
        return { success: false, message: "Não implementado via WS" };
    }

    async placeOrder(symbol, side, type, quantity, price) {
        this.logger.warn("[GATE WS] placeOrder ainda usa REST. Implementar WS se necessário.");
        return { success: false, message: "Não implementado via WS" };
    }

    async cancelOrder(symbol, orderId) {
        this.logger.warn("[GATE WS] cancelOrder ainda usa REST. Implementar WS se necessário.");
        return { success: false, message: "Não implementado via WS" };
    }

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
        this.logger.info("[GATE WS] Fechando conexões WebSocket...");
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
        this.logger.info("[GATE WS] Conexões WebSocket fechadas.");
    }
}

module.exports = GateConnectorWS;

