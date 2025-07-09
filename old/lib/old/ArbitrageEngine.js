// /home/ubuntu/mexc_bot/lib/ArbitrageEngine.js
class ArbitrageEngine {
    constructor(globalConfig, signaler, logger) {
        this.config = globalConfig; // globalConfig é o objeto 'config' do server.js
        this.signaler = signaler;
        this.logger = logger;
        this.minProfitPercentage = parseFloat(this.config.arbitrage?.min_profit_percentage) || 0.1;
        
        this.marketState = {};
        this.checkInterval = 500; 
        this.lastGlobalCheckTimestamp = 0;

        const getDebugPairsForExchange = (exchangeName) => {
            const exchangeConfig = this.config[exchangeName] || {};
            const generalDebugPairs = this.config.general?.debug_pairs || "";
            return new Set((exchangeConfig.debug_pairs || generalDebugPairs).split(',').map(p => p.trim()).filter(p => p));
        };

        this.debugPairsMexc = getDebugPairsForExchange('mexc');
        this.debugPairsGateio = getDebugPairsForExchange('gateio');

        this.logger.info(`[ArbitrageEngine] Initialized. Min Global Profit: ${this.minProfitPercentage}%.`);
        // Log inicial do estado da estratégia Fut-Fut
        if (this.config.arbitrage?.enable_futures_vs_futures) {
            this.logger.info(`[ArbitrageEngine] Futures vs Futures strategy is INITIALLY ENABLED (from conf.ini).`);
        } else {
            this.logger.info(`[ArbitrageEngine] Futures vs Futures strategy is INITIALLY DISABLED (from conf.ini).`);
        }
        if (this.debugPairsMexc.size > 0) this.logger.info(`[ArbitrageEngine] MEXC Debugging enabled for pairs: ${Array.from(this.debugPairsMexc).join(', ')}`);
        if (this.debugPairsGateio.size > 0) this.logger.info(`[ArbitrageEngine] Gate.io Debugging enabled for pairs: ${Array.from(this.debugPairsGateio).join(', ')}`);
    }

