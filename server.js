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
const opportunitySignaler = new WebSocketOpportunitySignaler(config.signaling, logger, wss);
const arbitrageEngine = new ArbitrageEngine(config, opportunitySignaler, logger);

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
        // LINHA CORRIGIDA:
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

function initializeAndStartBot() {
    try {
        const config = loadConfig();
        const logger = createLoggerWithWSS(wss, config);

        const mexcConnector = new MEXCConnector(config.mexc, logger);
        const gateConnector = new GateConnector(config.gateio, logger);
        const connectors = { mexc: mexcConnector, gateio: gateConnector };

        const arbitrageEngine = new ArbitrageEngine(config.arbitrage, logger);
        const opportunitySignaler = new WebSocketOpportunitySignaler(config.signaling, logger, wss);

        const fetchTimeStart = Date.now();
        let mexcPairs = [];
        let gateioPairs = [];
        const fallbackPairs = {
            mexc: ['BTC/USDT', 'ETH/USDT'],
            gateio: ['BTC/USDT', 'ETH/USDT']
        };

        // Simulação de fetch de pares (substitua por lógica real se necessário)
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
        marketMonitor = new MarketMonitor(connectors, pairsByExchange, arbitrageEngine, logger, config, broadcastCallback);
        if (Object.keys(connectors).length > 0 && (pairsByExchange.mexc?.length > 0 || pairsByExchange.gateio?.length > 0)) {
            logger.info("Starting market monitor...");
            marketMonitor.start();
            logger.info("Bot initialization completed successfully!");
        } else {
            logger.error("[CRITICAL] No exchanges or pairs found. Bot will be idle.");
        }
    } catch (error) {
        logger.error(`[CRITICAL] Failed to initialize bot logic: ${error.message}`);
        logger.error("Stack trace:", error.stack);
    }
}

const shutdown = () => {
    logger.info("Shutting down...");
    if (marketMonitor) marketMonitor.stop();
    server.close(() => {
        logger.info("Server closed.");
        sequelize.close().then(() => logger.info("Database connection closed."));
        process.exit(0);
    });
    setTimeout(() => { logger.warn("Forcing shutdown after timeout."); process.exit(1); }, 10000);
};

// --- 3. CONFIGURAÇÃO DO SERVIDOR ---
const app = express();
app.use(helmet());
app.use(cors());
app.use(compression());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Configuração da sessão
const mySessionStore = new SequelizeStore({
    db: sequelize
});
app.use(session({
    secret: process.env.SESSION_SECRET || 'default-secret-change-me',
    resave: false,
    saveUninitialized: false,
    store: mySessionStore,
    cookie: {
        secure: process.env.NODE_ENV === 'production',
        maxAge: 24 * 60 * 60 * 1000 // 24 horas
    }
}));

// Middleware de autenticação (assumindo que está em outro arquivo)
const isAuthenticated = (req, res, next) => {
    if (req.session.userId) {
        req.session.subscriptionStatus = req.session.subscriptionStatus || 'free'; // Simula status
        return next();
    }
    res.status(401).json({ message: 'Unauthorized' });
};

// Rota para servir a página principal
app.get('/', isAuthenticated, (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// Middleware de tratamento de erros global
app.use((err, req, res, next) => {
    console.error("ERRO INESPERADO:", err.stack);
    res.status(500).json({ message: "Ocorreu um erro inesperado no servidor." });
});

// --- 4. CONFIGURAÇÃO DO WEBSOCKET ---
const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: '/ws' });

// Configuração de ping/pong para manter conexões vivas
const pingInterval = setInterval(() => {
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(pako.deflate(JSON.stringify({ type: 'ping' }), { to: 'string' }));
        }
    });
}, 30000); // Ping a cada 30 segundos

wss.on('connection', (ws, req) => {
    const userId = req.session.userId;
    const subscriptionStatus = req.session.subscriptionStatus || 'free'; // Simula status de assinatura
    ws.userId = userId;
    ws.subscriptionStatus = subscriptionStatus;
    ws.isAlive = true;

    ws.on('pong', () => { ws.isAlive = true; });
    ws.on('message', (message) => {
        const data = JSON.parse(pako.inflate(message, { to: 'string' }));
        if (data.type === 'pong') return;
        // Lógica para mensagens do cliente (ex.: filtros, ações)
        broadcastToClients(wss, { type: 'client_message', data });
    });

    ws.on('close', () => {
        ws.isAlive = false;
    });

    ws.on('error', (error) => {
        logger.error(`[WebSocket] Error on connection: ${error.message}`);
    });
});

// Verifica conexões inativas a cada 60 segundos
const cleanupInterval = setInterval(() => {
    wss.clients.forEach((ws) => {
        if (ws.isAlive === false) return ws.terminate();
        ws.isAlive = false;
        ws.ping();
    });
}, 60000);

// Limpeza dos intervalos em caso de shutdown
process.on('SIGINT', () => {
    clearInterval(pingInterval);
    clearInterval(cleanupInterval);
    shutdown();
});
process.on('SIGTERM', () => {
    clearInterval(pingInterval);
    clearInterval(cleanupInterval);
    shutdown();
});

// --- 6. INÍCIO DA EXECUÇÃO ---
let marketMonitor = null;
let logger = null;

sequelize.sync({ alter: true })
    .then(() => {
        mySessionStore.sync();
        logger = createLoggerWithWSS(wss, loadConfig()); // Inicializa logger após sync
        logger.info("Database and session store synchronized.");
        const PORT = process.env.PORT || 3000;
        server.listen(PORT, () => {
            logger.info(`Server listening on port ${PORT}.`);
            initializeAndStartBot();
        });
    })
    .catch(err => {
        if (logger) logger.error(`[CRITICAL] Could not connect/sync to the database: ${err.message}`);
        else console.error(`[CRITICAL] Could not connect/sync to the database: ${err.message}`);
        process.exit(1);
    });