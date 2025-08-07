// /server.js - VERSÃO COMPLETA E ATUALIZADA
require('dotenv').config();

// --- 1. DEPENDÊNCIAS ---
const express = require('express');
const http = require('http');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const ini = require('ini');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const session = require('express-session');
const sequelize = require('./database');
const SequelizeStore = require("connect-session-sequelize")(session.Store);
const pako = require('pako');

const MEXCConnector = require('./lib/MEXCConnector');
const GateConnector = require('./lib/GateConnector');
const MarketMonitor = require('./lib/MarketMonitor');
const ArbitrageEngine = require('./lib/ArbitrageEngine');
const OpportunitySignaler = require('./lib/OpportunitySignaler');

// --- 2. DEFINIÇÃO DE FUNÇÕES E CLASSES AUXILIARES ---

const broadcastToClients = (wssInstance, data) => {
    if (!wssInstance || !wssInstance.clients) return;
    const compressedData = pako.deflate(JSON.stringify(data), { to: 'string' });
    wssInstance.clients.forEach(c => {
        if (c.readyState === WebSocket.OPEN && c.userId) {
            c.send(compressedData);
        }
    });
};

function createLoggerWithWSS(wssInstance, currentConfig) {
    const logLevel = (currentConfig.general && currentConfig.general.log_level) || "info";
    const log = (level, msg) => {
        const formattedMsg = '[' + level.toUpperCase() + '] ' + new Date().toISOString() + ' - ' + msg;
        if (level === 'error') console.error(formattedMsg);
        else if (level === 'warn') console.warn(formattedMsg);
        else console.log(formattedMsg);
        
        if (wssInstance) {
            broadcastToClients(wssInstance, { type: 'log', level, message: msg });
        }
    };
    return {
        info: (msg) => log('info', msg),
        warn: (msg) => log('warn', msg),
        error: (msg) => log('error', msg),
        debug: (msg) => { if (logLevel === "debug") log('debug', msg); }
    };
}

class WebSocketOpportunitySignaler extends OpportunitySignaler {
    constructor(sigConfig, signalerLogger, wssInstance) {
        super(sigConfig, signalerLogger);
        this.wss = wssInstance;
    }
    signal(opportunity) {
        super.signal(opportunity);
        broadcastToClients(this.wss, { type: 'opportunity', data: opportunity });
    }
}

function loadConfig() {
    const configPath = path.join(__dirname, 'conf.ini');
    if (!fs.existsSync(configPath)) {
        throw new Error('Config file (conf.ini) not found');
    }
    const rawConfig = ini.parse(fs.readFileSync(configPath, 'utf-8'));
    return {
        general: {
            log_level: rawConfig.general?.log_level || 'info'
        },
        arbitrage: {
            min_profit_percentage: parseFloat(rawConfig.arbitrage?.min_profit_percentage) || 0.0,
            enable_futures_vs_futures: rawConfig.arbitrage?.enable_futures_vs_futures === 'true' || false,
            enable_spot_vs_spot: rawConfig.arbitrage?.enable_spot_vs_spot === 'true' || false,
            max_timestamp_diff_ms: parseInt(rawConfig.arbitrage?.max_timestamp_diff_ms) || 2500
        },
        mexc: {
            spot_api_url: rawConfig.mexc?.spot_api_url,
            futures_api_url: rawConfig.mexc?.futures_api_url,
            spot_maker_fee: parseFloat(rawConfig.mexc?.spot_maker_fee),
            futures_maker_fee: parseFloat(rawConfig.mexc?.futures_maker_fee),
            spot_polling_interval_ms: parseInt(rawConfig.mexc?.spot_polling_interval_ms),
            futures_polling_interval_ms: parseInt(rawConfig.mexc?.futures_polling_interval_ms),
            blacklisted_tokens: (rawConfig.mexc?.blacklisted_tokens || '').split(',').map(t => t.trim()).filter(t => t),
            enable_spot_ws: rawConfig.mexc?.enable_spot_ws !== 'false',
            enable_futures_ws: rawConfig.mexc?.enable_futures_ws !== 'false'
        },
        gateio: {
            spot_api_url: rawConfig.gateio?.spot_api_url,
            futures_api_url: rawConfig.gateio?.futures_api_url,
            spot_maker_fee: parseFloat(rawConfig.gateio?.spot_maker_fee),
            futures_maker_fee: parseFloat(rawConfig.gateio?.futures_maker_fee),
            spot_polling_interval_ms: parseInt(rawConfig.gateio?.spot_polling_interval_ms),
            futures_polling_interval_ms: parseInt(rawConfig.gateio?.futures_polling_interval_ms),
            blacklisted_tokens: (rawConfig.gateio?.blacklisted_tokens || '').split(',').map(t => t.trim()).filter(t => t),
            enable_spot_ws: rawConfig.gateio?.enable_spot_ws !== 'false',
            enable_futures_ws: rawConfig.gateio?.enable_futures_ws !== 'false'
        },
        signaling: {
            signal_method: rawConfig.signaling?.signal_method || 'console',
            opportunity_log_file: rawConfig.signaling?.opportunity_log_file || 'opportunities.log',
            signal_cooldown_ms: parseInt(rawConfig.signaling?.signal_cooldown_ms) || 500
        }
    };
}