    processMarketUpdate(latestMarketStateFromMonitor) {
        const now = Date.now();
        if (now - this.lastGlobalCheckTimestamp < this.checkInterval) {
            return;
        }
        this.lastGlobalCheckTimestamp = now;
        this.marketState = latestMarketStateFromMonitor;

        // Lê o estado ATUAL da estratégia Fut-Fut diretamente do objeto config compartilhado
        const futuresVsFuturesEnabled = !!this.config.arbitrage?.enable_futures_vs_futures;

        const mexcDataAvailable = this.marketState.mexc && Object.keys(this.marketState.mexc).some(p => this.marketState.mexc[p]?.spot?.ticker || this.marketState.mexc[p]?.futures?.ticker);
        const gateioDataAvailable = this.marketState.gateio && Object.keys(this.marketState.gateio).some(p => this.marketState.gateio[p]?.spot?.ticker || this.marketState.gateio[p]?.futures?.ticker);

        if (this.config.general?.log_level === 'debug') { // Verifique o log level antes de logar
             this.logger.debug(`[ArbitrageEngine_DEBUG_Loop] processMarketUpdate. MEXC data: ${!!mexcDataAvailable}, Gate.io data: ${!!gateioDataAvailable}. FutVsFut Enabled: ${futuresVsFuturesEnabled}`);
        }

        const allUniquePairs = new Set();
        if (this.marketState.mexc) Object.keys(this.marketState.mexc).forEach(pair => allUniquePairs.add(pair));
        if (this.marketState.gateio) Object.keys(this.marketState.gateio).forEach(pair => allUniquePairs.add(pair));

        allUniquePairs.forEach(pair => {
            const mexcData = this.marketState.mexc?.[pair];
            const gateioData = this.marketState.gateio?.[pair];

            const isDebugMexc = this.debugPairsMexc.has(pair);
            const isDebugGateio = this.debugPairsGateio.has(pair);

            const mexcSpotTicker = mexcData?.spot?.ticker;
            const mexcFuturesTicker = mexcData?.futures?.ticker;
            const mexcFuturesInfo = mexcData?.futures;
            const gateioSpotTicker = gateioData?.spot?.ticker;
            const gateioFuturesTicker = gateioData?.futures?.ticker;
            const gateioFuturesInfo = gateioData?.futures;

            if (isDebugMexc && mexcData && (this.config.general?.log_level === 'debug')) {
                 this.logger.debug(`[ArbitrageEngine_DEBUG_MEXC][${pair}] MEXC Spot Ask: ${mexcSpotTicker?.askPrice}, Bid: ${mexcSpotTicker?.bidPrice}; MEXC Fut Ask: ${mexcFuturesTicker?.askPrice}, Bid: ${mexcFuturesTicker?.bidPrice}`);
            }
            if (isDebugGateio && gateioData && (this.config.general?.log_level === 'debug')) {
                 this.logger.debug(`[ArbitrageEngine_DEBUG_GATEIO][${pair}] GateIO Spot Ask: ${gateioSpotTicker?.askPrice}, Bid: ${gateioSpotTicker?.bidPrice}; GateIO Fut Ask: ${gateioFuturesTicker?.askPrice}, Bid: ${gateioFuturesTicker?.bidPrice}`);
            }

            const mexcSpotFee = parseFloat(this.config.mexc?.spot_maker_fee ?? 0);
            const mexcFuturesFee = parseFloat(this.config.mexc?.futures_maker_fee ?? 0.0001);
            const gateioSpotFee = parseFloat(this.config.gateio?.spot_maker_fee ?? 0.001);
            const gateioFuturesFee = parseFloat(this.config.gateio?.futures_maker_fee ?? 0.0002);

            // --- Arbitragem: Comprar SPOT / Vender FUTUROS (EXISTENTE) ---
            if (mexcSpotTicker?.askPrice > 0 && mexcFuturesTicker?.bidPrice > 0) {
                const grossSpread = (mexcFuturesTicker.bidPrice / mexcSpotTicker.askPrice) - 1;
                const netSpread = grossSpread - mexcSpotFee - mexcFuturesFee;
                if ((netSpread * 100) >= this.minProfitPercentage) {
                    this.signalOpportunity({
                        pair, now, type: "INTRA_EXCHANGE", direction: "Comprar MEXC_SPOT / Vender MEXC_FUTUROS",
                        buyExchange: "MEXC", buyInstrument: "SPOT", buyPrice: mexcSpotTicker.askPrice, buyFee: mexcSpotFee,
                        sellExchange: "MEXC", sellInstrument: "FUTUROS", sellPrice: mexcFuturesTicker.bidPrice, sellFee: mexcFuturesFee,
                        grossSpreadPercentage: grossSpread * 100, netSpreadPercentage: netSpread * 100,
                        spotVolume24hUSD: mexcData?.spot?.volume24hQuote, futuresVolume24hUSD: mexcFuturesInfo?.volume24hQuote, fundingRate: mexcFuturesInfo?.fundingRate
                    });
                }
            }
            if (gateioSpotTicker?.askPrice > 0 && gateioFuturesTicker?.bidPrice > 0) {
                const grossSpread = (gateioFuturesTicker.bidPrice / gateioSpotTicker.askPrice) - 1;
                const netSpread = grossSpread - gateioSpotFee - gateioFuturesFee;
                if ((netSpread * 100) >= this.minProfitPercentage) {
                     this.signalOpportunity({
                        pair, now, type: "INTRA_EXCHANGE", direction: "Comprar GATEIO_SPOT / Vender GATEIO_FUTUROS",
                        buyExchange: "GateIO", buyInstrument: "SPOT", buyPrice: gateioSpotTicker.askPrice, buyFee: gateioSpotFee,
                        sellExchange: "GateIO", sellInstrument: "FUTUROS", sellPrice: gateioFuturesTicker.bidPrice, sellFee: gateioFuturesFee,
                        grossSpreadPercentage: grossSpread * 100, netSpreadPercentage: netSpread * 100,
                        spotVolume24hUSD: gateioData?.spot?.volume24hQuote, futuresVolume24hUSD: gateioFuturesInfo?.volume24hQuote, fundingRate: gateioFuturesInfo?.fundingRate
                    });
                }
            }
            if (gateioSpotTicker?.askPrice > 0 && mexcFuturesTicker?.bidPrice > 0) {
                const grossSpread = (mexcFuturesTicker.bidPrice / gateioSpotTicker.askPrice) - 1;
                const netSpread = grossSpread - gateioSpotFee - mexcFuturesFee;
                if ((netSpread * 100) >= this.minProfitPercentage) {
                     this.signalOpportunity({
                        pair, now, type: "INTER_EXCHANGE", direction: "Comprar GATEIO_SPOT / Vender MEXC_FUTUROS",
                        buyExchange: "GateIO", buyInstrument: "SPOT", buyPrice: gateioSpotTicker.askPrice, buyFee: gateioSpotFee,
                        sellExchange: "MEXC", sellInstrument: "FUTUROS", sellPrice: mexcFuturesTicker.bidPrice, sellFee: mexcFuturesFee,
                        grossSpreadPercentage: grossSpread * 100, netSpreadPercentage: netSpread * 100,
                        spotVolume24hUSD: gateioData?.spot?.volume24hQuote, 
                        futuresVolume24hUSD: mexcFuturesInfo?.volume24hQuote, 
                        fundingRate: mexcFuturesInfo?.fundingRate 
                    });
                }
            }
            if (mexcSpotTicker?.askPrice > 0 && gateioFuturesTicker?.bidPrice > 0) {
                const grossSpread = (gateioFuturesTicker.bidPrice / mexcSpotTicker.askPrice) - 1;
                const netSpread = grossSpread - mexcSpotFee - gateioFuturesFee;
                if ((netSpread * 100) >= this.minProfitPercentage) {
                     this.signalOpportunity({
                        pair, now, type: "INTER_EXCHANGE", direction: "Comprar MEXC_SPOT / Vender GATEIO_FUTUROS",
                        buyExchange: "MEXC", buyInstrument: "SPOT", buyPrice: mexcSpotTicker.askPrice, buyFee: mexcSpotFee,
                        sellExchange: "GateIO", sellInstrument: "FUTUROS", sellPrice: gateioFuturesTicker.bidPrice, sellFee: gateioFuturesFee,
                        grossSpreadPercentage: grossSpread * 100, netSpreadPercentage: netSpread * 100,
                        spotVolume24hUSD: mexcData?.spot?.volume24hQuote, 
                        futuresVolume24hUSD: gateioFuturesInfo?.volume24hQuote, 
                        fundingRate: gateioFuturesInfo?.fundingRate
                    });
                }
            }

            // --- Arbitragem FUTUROS vs FUTUROS (Inter-Exchange) ---
            if (futuresVsFuturesEnabled) {
                // Oportunidade: Comprar MEXC FUTUROS / Vender GATEIO FUTUROS
                if (mexcFuturesTicker?.askPrice > 0 && gateioFuturesTicker?.bidPrice > 0) {
                    const grossSpread = (gateioFuturesTicker.bidPrice / mexcFuturesTicker.askPrice) - 1;
                    const netSpread = grossSpread - mexcFuturesFee - gateioFuturesFee; 
                    if ((netSpread * 100) >= this.minProfitPercentage) {
                        this.signalOpportunity({
                            pair, now, type: "INTER_EXCHANGE_FUT_FUT", 
                            direction: "Comprar MEXC_FUTUROS / Vender GATEIO_FUTUROS",
                            buyExchange: "MEXC", buyInstrument: "FUTUROS", buyPrice: mexcFuturesTicker.askPrice, buyFee: mexcFuturesFee,
                            sellExchange: "GateIO", sellInstrument: "FUTUROS", sellPrice: gateioFuturesTicker.bidPrice, sellFee: gateioFuturesFee,
                            grossSpreadPercentage: grossSpread * 100, netSpreadPercentage: netSpread * 100,
                            futuresVolume24hUSD_buyLeg: mexcFuturesInfo?.volume24hQuote,
                            futuresVolume24hUSD_sellLeg: gateioFuturesInfo?.volume24hQuote,
                            fundingRate_buyLeg: mexcFuturesInfo?.fundingRate,
                            fundingRate_sellLeg: gateioFuturesInfo?.fundingRate 
                        });
                    }
                }

                // Oportunidade: Comprar GATEIO FUTUROS / Vender MEXC FUTUROS
                if (gateioFuturesTicker?.askPrice > 0 && mexcFuturesTicker?.bidPrice > 0) {
                    const grossSpread = (mexcFuturesTicker.bidPrice / gateioFuturesTicker.askPrice) - 1;
                    const netSpread = grossSpread - gateioFuturesFee - mexcFuturesFee; 
                    if ((netSpread * 100) >= this.minProfitPercentage) {
                        this.signalOpportunity({
                            pair, now, type: "INTER_EXCHANGE_FUT_FUT",
                            direction: "Comprar GATEIO_FUTUROS / Vender MEXC_FUTUROS",
                            buyExchange: "GateIO", buyInstrument: "FUTUROS", buyPrice: gateioFuturesTicker.askPrice, buyFee: gateioFuturesFee,
                            sellExchange: "MEXC", sellInstrument: "FUTUROS", sellPrice: mexcFuturesTicker.bidPrice, sellFee: mexcFuturesFee,
                            grossSpreadPercentage: grossSpread * 100, netSpreadPercentage: netSpread * 100,
                            futuresVolume24hUSD_buyLeg: gateioFuturesInfo?.volume24hQuote, 
                            futuresVolume24hUSD_sellLeg: mexcFuturesInfo?.volume24hQuote,
                            fundingRate_buyLeg: gateioFuturesInfo?.fundingRate,
                            fundingRate_sellLeg: mexcFuturesInfo?.fundingRate
                        });
                    }
                }
            }
        });
    }

