// /home/ubuntu/mexc_bot/server.js

const express = require('express');
const http = require('http');
const cors = require('cors');
const ini = require('ini');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const MEXCConnector = require('./lib/MEXCConnector');
const GateConnector = require('./lib/GateConnector');
const MarketMonitor = require('./lib/MarketMonitor');
const ArbitrageEngine = require('./lib/ArbitrageEngine');
const OpportunitySignaler = require('./lib/OpportunitySignaler');

let logger = {
    info: (msg) => console.log(`[INFO] PRE-INIT: ${new Date().toISOString()} - ${msg}`),
    warn: (msg) => console.warn(`[WARN] PRE-INIT: ${new Date().toISOString()} - ${msg}`),
    error: (msg) => console.error(`[ERROR] PRE-INIT: ${new Date().toISOString()} - ${msg}`),
    debug: (msg) => {
        if (process.env.LOG_LEVEL_PRE_INIT === "debug") {
            console.log(`[DEBUG] PRE-INIT: ${new Date().toISOString()} - ${msg}`);
        }
    }
};

let config = {}; 

const createLoggerWithWSS = (wssInstance, currentConfig) => {
    const logLevel = (currentConfig.general && currentConfig.general.log_level) || "info";
    return {
        info: (msg) => {
            console.log(`[INFO] ${new Date().toISOString()} - ${msg}`);
            if (wssInstance) broadcastToClients(wssInstance, { type: 'log', level: 'info', message: msg });
        },
        warn: (msg) => {
            console.warn(`[WARN] ${new Date().toISOString()} - ${msg}`);
            if (wssInstance) broadcastToClients(wssInstance, { type: 'log', level: 'warn', message: msg });
        },
        error: (msg) => {
            console.error(`[ERROR] ${new Date().toISOString()} - ${msg}`);
            if (wssInstance) broadcastToClients(wssInstance, { type: 'log', level: 'error', message: msg });
        },
        debug: (msg) => {
            if (logLevel === "debug") {
                console.log(`[DEBUG] ${new Date().toISOString()} - ${msg}`);
                if (wssInstance) broadcastToClients(wssInstance, { type: 'log', level: 'debug', message: msg });
            }
        }
    };
};

const broadcastToClients = (wssInstance, data) => {
    if (!wssInstance || !wssInstance.clients) {
        console.error("[broadcastToClients] Tentativa de broadcast com wssInstance inválido ou sem clientes. Data:", JSON.stringify(data));
        return;
    }
    wssInstance.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            try {
                client.send(JSON.stringify(data));
            } catch (e) {
                console.error("[broadcastToClients] Erro ao enviar mensagem para o cliente:", e.message);
            }
        }
    });
};

class WebSocketOpportunitySignaler extends OpportunitySignaler {
    constructor(sigConfig, signalerLogger, wssInstance) {
        super(sigConfig, signalerLogger);
        this.wss = wssInstance;
        this.opportunities = [];
        this.maxOpportunities = 20;
    }

    signal(opportunity) {
        super.signal(opportunity);
        if (!opportunity.timestamp) {
            opportunity.timestamp = Date.now();
        }
        
        const existingIndex = this.opportunities.findIndex(
            op => op.pair === opportunity.pair && op.direction === opportunity.direction
        );
        if (existingIndex > -1) {
            this.opportunities.splice(existingIndex, 1);
        }

        this.opportunities.unshift(opportunity); 
        if (this.opportunities.length > this.maxOpportunities) {
            this.opportunities.pop(); 
        }
        broadcastToClients(this.wss, {
            type: 'opportunity',
            data: opportunity
        });
    }
    getOpportunities() {
        return this.opportunities;
    }
}