async function initializeAndStartBot() {
    try {
        const config = loadConfig();
        const logger = createLoggerWithWSS(wss, config);
        global.logger = logger;

        const mexcConnector = new MEXCConnector(config.mexc, logger);
        const gateConnector = new GateConnector(config.gateio, logger);
        const connectors = { mexc: mexcConnector, gateio: gateConnector };

        logger.info("Fetching pairs from exchanges...");
        const [mexcPairs, gateioPairs] = await Promise.all([
            mexcConnector.getAllTradablePairs(),
            gateConnector.getAllTradablePairs()
        ]);
        
        const mexcPairSet = new Set(mexcPairs);
        const commonPairs = gateioPairs.filter(pair => mexcPairSet.has(pair));
        
        logger.info(`Found ${commonPairs.length} common tradable USDT pairs between MEXC and Gate.io.`);
        
        if (commonPairs.length === 0) {
            logger.error("[CRITICAL] No common pairs found between exchanges. Using fallback pairs.");
            const fallbackPairs = {
                mexc: ['BTC/USDT', 'ETH/USDT'],
                gateio: ['BTC/USDT', 'ETH/USDT']
            };
            pairsByExchange = fallbackPairs;
        } else {
             pairsByExchange = {
                mexc: commonPairs,
                gateio: commonPairs
            };
        }

        const opportunitySignaler = new WebSocketOpportunitySignaler(config.signaling, logger, wss);
        const arbitrageEngine = new ArbitrageEngine(config, opportunitySignaler, logger);

        logger.info(`Starting market monitor with ${pairsByExchange.mexc.length} common pairs.`);

        const broadcastCallback = () => {
            if (marketMonitor) broadcastToClients(wss, { type: 'all_pairs_update', data: marketMonitor.getAllMarketData() });
        };
        
        marketMonitor = new MarketMonitor(connectors, pairsByExchange, arbitrageEngine, logger, config, broadcastCallback);
        
        marketMonitor.start();
        logger.info("Bot initialization completed successfully!");

    } catch (error) {
        const log = global.logger ? global.logger.error : console.error;
        log(`[CRITICAL] Failed to initialize bot logic: ${error.message}`);
        log("Stack trace:", error.stack);
    }
}

const shutdown = () => {
    if (global.logger) global.logger.info("Shutting down...");
    if (marketMonitor) marketMonitor.stop();
    server.close(() => {
        if (global.logger) global.logger.info("Server closed.");
        sequelize.close().then(() => {
            if (global.logger) global.logger.info("Database connection closed.");
            process.exit(0);
        });
    });
    setTimeout(() => { 
        if(global.logger) global.logger.warn("Forcing shutdown after timeout.");
        process.exit(1); 
    }, 10000);
};

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: '/ws' });
let marketMonitor = null;
global.logger = null;

app.use(helmet());
app.use(cors());
app.use(compression());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const mySessionStore = new SequelizeStore({ db: sequelize });
app.use(session({
    secret: process.env.SESSION_SECRET || 'default-secret-change-me',
    resave: false,
    saveUninitialized: false,
    store: mySessionStore,
    cookie: { secure: process.env.NODE_ENV === 'production', maxAge: 24 * 60 * 60 * 1000 }
}));

app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

wss.on('connection', (ws, req) => {
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
});

const cleanupInterval = setInterval(() => {
    wss.clients.forEach((ws) => {
        if (ws.isAlive === false) return ws.terminate();
        ws.isAlive = false;
        ws.ping(() => {});
    });
}, 60000);

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

sequelize.sync({ alter: true })
    .then(() => {
        mySessionStore.sync();
        const PORT = process.env.PORT || 3000;
        server.listen(PORT, () => {
            console.log(`Server listening on port ${PORT}.`);
            initializeAndStartBot();
        });
    })
    .catch(err => {
        console.error(`[CRITICAL] Could not connect/sync to the database: ${err.message}`);
        process.exit(1);
    });