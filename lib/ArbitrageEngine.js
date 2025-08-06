// /lib/ArbitrageEngine.js
class ArbitrageEngine {
    constructor(globalConfig, signaler, logger) {
        this.config = globalConfig;
        this.signaler = signaler;
        this.logger = logger;
        this.minProfitPercentage = parseFloat(this.config.arbitrage?.min_profit_percentage ?? 0.0);
        
        this.marketState = {};

        const getDebugPairsForExchange = (exchangeName) => {
            const exchangeConfig = this.config[exchangeName] || {};
            const generalDebugPairs = this.config.general?.debug_pairs || "";
            return new Set((exchangeConfig.debug_pairs || generalDebugPairs).split(',').map(p => p.trim()).filter(p => p));
        };

        this.debugPairsMexc = getDebugPairsForExchange('mexc');
        this.debugPairsGateio = getDebugPairsForExchange('gateio');

        this.logger.info(`[ArbitrageEngine] Initialized. Min Global Profit: ${this.minProfitPercentage}%.`);
    }

    /**
     * Processa o estado de mercado mais recente. Agora é chamado diretamente pelo MarketMonitor
     * a cada nova atualização de ticker recebida via WebSocket.
     * @param {object} latestMarketStateFromMonitor - O objeto completo com os dados de mercado.
     */
    processMarketUpdate(latestMarketStateFromMonitor) {
        const now = Date.now();
        this.marketState = latestMarketStateFromMonitor;

        const futuresVsFuturesEnabled = !!this.config.arbitrage?.enable_futures_vs_futures;
        const spotVsSpotEnabled = !!this.config.arbitrage?.enable_spot_vs_spot;

        const allUniquePairs = new Set();
        if (this.marketState.mexc) Object.keys(this.marketState.mexc).forEach(pair => allUniquePairs.add(pair));
        if (this.marketState.gateio) Object.keys(this.marketState.gateio).forEach(pair => allUniquePairs.add(pair));

        allUniquePairs.forEach(pair => {
            const mexcData = this.marketState.mexc?.[pair];
            const gateioData = this.marketState.gateio?.[pair];

            const mexcSpotTicker = mexcData?.spot?.ticker;
            const mexcFuturesTicker = mexcData?.futures?.ticker;
            const mexcFuturesInfo = mexcData?.futures;
            const gateioSpotTicker = gateioData?.spot?.ticker;
            const gateioFuturesTicker = gateioData?.futures?.ticker;
            const gateioFuturesInfo = gateioData?.futures;

            const mexcSpotFee = parseFloat(this.config.mexc?.spot_maker_fee ?? 0);
            const mexcFuturesFee = parseFloat(this.config.mexc?.futures_maker_fee ?? 0.0001);
            const gateioSpotFee = parseFloat(this.config.gateio?.spot_maker_fee ?? 0.001);
            const gateioFuturesFee = parseFloat(this.config.gateio?.futures_maker_fee ?? 0.0002);

            // 1. Spot vs Futuros
            const combinations = [
                { B: { ex: "MEXC", inst: "SPOT", tick: mexcSpotTicker, fee: mexcSpotFee, vol: mexcData?.spot?.volume24hQuote }, S: { ex: "MEXC", inst: "FUTUROS", tick: mexcFuturesTicker, info: mexcFuturesInfo, fee: mexcFuturesFee } },
                { B: { ex: "GateIO", inst: "SPOT", tick: gateioSpotTicker, fee: gateioSpotFee, vol: gateioData?.spot?.volume24hQuote }, S: { ex: "GateIO", inst: "FUTUROS", tick: gateioFuturesTicker, info: gateioFuturesInfo, fee: gateioFuturesFee } },
                { B: { ex: "GateIO", inst: "SPOT", tick: gateioSpotTicker, fee: gateioSpotFee, vol: gateioData?.spot?.volume24hQuote }, S: { ex: "MEXC", inst: "FUTUROS", tick: mexcFuturesTicker, info: mexcFuturesInfo, fee: mexcFuturesFee } },
                { B: { ex: "MEXC", inst: "SPOT", tick: mexcSpotTicker, fee: mexcSpotFee, vol: mexcData?.spot?.volume24hQuote }, S: { ex: "GateIO", inst: "FUTUROS", tick: gateioFuturesTicker, info: gateioFuturesInfo, fee: gateioFuturesFee } }
            ];

            combinations.forEach(c => {
                if (c.B.tick?.askPrice > 0 && c.S.tick?.bidPrice > 0) {
                    const grossSpread = (c.S.tick.bidPrice / c.B.tick.askPrice) - 1;
                    const netSpread = grossSpread - c.B.fee - c.S.fee;
                    this.signalOpportunity({
                        pair, now, type: c.B.ex === c.S.ex ? "INTRA_EXCHANGE" : "INTER_EXCHANGE",
                        direction: `Comprar ${c.B.ex}_${c.B.inst} / Vender ${c.S.ex}_${c.S.inst}`,
                        buyExchange: c.B.ex, buyInstrument: c.B.inst, buyPrice: c.B.tick.askPrice, buyFee: c.B.fee,
                        sellExchange: c.S.ex, sellInstrument: c.S.inst, sellPrice: c.S.tick.bidPrice, sellFee: c.S.fee,
                        grossSpreadPercentage: grossSpread * 100, netSpreadPercentage: netSpread * 100,
                        spotVolume24hUSD: c.B.vol, futuresVolume24hUSD: c.S.info?.volume24hQuote, fundingRate: c.S.info?.fundingRate
                    });
                }
            });

            // 2. Futuros vs Futuros
            if (futuresVsFuturesEnabled) {
                const futCombinations = [
                    { B: { ex: "MEXC", tick: mexcFuturesTicker, info: mexcFuturesInfo, fee: mexcFuturesFee }, S: { ex: "GateIO", tick: gateioFuturesTicker, info: gateioFuturesInfo, fee: gateioFuturesFee } },
                    { B: { ex: "GateIO", tick: gateioFuturesTicker, info: gateioFuturesInfo, fee: gateioFuturesFee }, S: { ex: "MEXC", tick: mexcFuturesTicker, info: mexcFuturesInfo, fee: mexcFuturesFee } }
                ];
                futCombinations.forEach(c => {
                    if (c.B.tick?.askPrice > 0 && c.S.tick?.bidPrice > 0) {
                        const grossSpread = (c.S.tick.bidPrice / c.B.tick.askPrice) - 1;
                        const netSpread = grossSpread - c.B.fee - c.S.fee;
                        this.signalOpportunity({
                            pair, now, type: "INTER_EXCHANGE_FUT_FUT",
                            direction: `Comprar ${c.B.ex}_FUTUROS / Vender ${c.S.ex}_FUTUROS`,
                            buyExchange: c.B.ex, buyInstrument: "FUTUROS", buyPrice: c.B.tick.askPrice, buyFee: c.B.fee,
                            sellExchange: c.S.ex, sellInstrument: "FUTUROS", sellPrice: c.S.tick.bidPrice, sellFee: c.S.fee,
                            grossSpreadPercentage: grossSpread * 100, netSpreadPercentage: netSpread * 100,
                            futuresVolume24hUSD_buyLeg: c.B.info?.volume24hQuote,
                            futuresVolume24hUSD_sellLeg: c.S.info?.volume24hQuote,
                            fundingRate_buyLeg: c.B.info?.fundingRate,
                            fundingRate_sellLeg: c.S.info?.fundingRate
                        });
                    }
                });
            }

            // 3. Spot vs Spot
            if (spotVsSpotEnabled) {
                const spotCombinations = [
                    { B: { ex: "MEXC", tick: mexcSpotTicker, fee: mexcSpotFee, vol: mexcData?.spot?.volume24hQuote }, S: { ex: "GateIO", tick: gateioSpotTicker, fee: gateioSpotFee, vol: gateioData?.spot?.volume24hQuote } },
                    { B: { ex: "GateIO", tick: gateioSpotTicker, fee: gateioSpotFee, vol: gateioData?.spot?.volume24hQuote }, S: { ex: "MEXC", tick: mexcSpotTicker, fee: mexcSpotFee, vol: mexcData?.spot?.volume24hQuote } }
                ];

                spotCombinations.forEach(c => {
                    if (c.B.tick?.askPrice > 0 && c.S.tick?.bidPrice > 0) {
                        const grossSpread = (c.S.tick.bidPrice / c.B.tick.askPrice) - 1;
                        const netSpread = grossSpread - c.B.fee - c.S.fee;
                        this.signalOpportunity({
                            pair, now, type: "INTER_EXCHANGE_SPOT_SPOT",
                            direction: `Comprar ${c.B.ex}_SPOT / Vender ${c.S.ex}_SPOT`,
                            buyExchange: c.B.ex, buyInstrument: "SPOT", buyPrice: c.B.tick.askPrice, buyFee: c.B.fee,
                            sellExchange: c.S.ex, sellInstrument: "SPOT", sellPrice: c.S.tick.bidPrice, sellFee: c.S.fee,
                            grossSpreadPercentage: grossSpread * 100, netSpreadPercentage: netSpread * 100,
                            spotVolume24hUSD_buyLeg: c.B.vol,
                            spotVolume24hUSD_sellLeg: c.S.vol,
                        });
                    }
                });
            }
        });
    }