try {
    const configPath = path.resolve(__dirname, "conf.ini");
    if (!fs.existsSync(configPath)) {
        throw new Error(`Arquivo de configuração conf.ini não encontrado em: ${configPath}`);
    }
    config = ini.parse(fs.readFileSync(configPath, "utf-8"));
    logger.info("Configuration loaded successfully from conf.ini");

    if (!config.arbitrage) {
        config.arbitrage = {};
        logger.warn("Seção [arbitrage] não encontrada no conf.ini. Usando padrões.");
    }
    config.arbitrage.enable_futures_vs_futures = config.arbitrage.enable_futures_vs_futures === 'true' || config.arbitrage.enable_futures_vs_futures === true;
    logger.info(`[ServerJS] Futures vs Futures strategy initial state: ${config.arbitrage.enable_futures_vs_futures}`);

    config.arbitrage.enable_spot_vs_spot = config.arbitrage.enable_spot_vs_spot === 'true' || config.arbitrage.enable_spot_vs_spot === true;
    logger.info(`[ServerJS] Spot vs Spot strategy initial state: ${config.arbitrage.enable_spot_vs_spot}`);


} catch (error) {
    logger.error(`[CRITICAL] Failed to load configuration from conf.ini: ${error.message}`);
    logger.error("Verifique se o arquivo 'conf.ini' existe no mesmo diretório do 'server.js' e se sua sintaxe está correta.");
    process.exit(1);
}

const app = express();
const server = http.createServer(app);
let wss;

try {
    wss = new WebSocket.Server({ server });
    logger.info("WebSocket Server (wss) initialized.");
    const mainLogger = createLoggerWithWSS(wss, config);
    logger = mainLogger;
    logger.info("Main logger initialized with WebSocket capabilities.");
} catch (e) {
    console.error(`[CRITICAL] Failed to initialize WebSocket Server (wss) or main logger: ${e.message}. Bot will continue with PRE-INIT console logs.`);
    if (logger && typeof logger.error === 'function' && logger !== console) {
         logger.error(`[CRITICAL] Failed to initialize WebSocket Server (wss) or main logger: ${e.message}. Bot will continue with PRE-INIT console logs.`);
    }
}

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const mexcConfig = config.mexc || {};
const gateioConfig = config.gateio || {};
const generalConfig = config.general || {};
const arbitrageConfig = config.arbitrage || {};
const signalingConfig = config.signaling || {};

const connectors = {};
if (mexcConfig.spot_api_url || mexcConfig.futures_api_url) {
    connectors.mexc = new MEXCConnector(mexcConfig, logger);
    logger.info("MEXC Connector instance created.");
} else {
    logger.warn("MEXC configuration (spot_api_url or futures_api_url) not found in conf.ini. MEXC Connector not initialized.");
}

if (gateioConfig.spot_api_url || gateioConfig.futures_api_url) {
    connectors.gateio = new GateConnector(gateioConfig, logger);
    logger.info("Gate.io Connector instance created.");
} else {
    logger.warn("Gate.io configuration (spot_api_url or futures_api_url) not found in conf.ini. Gate.io Connector not initialized.");
}

const opportunitySignaler = new WebSocketOpportunitySignaler(signalingConfig, logger, wss);
const arbitrageEngine = new ArbitrageEngine(config, opportunitySignaler, logger);
let marketMonitor; 

async function fetchAndFilterPairs(connector, exchangeName, exchangeSpecificConfig, globalGeneralConfig) {
    if (!connector || typeof connector.getFuturesContractDetail !== 'function') {
        logger.warn(`[${exchangeName}] Connector not available or getFuturesContractDetail not implemented. Skipping futures pair fetching for ${exchangeName}.`);
        return [];
    }
    logger.info(`[${exchangeName}] Fetching available Futures pairs from ${exchangeName}...`);
    let processedContracts = [];
    try {
        const contractDetailsResponse = await connector.getFuturesContractDetail();
        if (contractDetailsResponse && contractDetailsResponse.success && Array.isArray(contractDetailsResponse.data)) {
            processedContracts = contractDetailsResponse.data;
        } else {
            logger.error(`[${exchangeName}] Failed to fetch or parse Futures contract details from ${exchangeName}.`);
            return [];
        }
    } catch (error) {
        logger.error(`[${exchangeName}] Error fetching/processing Futures pairs from ${exchangeName}: ${error.message}`);
        return [];
    }

    const filteredPairs = processedContracts
        .filter(contract => {
            const quote = contract.quoteCoin?.toUpperCase();
            const settle = contract.settleCoin?.toUpperCase();
            return quote === "USDT" && settle === "USDT"; 
        })
        .map(contract => {
            const originalSymbol = contract.symbol;
            return originalSymbol.includes('/') ? originalSymbol : originalSymbol.replace("_", "/");
        });

    logger.info(`[${exchangeName}] Successfully filtered ${filteredPairs.length} USDT perpetual futures pairs.`);

    let pairsToMonitor = filteredPairs;
    const blacklistedTokensString = exchangeSpecificConfig.blacklisted_tokens?.trim();
    if (blacklistedTokensString) {
        const blacklistArray = blacklistedTokensString.split(',').map(token => token.trim().toUpperCase());
        const initialCount = pairsToMonitor.length;
        pairsToMonitor = pairsToMonitor.filter(pair => {
            const baseToken = pair.split('/')[0].toUpperCase();
            return !blacklistArray.includes(baseToken) && !blacklistArray.includes(pair.toUpperCase());
        });
        const removedCount = initialCount - pairsToMonitor.length;
        if (removedCount > 0) logger.info(`[${exchangeName}] ${removedCount} pairs were removed due to blacklist.`);
    }
    return pairsToMonitor;
}

