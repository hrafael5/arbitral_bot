// /lib/ArbitrageEngine.js

class ArbitrageEngine {
    constructor(globalConfig, signaler, logger) {
        this.config = globalConfig;
        this.signaler = signaler;
        this.logger = logger;
        this.minProfitPercentage = parseFloat(this.config.arbitrage?.min_profit_percentage ?? 0.0);
        
        this.marketState = {};
        this.checkInterval = 500; // Intervalo em ms para evitar processamento excessivo
        this.lastGlobalCheckTimestamp = 0;

        this.logger.info(`[ArbitrageEngine] Initialized.`);
    }

    processMarketUpdate(latestMarketStateFromMonitor) {
        const now = Date.now();
        if (now - this.lastGlobalCheckTimestamp < this.checkInterval) {
            return; // Pula o processamento se o último ciclo foi muito recente
        }
        this.lastGlobalCheckTimestamp = now;
        this.marketState = latestMarketStateFromMonitor;

        // --- CORREÇÃO PRINCIPAL ---
        // As variáveis que controlam as estratégias são lidas AQUI, dentro do ciclo.
        // Isso garante que o motor sempre use o estado mais atual da configuração,
        // que é alterada pela API quando você clica nos checkboxes do frontend.
        const futuresVsFuturesEnabled = !!this.config.arbitrage?.enable_futures_vs_futures;
        const spotVsSpotEnabled = !!this.config.arbitrage?.enable_spot_vs_spot;
        // --- FIM DA CORREÇÃO ---

        const allUniquePairs = new Set(Object.keys(this.marketState.mexc || {}).concat(Object.keys(this.marketState.gateio || {})));

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

            // --- ESTRATÉGIA 1: Spot vs Futuros (Padrão) ---
            const combinations = [
                { B: { ex: "MEXC", inst: "SPOT", tick: mexcSpotTicker, fee: mexcSpotFee, vol: mexcData?.spot?.volume24hQuote }, S: { ex: "MEXC", inst: "FUTUROS", tick: mexcFuturesTicker, info: mexcFuturesInfo, fee: mexcFuturesFee } },
                { B: { ex: "GateIO", inst: "SPOT", tick: gateioSpotTicker, fee: gateioSpotFee, vol: gateioData?.spot?.volume24hQuote }, S: { ex: "GateIO", inst: "FUTUROS", tick: gateioFuturesTicker, info: gateioFuturesInfo, fee: gateioFuturesFee } },
                { B: { ex: "GateIO", inst: "SPOT", tick: gateioSpotTicker, fee: gateioSpotFee, vol: gateioData?.spot?.volume24hQuote }, S: { ex: "MEXC", inst: "FUTUROS", tick: mexcFuturesTicker, info: mexcFuturesInfo, fee: mexcFuturesFee } },
                { B: { ex: "MEXC", inst: "SPOT", tick: mexcSpotTicker, fee: mexcSpotFee, vol: mexcData?.spot?.volume24hQuote }, S: { ex: "GateIO", inst: "FUTUROS", tick: gateioFuturesTicker, info: gateioFuturesInfo, fee: gateioFuturesFee } }
            ];

            combinations.forEach(c => {
                if (c.B.tick?.askPrice > 0 && c.S.tick?.bidPrice > 0) {
                    this.evaluateAndSignal(pair, now, c, "SPOT_VS_FUTURES");
                }
            });

            // --- ESTRATÉGIA 2: Futuros vs Futuros ---
            if (futuresVsFuturesEnabled) {
                const futCombinations = [
                    { B: { ex: "MEXC", inst: "FUTUROS", tick: mexcFuturesTicker, info: mexcFuturesInfo, fee: mexcFuturesFee }, S: { ex: "GateIO", inst: "FUTUROS", tick: gateioFuturesTicker, info: gateioFuturesInfo, fee: gateioFuturesFee } },
                    { B: { ex: "GateIO", inst: "FUTUROS", tick: gateioFuturesTicker, info: gateioFuturesInfo, fee: gateioFuturesFee }, S: { ex: "MEXC", inst: "FUTUROS", tick: mexcFuturesTicker, info: mexcFuturesInfo, fee: mexcFuturesFee } }
                ];
                futCombinations.forEach(c => {
                    if (c.B.tick?.askPrice > 0 && c.S.tick?.bidPrice > 0) {
                        this.evaluateAndSignal(pair, now, c, "FUTURES_VS_FUTURES");
                    }
                });
            }

            // --- ESTRATÉGIA 3: Spot vs Spot ---
            if (spotVsSpotEnabled) {
                const spotCombinations = [
                    { B: { ex: "MEXC", inst: "SPOT", tick: mexcSpotTicker, fee: mexcSpotFee, vol: mexcData?.spot?.volume24hQuote }, S: { ex: "GateIO", inst: "SPOT", tick: gateioSpotTicker, fee: gateioSpotFee, vol: gateioData?.spot?.volume24hQuote } },
                    { B: { ex: "GateIO", inst: "SPOT", tick: gateioSpotTicker, fee: gateioSpotFee, vol: gateioData?.spot?.volume24hQuote }, S: { ex: "MEXC", inst: "SPOT", tick: mexcSpotTicker, fee: mexcSpotFee, vol: mexcData?.spot?.volume24hQuote } }
                ];
                spotCombinations.forEach(c => {
                    if (c.B.tick?.askPrice > 0 && c.S.tick?.bidPrice > 0) {
                        this.evaluateAndSignal(pair, now, c, "SPOT_VS_SPOT");
                    }
                });
            }
        });
    }

    evaluateAndSignal(pair, now, combination, strategyType) {
        const { B, S } = combination;
        const grossSpread = (S.tick.bidPrice / B.tick.askPrice) - 1;
        const netSpread = grossSpread - B.fee - S.fee;

        // Filtro para não enviar oportunidades com perdas absurdas (geralmente erro de API)
        if (netSpread < -0.15) { // -15%
            return;
        }

        const opportunity = {
            pair: pair,
            direction: `Comprar ${B.ex}_${B.inst} / Vender ${S.ex}_${S.inst}`,
            buyExchange: B.ex,
            buyInstrument: B.inst,
            buyPrice: B.tick.askPrice,
            buyFee: B.fee,
            sellExchange: S.ex,
            sellInstrument: S.inst,
            sellPrice: S.tick.bidPrice,
            sellFee: S.fee,
            grossSpreadPercentage: grossSpread * 100,
            netSpreadPercentage: netSpread * 100,
            timestamp: now,
        };

        // Adiciona dados específicos de cada estratégia
        switch (strategyType) {
            case "SPOT_VS_FUTURES":
                opportunity.type = B.ex === S.ex ? "INTRA_EXCHANGE" : "INTER_EXCHANGE";
                opportunity.spotVolume24hUSD = B.vol;
                opportunity.futuresVolume24hUSD = S.info?.volume24hQuote;
                opportunity.fundingRate = S.info?.fundingRate;
                break;
            case "FUTURES_VS_FUTURES":
                opportunity.type = "INTER_EXCHANGE_FUT_FUT";
                opportunity.futuresVolume24hUSD_buyLeg = B.info?.volume24hQuote;
                opportunity.futuresVolume24hUSD_sellLeg = S.info?.volume24hQuote;
                opportunity.fundingRate_buyLeg = B.info?.fundingRate;
                opportunity.fundingRate_sellLeg = S.info?.fundingRate;
                break;
            case "SPOT_VS_SPOT":
                opportunity.type = "INTER_EXCHANGE_SPOT_SPOT";
                opportunity.spotVolume24hUSD_buyLeg = B.vol;
                opportunity.spotVolume24hUSD_sellLeg = S.vol;
                break;
        }
        
        this.signaler.signal(opportunity);
    }
}

module.exports = ArbitrageEngine;
