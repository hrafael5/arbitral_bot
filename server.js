// /server.js - VERSÃO FINAL E COMPLETA
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

// --- 2. DEFINIÇÃO DE VARIÁVEIS GLOBAIS ---
let globalLogger = console;
let marketMonitor = null;

// --- 3. DEFINIÇÃO DE FUNÇÕES E CLASSES AUXILIARES ---

const broadcastToClients = (wssInstance, data) => {
    if (!wssInstance || !wssInstance.clients) return;
    const compressedData = pako.deflate(JSON.stringify(data), { to: 'string' });
    wssInstance.clients.forEach(c => {
        if (c.readyState === WebSocket.OPEN) {
            try {
                c.send(compressedData);
            } catch (error) {
                globalLogger.error(`[Broadcast] Erro ao enviar dados para cliente: ${error.message}`);
            }
        }
    });
};

function createLoggerWithWSS(wssInstance, currentConfig) {
    const logLevel = (currentConfig?.general?.log_level) || "info";
    const log = (level, msg) => {
        const formattedMsg = `[${level.toUpperCase()}] ${new Date().toISOString()} - ${msg}`;
        if (level === 'error') console.error(formattedMsg);
        else if (level === 'warn') console.warn(formattedMsg);
        else console.log(formattedMsg);
        if (wssInstance) broadcastToClients(wssInstance, { type: 'log', level, message: msg });
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
    if (!fs.existsSync(configPath)) throw new Error('Config file (conf.ini) not found');
    const rawConfig = ini.parse(fs.readFileSync(configPath, 'utf-8'));
    
    const parseBlacklist = (tokens) => (tokens || '').split(',').map(t => t.trim()).filter(t => t);

    return {
        general: rawConfig.general,
        arbitrage: rawConfig.arbitrage,
        mexc: { ...rawConfig.mexc, blacklisted_tokens: parseBlacklist(rawConfig.mexc?.blacklisted_tokens) },
        gateio: { ...rawConfig.gateio, blacklisted_tokens: parseBlacklist(rawConfig.gateio?.blacklisted_tokens) },
        signaling: rawConfig.signaling
    };
}

async function initializeAndStartBot() {
    try {
        const config = loadConfig();
        globalLogger = createLoggerWithWSS(wss, config);

        const mexcConnector = new MEXCConnector(config.mexc, globalLogger);
        const gateConnector = new GateConnector(config.gateio, globalLogger);
        const connectors = { mexc: mexcConnector, gateio: gateConnector };

        globalLogger.info("Fetching pairs from exchanges...");
        const [mexcPairs, gateioPairs] = await Promise.all([
            mexcConnector.getAllTradablePairs(),
            gateConnector.getAllTradablePairs()
        ]);
        
        const mexcPairSet = new Set(mexcPairs);
        const commonPairs = gateioPairs.filter(pair => mexcPairSet.has(pair));
        
        globalLogger.info(`Found ${commonPairs.length} common tradable USDT pairs.`);
        
        let pairsByExchange;
        if (commonPairs.length === 0) {
            globalLogger.error("[CRITICAL] No common pairs found. Using fallback.");
            pairsByExchange = { mexc: ['BTC/USDT', 'ETH/USDT'], gateio: ['BTC/USDT', 'ETH/USDT'] };
        } else {
            pairsByExchange = { mexc: commonPairs, gateio: commonPairs };
        }

        const opportunitySignaler = new WebSocketOpportunitySignaler(config.signaling, globalLogger, wss);
        const arbitrageEngine = new ArbitrageEngine(config, opportunitySignaler, globalLogger);

        globalLogger.info(`Starting market monitor with ${pairsByExchange.mexc.length} pairs.`);
        
        marketMonitor = new MarketMonitor(connectors, pairsByExchange, arbitrageEngine, globalLogger, config, () => {
             if (marketMonitor) broadcastToClients(wss, { type: 'all_pairs_update', data: marketMonitor.getAllMarketData() });
        });
        
        marketMonitor.start();
        globalLogger.info("Bot initialization completed successfully!");

    } catch (error) {
        globalLogger.error(`[CRITICAL] Bot initialization failed: ${error.message}`);
        globalLogger.error(error.stack);
    }
}

const shutdown = () => {
    if (globalLogger) globalLogger.info("Shutting down...");
    if (marketMonitor) marketMonitor.stop();
    server.close(() => {
        if (globalLogger) globalLogger.info("Server closed.");
        sequelize.close().then(() => {
            if (globalLogger) globalLogger.info("Database connection closed.");
            process.exit(0);
        });
    });
    setTimeout(() => { 
        if(globalLogger) globalLogger.warn("Forcing shutdown after timeout.");
        process.exit(1); 
    }, 10000);
};

// --- 4. CONFIGURAÇÃO DO SERVIDOR E ROTAS ---
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(helmet({ 
    contentSecurityPolicy: {
        directives: {
            ...helmet.contentSecurityPolicy.getDefaultDirectives(),
            "script-src": ["'self'", "cdnjs.cloudflare.com"],
        },
    }
}));
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

app.get('/api/config', (req, res) => res.json(loadConfig()));
app.get('/api/users/me', (req, res) => res.json({ subscriptionStatus: 'premium' }));
app.get('/api/users/settings', (req, res) => res.json({ status: 'success', data: { watchedPairs: [] } }));
app.post('/api/users/logout', (req, res) => res.status(200).json({ message: 'Logout successful' }));

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// --- 5. LÓGICA DO WEBSOCKET E INICIALIZAÇÃO ---
wss.on('connection', (ws) => {
    if (globalLogger) globalLogger.info('[WebSocketServer] Client connected');
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
});

setInterval(() => {
    wss.clients.forEach((ws) => {
        if (!ws.isAlive) return ws.terminate();
        ws.isAlive = false;
        ws.ping(() => {});
    });
}, 30000);

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

const PORT = process.env.PORT || 3000;
sequelize.sync()
    .then(() => {
        mySessionStore.sync();
        server.listen(PORT, () => {
            console.log(`Server listening on port ${PORT}.`);
            initializeAndStartBot();
        });
    })
    .catch(err => {
        console.error(`[CRITICAL] DB Sync Error: ${err.message}`);
        process.exit(1);
    });