async function initializeAndStartServer() {
    logger.info("Initializing server and bot logic...");

    let allPairsToMonitorByExchange = {};
    let allUniquePairsSet = new Set();

    if (connectors.mexc) {
        const mexcFuturesPairs = await fetchAndFilterPairs(connectors.mexc, "MEXC", mexcConfig, generalConfig);
        allPairsToMonitorByExchange.mexc = mexcFuturesPairs;
        mexcFuturesPairs.forEach(p => allUniquePairsSet.add(p));
    }
    if (connectors.gateio) {
        const gateioFuturesPairs = await fetchAndFilterPairs(connectors.gateio, "GateIO", gateioConfig, generalConfig);
        allPairsToMonitorByExchange.gateio = gateioFuturesPairs;
        gateioFuturesPairs.forEach(p => allUniquePairsSet.add(p));
    }

    if (Object.keys(allPairsToMonitorByExchange).length === 0 && Object.keys(connectors).length > 0) {
         logger.warn("No pairs to monitor from any configured exchange after filtering.");
    } else if (Object.keys(connectors).length === 0) {
        logger.error("[CRITICAL] No connectors were initialized. Bot cannot monitor any exchange.");
        process.exit(1);
    }
    
    const broadcastMarketData = () => {
        if (marketMonitor && wss && wss.clients && wss.clients.size > 0) { 
            const allData = marketMonitor.getAllMarketData();
            broadcastToClients(wss, { type: 'all_pairs_update', data: allData });
        }
    };
    
    marketMonitor = new MarketMonitor(connectors, allPairsToMonitorByExchange, arbitrageEngine, logger, config, broadcastMarketData);

    app.get('/api/opportunities', (req, res) => { res.json(opportunitySignaler.getOpportunities()); });
    
    app.get('/api/config', (req, res) => {
        const safeConfig = {
            exchanges: {},
            arbitrage: { 
                minProfitPercentage: arbitrageConfig.min_profit_percentage,
                enableFuturesVsFutures: config.arbitrage.enable_futures_vs_futures,
                enableSpotVsSpot: config.arbitrage.enable_spot_vs_spot
            },
            monitoredPairs: Array.from(allUniquePairsSet) 
        };
        if (config.mexc) safeConfig.exchanges.mexc = { 
            spotMakerFee: mexcConfig.spot_maker_fee, futuresMakerFee: mexcConfig.futures_maker_fee,
            spotPollingIntervalMs: mexcConfig.spot_polling_interval_ms, futuresPollingIntervalMs: mexcConfig.futures_polling_interval_ms,
            blacklistedTokens: (mexcConfig.blacklisted_tokens || "").split(',').map(t => t.trim()).filter(t => t),
        };
        if (config.gateio) safeConfig.exchanges.gateio = { 
            spotMakerFee: gateioConfig.spot_maker_fee, futuresMakerFee: gateioConfig.futures_maker_fee, 
            spotPollingIntervalMs: gateioConfig.spot_polling_interval_ms, futuresPollingIntervalMs: gateioConfig.futures_polling_interval_ms,
            blacklistedTokens: (gateioConfig.blacklisted_tokens || "").split(',').map(t => t.trim()).filter(t => t),
        };
        res.json(safeConfig);
    });

    app.post('/api/config/arbitrage', (req, res) => {
        const { enableFuturesVsFutures } = req.body;
        if (typeof enableFuturesVsFutures === 'boolean') {
            config.arbitrage.enable_futures_vs_futures = enableFuturesVsFutures;
            logger.info(`[API_CONFIG_UPDATE] Futures vs Futures strategy dynamically set to: ${config.arbitrage.enable_futures_vs_futures}`);
            res.json({ success: true, message: 'Arbitrage configuration updated successfully.', newConfig: { enableFuturesVsFutures: config.arbitrage.enable_futures_vs_futures }});
        } else {
            res.status(400).json({ success: false, message: 'Invalid value for enableFuturesVsFutures. Must be a boolean.' });
        }
    });

    app.post('/api/config/arbitrage/spot', (req, res) => {
        const { enableSpotVsSpot } = req.body; 
        if (typeof enableSpotVsSpot === 'boolean') {
            config.arbitrage.enable_spot_vs_spot = enableSpotVsSpot;
            logger.info(`[API_CONFIG_UPDATE] Spot vs Spot strategy dynamically set to: ${config.arbitrage.enable_spot_vs_spot}`);
            res.json({ success: true, message: 'Spot vs Spot configuration updated successfully.', newConfig: { enableSpotVsSpot: config.arbitrage.enable_spot_vs_spot }});
        } else {
            res.status(400).json({ success: false, message: 'Invalid value for enableSpotVsSpot. Must be a boolean.' });
        }
    });

    app.get('/realtime_profit_calc.html', (req, res) => { 
        res.sendFile(path.join(__dirname, 'public/realtime_profit_calc.html'));
    });
    app.get('*', (req, res) => { res.sendFile(path.join(__dirname, 'public/index.html')); });

    wss.on('connection', (wsClient) => { 
        logger.info('Client connected to WebSocket');
        try {
            wsClient.send(JSON.stringify({ type: 'opportunities', data: opportunitySignaler.getOpportunities() }));
            if (marketMonitor) wsClient.send(JSON.stringify({ type: 'all_pairs_update', data: marketMonitor.getAllMarketData() }));
        } catch (e) { logger.error("Erro WS send initial data:", e); }
        
        wsClient.on('message', async (messageString) => {
            try {
                const message = JSON.parse(messageString.toString());
                if (message.type === 'request_latest_data') {
                    if (opportunitySignaler) wsClient.send(JSON.stringify({ type: 'opportunities', data: opportunitySignaler.getOpportunities() }));
                    if (marketMonitor) wsClient.send(JSON.stringify({ type: 'all_pairs_update', data: marketMonitor.getAllMarketData() }));
                }
            } catch (e) { logger.error('[WebSocket] Erro processar mensagem:', e, messageString.toString()); }
        });
        wsClient.on('close', () => { logger.info('Client disconnected'); });
        wsClient.on('error', (clientError) => { logger.error('WS client error:', clientError); });
    });

    logger.info("Starting Arbitrage Identifier Bot with Web Interface...");
    if (Object.keys(connectors).length > 0 && (allPairsToMonitorByExchange.mexc?.length > 0 || allPairsToMonitorByExchange.gateio?.length > 0) ) {
        marketMonitor.start();
    } else {
        logger.error("[CRITICAL] No exchanges to monitor or no pairs selected. MarketMonitor will not start. Bot will be idle.");
    }
    
    const shutdown = () => {
        logger.info("Shutting down bot and web server...");
        if (marketMonitor) marketMonitor.stop();
        Object.values(connectors).forEach(connector => {
            if (connector && typeof connector.closeAll === 'function') connector.closeAll();
        });
        server.close(() => {
            logger.info("HTTP/WebSocket server closed.");
            process.exit(0);
        });
        setTimeout(() => {
            logger.warn("Forcing shutdown after timeout...");
            process.exit(1);
        }, 10000); 
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);

    const PORT = process.env.PORT || config.general?.port || 3000;
    server.listen(PORT, () => {
        logger.info(`Server running on port ${PORT}. Access at http://localhost:${PORT}`);
    });
}

initializeAndStartServer().catch(err => {
    logger.error(`[CRITICAL] Unhandled error during main server initialization: ${err.message}`);
    logger.error(`Stack trace: ${err.stack}`);
    console.error("[CRITICAL_FALLBACK] Unhandled error during main server initialization:", err);
    process.exit(1);
});