    signalOpportunity(details) {
        const isSpotToFutures = details.buyInstrument?.toUpperCase() === "SPOT" && details.sellInstrument?.toUpperCase() === "FUTUROS";
        const isFuturesToFutures = details.buyInstrument?.toUpperCase() === "FUTUROS" && details.sellInstrument?.toUpperCase() === "FUTUROS";
        
        // Lê o estado atual da flag diretamente do objeto config
        const futuresVsFuturesStrategyIsEnabled = !!this.config.arbitrage?.enable_futures_vs_futures;

        if (!isSpotToFutures && !(isFuturesToFutures && futuresVsFuturesStrategyIsEnabled)) {
            if (this.config.general?.log_level === 'debug') {
                this.logger.debug(`[ArbitrageEngine_SignalBlock] Opportunity for ${details.pair} (${details.direction}) blocked. Strategy Mismatch or Disabled. Buy: ${details.buyInstrument}, Sell: ${details.sellInstrument}. SpotToFut: ${isSpotToFutures}, FutToFut: ${isFuturesToFutures}, FutToFutEnabled: ${futuresVsFuturesStrategyIsEnabled}`);
            }
            return; 
        }

        const opportunity = {
            pair: details.pair, type: details.type, direction: details.direction,
            buyExchange: details.buyExchange, buyInstrument: details.buyInstrument, buyPrice: details.buyPrice, buyFee: details.buyFee,
            sellExchange: details.sellExchange, sellInstrument: details.sellInstrument, sellPrice: details.sellPrice, sellFee: details.sellFee,
            grossSpreadPercentage: details.grossSpreadPercentage, netSpreadPercentage: details.netSpreadPercentage,
            timestamp: details.now,
        };

        if (isSpotToFutures) {
            opportunity.spotVolume24hUSD = details.spotVolume24hUSD;
            opportunity.futuresVolume24hUSD = details.futuresVolume24hUSD; // Volume da perna de Futuros
            opportunity.fundingRate = details.fundingRate; // Funding da perna de Futuros
        } else if (isFuturesToFutures) {
            // Para Fut-Fut, o frontend pode precisar ser adaptado para mostrar os detalhes completos.
            // Por ora, enviamos os volumes de ambas as pernas e funding rates de ambas as pernas.
            opportunity.futuresVolume24hUSD_buyLeg = details.futuresVolume24hUSD_buyLeg;
            opportunity.futuresVolume24hUSD_sellLeg = details.futuresVolume24hUSD_sellLeg;
            opportunity.fundingRate_buyLeg = details.fundingRate_buyLeg;
            opportunity.fundingRate_sellLeg = details.fundingRate_sellLeg;

            // Para manter alguma compatibilidade com o frontend que espera um único `futuresVolume24hUSD` e `fundingRate`:
            // Usamos o MENOR dos dois volumes de futuros, pois a liquidez é limitada pelo menor.
            const volBuy = typeof details.futuresVolume24hUSD_buyLeg === 'number' ? details.futuresVolume24hUSD_buyLeg : Infinity;
            const volSell = typeof details.futuresVolume24hUSD_sellLeg === 'number' ? details.futuresVolume24hUSD_sellLeg : Infinity;
            opportunity.futuresVolume24hUSD = (volBuy === Infinity && volSell === Infinity) ? null : Math.min(volBuy, volSell);
            
            opportunity.fundingRate = details.fundingRate_sellLeg; // Prioriza funding da perna vendida (short)
            opportunity.spotVolume24hUSD = null; // Não há perna spot
        }

        const generalLogLevelIsDebug = (this.config.general?.log_level === 'debug');
        const isDebugForThisOpp =
            (details.buyExchange.toUpperCase() === 'MEXC' || details.sellExchange.toUpperCase() === 'MEXC')
                ? this.debugPairsMexc.has(details.pair)
                : (details.buyExchange.toUpperCase() === 'GATEIO' || details.sellExchange.toUpperCase() === 'GATEIO')
                    ? this.debugPairsGateio.has(details.pair)
                    : false;

        if ( (isDebugForThisOpp || generalLogLevelIsDebug) && (this.config.general?.log_level === 'debug') ) {
            if (opportunity.netSpreadPercentage >= (this.minProfitPercentage / 2) || isDebugForThisOpp) { // Loga se for debug do par ou se for um lucro considerável
                 this.logger.debug(`[ArbitrageEngine_SignalEval_Allowed] Pair: ${opportunity.pair}, Type: ${opportunity.type}, Dir: ${opportunity.direction}, BuyInst: ${opportunity.buyInstrument}, SellInst: ${opportunity.sellInstrument}, Net%: ${opportunity.netSpreadPercentage.toFixed(4)}`);
            }
        }
        this.logger.info(`[${opportunity.pair}][${opportunity.direction}] *** OPORTUNIDADE DETECTADA (${opportunity.type}) *** Net%: ${opportunity.netSpreadPercentage.toFixed(4)}% (Compra: ${opportunity.buyInstrument}, Venda: ${opportunity.sellInstrument})`);
        this.signaler.signal(opportunity);
    }
}
module.exports = ArbitrageEngine;