    signalOpportunity(details) {
        if (details.netSpreadPercentage < -15) {
            return;
        }

        const isSpotToFutures = details.buyInstrument?.toUpperCase() === "SPOT" && details.sellInstrument?.toUpperCase() === "FUTUROS";
        const isFuturesToFutures = details.buyInstrument?.toUpperCase() === "FUTUROS" && details.sellInstrument?.toUpperCase() === "FUTUROS";
        const isSpotToSpot = details.buyInstrument?.toUpperCase() === "SPOT" && details.sellInstrument?.toUpperCase() === "SPOT";

        const opportunity = {
            pair: details.pair, type: details.type, direction: details.direction,
            buyExchange: details.buyExchange, buyInstrument: details.buyInstrument, buyPrice: details.buyPrice, buyFee: details.buyFee,
            sellExchange: details.sellExchange, sellInstrument: details.sellInstrument, sellPrice: details.sellPrice, sellFee: details.sellFee,
            grossSpreadPercentage: details.grossSpreadPercentage, netSpreadPercentage: details.netSpreadPercentage,
            timestamp: details.now,
        };

        if (isSpotToFutures) {
            opportunity.spotVolume24hUSD = details.spotVolume24hUSD;
            opportunity.futuresVolume24hUSD = details.futuresVolume24hUSD;
            opportunity.fundingRate = details.fundingRate;
        } else if (isFuturesToFutures) {
            opportunity.futuresVolume24hUSD_buyLeg = details.futuresVolume24hUSD_buyLeg;
            opportunity.futuresVolume24hUSD_sellLeg = details.futuresVolume24hUSD_sellLeg;
            opportunity.fundingRate_buyLeg = details.fundingRate_buyLeg;
            opportunity.fundingRate_sellLeg = details.fundingRate_sellLeg;
            const volBuy = typeof details.futuresVolume24hUSD_buyLeg === 'number' ? details.futuresVolume24hUSD_buyLeg : Infinity;
            const volSell = typeof details.futuresVolume24hUSD_sellLeg === 'number' ? details.futuresVolume24hUSD_sellLeg : Infinity;
            opportunity.futuresVolume24hUSD = (volBuy === Infinity && volSell === Infinity) ? null : Math.min(volBuy, volSell);
            opportunity.fundingRate = details.fundingRate_sellLeg;
            opportunity.spotVolume24hUSD = null;
        } else if (isSpotToSpot) {
            opportunity.spotVolume24hUSD_buyLeg = details.spotVolume24hUSD_buyLeg;
            opportunity.spotVolume24hUSD_sellLeg = details.spotVolume24hUSD_sellLeg;
            const volBuy = typeof details.spotVolume24hUSD_buyLeg === 'number' ? details.spotVolume24hUSD_buyLeg : Infinity;
            const volSell = typeof details.spotVolume24hUSD_sellLeg === 'number' ? details.spotVolume24hUSD_sellLeg : Infinity;
            opportunity.spotVolume24hUSD = (volBuy === Infinity && volSell === Infinity) ? null : Math.min(volBuy, volSell);
            opportunity.fundingRate = null;
            opportunity.futuresVolume24hUSD = null;
        }
        
        this.logger.debug(`[ArbitrageEngine_Signal] Signaling opportunity for ${opportunity.pair} with Net%: ${opportunity.netSpreadPercentage.toFixed(4)}%`);
        this.signaler.signal(opportunity);
    }
}
module.exports = ArbitrageEngine;
