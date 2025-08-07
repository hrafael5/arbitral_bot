// A linha abaixo deve ser a PRIMEIRA LINHA do seu ficheiro
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
const User = require('./models/user.model');
const UserConfiguration = require('./models/userConfiguration.model');
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
            if (data.type === 'opportunity' && c.subscriptionStatus === 'free' && data.data.netSpreadPercentage >= 1.0) {
                return;
            }
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
        this.opportunities = [];
        this.maxOpportunities = 30;
    }
    signal(opportunity) {
        super.signal(opportunity);
        const existingIndex = this.opportunities.findIndex(op => op.pair === opportunity.pair && op.direction === opportunity.direction);
        if (existingIndex > -1) {
            this.opportunities[existingIndex] = { ...this.opportunities[existingIndex], ...opportunity, lastSeen: Date.now() };
        } else {
            this.opportunities.unshift({ ...opportunity, firstSeen: Date.now(), lastSeen: Date.now() });
            if (this.opportunities.length > this.maxOpportunities) this.opportunities.pop();
        }
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
            spot_api_url: rawConfig.mexc?.spot_api_url || 'https://api.mexc.com/api/v3',
            futures_api_url: rawConfig.mexc?.futures_api_url || 'https://contract.mexc.com/api/v1/contract',
            spot_maker_fee: parseFloat(rawConfig.mexc?.spot_maker_fee) || 0.0000,
            futures_maker_fee: parseFloat(rawConfig.mexc?.futures_maker_fee) || 0.0001,
            spot_polling_interval_ms: parseInt(rawConfig.mexc?.spot_polling_interval_ms) || 1500,
            futures_polling_interval_ms: parseInt(rawConfig.mexc?.futures_polling_interval_ms) || 1500,
            blacklisted_tokens: (rawConfig.mexc?.blacklisted_tokens || '').split(',').map(t => t.trim()).filter(t => t),
            enable_spot_ws: rawConfig.mexc?.enable_spot_ws === 'true' || true,
            enable_futures_ws: rawConfig.mexc?.enable_futures_ws === 'true' || true
        },
        gateio: {
            spot_api_url: rawConfig.gateio?.spot_api_url || 'https://api.gateio.ws/api/v4/spot',
            futures_api_url: rawConfig.gateio?.futures_api_url || 'https://api.gateio.ws/api/v4/futures',
            spot_maker_fee: parseFloat(rawConfig.gateio?.spot_maker_fee) || 0.0010,
            futures_maker_fee: parseFloat(rawConfig.gateio?.futures_maker_fee) || 0.0002,
            spot_polling_interval_ms: parseInt(rawConfig.gateio?.spot_polling_interval_ms) || 1500,
            futures_polling_interval_ms: parseInt(rawConfig.gateio?.futures_polling_interval_ms) || 1500,
            blacklisted_tokens: (rawConfig.gateio?.blacklisted_tokens || '').split(',').map(t => t.trim()).filter(t => t),
            enable_spot_ws: rawConfig.gateio?.enable_spot_ws === 'true' || true,
            enable_futures_ws: rawConfig.gateio?.enable_futures_ws === 'true' || true
        },
        signaling: {
            signal_method: rawConfig.signaling?.signal_method || 'console',
            opportunity_log_file: rawConfig.signaling?.opportunity_log_file || 'opportunities.log',
            signal_cooldown_ms: parseInt(rawConfig.signaling?.signal_cooldown_ms) || 500
        }
    };
}

// Lógica de inicialização do bot. Fica aqui para ser chamada depois.
function initializeAndStartBot() {
    try {
        const config = loadConfig();
        // O logger usa 'wss', que é uma variável global neste escopo
        const logger = createLoggerWithWSS(wss, config);

        const mexcConnector = new MEXCConnector(config.mexc, logger);
        const gateConnector = new GateConnector(config.gateio, logger);
        const connectors = { mexc: mexcConnector, gateio: gateConnector };

        // CORREÇÃO: Ordem de criação e argumentos corretos
        const opportunitySignaler = new WebSocketOpportunitySignaler(config.signaling, logger, wss);
        const arbitrageEngine = new ArbitrageEngine(config, opportunitySignaler, logger);

        const fetchTimeStart = Date.now();
        let mexcPairs = [];
        let gateioPairs = [];
        const fallbackPairs = {
            mexc: ['BTC/USDT', 'ETH/USDT'],
            gateio: ['BTC/USDT', 'ETH/USDT']
        };

        mexcPairs = fallbackPairs.mexc;
        gateioPairs = fallbackPairs.gateio;
        const fetchTime = Date.now() - fetchTimeStart;
        logger.info(`Fetched pairs for MEXC and Gate.io in ${fetchTime}ms`);

        const pairsByExchange = {
            mexc: mexcPairs.length > 0 ? mexcPairs : fallbackPairs.mexc,
            gateio: gateioPairs.length > 0 ? gateioPairs : fallbackPairs.gateio
        };

        if (mexcPairs.length === 0) logger.warn("Using fallback pairs for MEXC due to fetch failure");
        if (gateioPairs.length === 0) logger.warn("Using fallback pairs for Gate.io due to fetch failure");

        logger.info(`Starting market monitor with ${pairsByExchange.mexc.length} MEXC pairs and ${pairsByExchange.gateio.length} Gate.io pairs`);

        const broadcastCallback = () => {
            if (marketMonitor) broadcastToClients(wss, { type: 'all_pairs_update', data: marketMonitor.getAllMarketData() });
        };
        
        // a variável 'marketMonitor' é declarada no escopo global para ser acessível
        marketMonitor = new MarketMonitor(connectors, pairsByExchange, arbitrageEngine, logger, config, broadcastCallback);
        
        if (Object.keys(connectors).length > 0 && (pairsByExchange.mexc?.length > 0 || pairsByExchange.gateio?.length > 0)) {
            logger.info("Starting market monitor...");
            marketMonitor.start();
            logger.info("Bot initialization completed successfully!");
        } else {
            logger.error("[CRITICAL] No exchanges or pairs found. Bot will be idle.");
        }
    } catch (error) {
        // Usa o logger global 'logger' se ele já foi inicializado, caso contrário, usa console.error
        const logError = logger ? logger.error : console.error;
        logError(`[CRITICAL] Failed to initialize bot logic: ${error.message}`);
        logError("Stack trace:", error.stack);
    }
}

const shutdown = () => {
    if (logger) logger.info("Shutting down...");
    else console.log("Shutting down...");
    
    if (marketMonitor) marketMonitor.stop();
    
    server.close(() => {
        if (logger) logger.info("Server closed.");
        else console.log("Server closed.");
        
        sequelize.close().then(() => {
            if (logger) logger.info("Database connection closed.");
            else console.log("Database connection closed.");
            process.exit(0);
        });
    });
    setTimeout(() => { 
        if(logger) logger.warn("Forcing shutdown after timeout.");
        else console.warn("Forcing shutdown after timeout.");
        process.exit(1); 
    }, 10000);
};

// --- 3. CONFIGURAÇÃO DO SERVIDOR ---
const app = express();
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
    store: mySession