// /home/ubuntu/mexc_arbitrage_identifier_bot/lib/OpportunitySignaler.js
// ... (Conteúdo completo do OpportunitySignaler.js da minha resposta anterior)
const fs = require("fs");
const path = require("path");

class OpportunitySignaler {
    constructor(config, logger) {
        this.logger = logger;
        this.signalMethod = config.signal_method || "console";
        this.logFile = config.opportunity_log_file || "opportunities.log";
        this.lastSignalTimestamps = {};
        this.signalCooldown = parseInt(config.signal_cooldown_ms) || 5000;

        if (this.signalMethod === "file" || this.signalMethod === "both") {
            try {
                this.logStream = fs.createWriteStream(path.resolve(this.logFile), { flags: "a" });
                this.logger.info(`Signaling opportunities to file: ${this.logFile}`);
            } catch (error) {
                this.logger.error(`Failed to create write stream for opportunity log file ${this.logFile}: ${error.message}`);
                this.logStream = null; 
            }
        }
        this.logger.info(`Signaling method: ${this.signalMethod}. Cooldown: ${this.signalCooldown}ms`);
    }

    signal(opportunity) {
        const now = Date.now();
        const cooldownKey = `${opportunity.pair}-${opportunity.direction}`; 
        const lastSignal = this.lastSignalTimestamps[cooldownKey] || 0;

        if (now - lastSignal < this.signalCooldown) {
            return;
        }
        this.lastSignalTimestamps[cooldownKey] = now;

        const timestamp = new Date(opportunity.timestamp || now).toISOString();
        const message = `
--- Opportunity Found (${opportunity.type || 'N/A'}) --- 
Pair: ${opportunity.pair}
Direction: ${opportunity.direction}
Timestamp: ${timestamp}

Buy Leg:
  Exchange: ${opportunity.buyExchange} (${opportunity.buyInstrument})
  Price: ${opportunity.buyPrice}
  Fee (Est.): ${(opportunity.buyFee * 100).toFixed(4)}%

Sell Leg:
  Exchange: ${opportunity.sellExchange} (${opportunity.sellInstrument})
  Price: ${opportunity.sellPrice}
  Fee (Est.): ${(opportunity.sellFee * 100).toFixed(4)}%

Spread:
  Gross Spread: ${opportunity.grossSpreadPercentage.toFixed(4)}%
  Net Spread (Estimated): ${opportunity.netSpreadPercentage.toFixed(4)}%

Additional Info:
  Spot Volume (24h USD): ${opportunity.spotVolume24hUSD !== undefined ? opportunity.spotVolume24hUSD : 'N/A'}
  Futures Volume (24h USD): ${opportunity.futuresVolume24hUSD !== undefined ? opportunity.futuresVolume24hUSD : 'N/A'}
  Funding Rate: ${opportunity.fundingRate !== undefined && opportunity.fundingRate !== null ? (opportunity.fundingRate * 100).toFixed(4) + '%' : 'N/A'}
-------------------------
`;

        if (this.signalMethod === "console" || this.signalMethod === "both") {
            console.log(message);
        }

        if ((this.signalMethod === "file" || this.signalMethod === "both") && this.logStream) {
            this.logStream.write(message);
        }

        this.logger.info(`Signaled Opportunity: ${opportunity.pair} | ${opportunity.direction} | Net: ${opportunity.netSpreadPercentage.toFixed(4)}%`);
    }

    close() {
        if (this.logStream) {
            this.logStream.end(() => {
                this.logger.info("Opportunity log stream closed.");
            });
        }
    }
}

module.exports = OpportunitySignaler;