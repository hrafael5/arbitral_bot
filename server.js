// /server.js - VERSÃO COM CORREÇÃO DE BUGS

// --- DEPENDÊNCIAS ---
const express = require('express');
const http = require('http');
const cors = require('cors');
const ini = require('ini');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const session = require('express-session');
const sequelize = require('./database');
const User = require('./models/user.model');
const UserConfiguration = require('./models/userConfiguration.model');
require('dotenv').config();
const SequelizeStore = require("connect-session-sequelize")(session.Store);

// --- LÓGICA DO BOT ---
const MEXCConnector = require('./lib/MEXCConnector');
const GateConnector = require('./lib/GateConnector');
const MarketMonitor = require('./lib/MarketMonitor');
const ArbitrageEngine = require('./lib/ArbitrageEngine');
const OpportunitySignaler = require('./lib/OpportunitySignaler');

// --- SETUP INICIAL ---
let logger = { info: console.log, warn: console.warn, error: console.error, debug: console.log };
const config = ini.parse(fs.readFileSync(path.resolve(__dirname, "conf.ini"), "utf-8"));
const app = express();
const server = http.createServer(app);

// --- FUNÇÕES E CLASSES AUXILIARES (DEFINIDAS PRIMEIRO) ---
const broadcastToClients = (wssInstance, data) => { 
    if (!wssInstance || !wssInstance.clients) return;
    wssInstance.clients.forEach(c => { if (c.readyState === WebSocket.OPEN) c.send(JSON.stringify(data)) }); 
};

function createLoggerWithWSS(wssInstance, currentConfig) {
    const logLevel = (currentConfig.general && currentConfig.general.log_level) || "info";
    return {
        info: (msg) => { console.log(`[INFO] ${new Date().toISOString()} - ${msg}`); if (wssInstance) broadcastToClients(wssInstance, { type: 'log', level: 'info', message: msg }); },
        warn: (msg) => { console.warn(`[WARN] ${new Date().toISOString()} - ${msg}`); if (wssInstance) broadcastToClients(wssInstance, { type: 'log', level: 'warn', message: msg }); },
        error: (msg) => { console.error(`[ERROR] ${new Date().toISOString()} - ${msg}`); if (wssInstance) broadcastToClients(wssInstance, { type: 'log', level: 'error', message: msg }); },
        debug: (msg) => { if (logLevel === "debug") { console.log(`[DEBUG] ${new Date().toISOString()} - ${msg}`); if (wssInstance) broadcastToClients(wssInstance, { type: 'log', level: 'debug', message: msg }); } }
    };
};

// --- CLASSE CORRIGIDA ---
class WebSocketOpportunitySignaler extends OpportunitySignaler {
    constructor(sigConfig, signalerLogger, wssInstance) {
        super(sigConfig, signalerLogger);
        this.wss = wssInstance;
        this.opportunities = [];
        this.maxOpportunities = 30; // Pode ajustar
    }
    signal(opportunity) {
        super.signal(opportunity); // Chama o método original para logar no arquivo
        // Adiciona a oportunidade a uma lista interna para novos clientes
        const existingIndex = this.opportunities.findIndex(op => op.pair === opportunity.pair && op.direction === opportunity.direction);
        if (existingIndex > -1) this.opportunities.splice(existingIndex, 1);
        this.opportunities.unshift(opportunity); 
        if (this.opportunities.length > this.maxOpportunities) this.opportunities.pop();
        // Envia a nova oportunidade para TODOS os clientes conectados
        broadcastToClients(this.wss, { type: 'opportunity', data: opportunity });
    }
    getOpportunities() { 
        return this.opportunities; 
    }
}


// --- MIDDLEWARES E SESSÃO ---
const mySessionStore = new SequelizeStore({ db: sequelize });
const sessionMiddleware = session({
    secret: process.env.SESSION_SECRET,
    store: mySessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, secure: process.env.NODE_ENV === 'production', maxAge: 7 * 24 * 60 * 60 * 1000 }
});
mySessionStore.sync();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(sessionMiddleware);
app.use(express.static(path.join(__dirname, 'public')));


// --- WEBSOCKET SERVER COM VERIFICAÇÃO DE SESSÃO ---
const wss = new WebSocket.Server({ noServer: true });
server.on('upgrade', (request, socket, head) => {
    sessionMiddleware(request, {}, () => {
        if (!request.session.userId) {
            socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
            socket.destroy();
            logger.warn("Blocked unauthorized WebSocket upgrade attempt.");
            return;
        }
        wss.handleUpgrade(request, socket, head, (ws) => {
            ws.userId = request.session.userId;
            wss.emit('connection', ws, request);
        });
    });
});
logger = createLoggerWithWSS(wss, config);


// --- Associações e Instâncias ---
User.hasOne(UserConfiguration);
UserConfiguration.belongsTo(User);
config.mexc.api_key = process.env.MY_MEXC_API_KEY;
config.mexc.api_secret = process.env.MY_MEXC_API_SECRET;
config.gateio.api_key = process.env.MY_GATEIO_API_KEY;
config.gateio.api_secret = process.env.MY_GATEIO_API_SECRET;

const connectors = { mexc: new MEXCConnector(config.mexc, logger), gateio: new GateConnector(config.gateio, logger) };
const opportunitySignaler = new WebSocketOpportunitySignaler(config.signaling, logger, wss);
const arbitrageEngine = new ArbitrageEngine(config, opportunitySignaler, logger);
let marketMonitor;

// --- ROTAS E LÓGICA DE INICIALIZAÇÃO ---
setupRoutes();
initializeAndStartBot();


// --- FUNÇÕES DE SETUP ---
function setupRoutes() {
    const userRoutes = require('./routes/user.routes');
    app.use('/api/users', userRoutes);

    const isAuthenticated = (req, res, next) => {
        if (req.session && req.session.userId) return next();
        res.redirect('/login.html');
    };
    
    app.get('/', isAuthenticated, (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
    app.get('/settings.html', isAuthenticated, (req, res) => res.sendFile(path.join(__dirname, 'public', 'settings.html')));
    
    app.get('/api/opportunities', isAuthenticated, (req, res) => res.json(opportunitySignaler.getOpportunities()));
    app.get('/api/config', isAuthenticated, (req, res) => res.json({ arbitrage: config.arbitrage }));
}

function setupWebSockets() {
    wss.on('connection', (wsClient, req) => {
        logger.info(`User ${wsClient.userId} connected via WebSocket.`);
        // Envia dados iniciais ao novo cliente conectado
        try {
            wsClient.send(JSON.stringify({ type: 'opportunities', data: opportunitySignaler.getOpportunities() }));
            if (marketMonitor) wsClient.send(JSON.stringify({ type: 'all_pairs_update', data: marketMonitor.getAllMarketData() }));
        } catch(e) {
            logger.error(`Error sending initial data to user ${wsClient.userId}: ${e.message}`);
        }

        wsClient.on('close', () => logger.info(`User ${wsClient.userId} disconnected.`));
    });
}

async function initializeAndStartBot() {
    logger.info("Initializing bot with Centralized Scanner model...");
    try {
        const pairsByExchange = {
            mexc: await fetchAndFilterPairs(connectors.mexc, "MEXC", config.mexc),
            gateio: await fetchAndFilterPairs(connectors.gateio, "GateIO", config.gateio)
        };
        
        const broadcastCallback = () => {
            if (marketMonitor) broadcastToClients(wss, { type: 'all_pairs_update', data: marketMonitor.getAllMarketData() });
        };
        
        marketMonitor = new MarketMonitor(connectors, pairsByExchange, arbitrageEngine, logger, config, broadcastCallback);
        
        if (Object.keys(connectors).length > 0 && (pairsByExchange.mexc?.length > 0 || pairsByExchange.gateio?.length > 0)) {
            marketMonitor.start();
        } else {
            logger.error("[CRITICAL] No exchanges or pairs found. Bot will be idle.");
        }
    } catch (error) {
        logger.error(`[CRITICAL] Failed to initialize bot logic: ${error.message}`);
    }
}

async function fetchAndFilterPairs(connector, exchangeName, exchangeConfig) {
    if (!connector) return [];
    try {
        const pairs = await connector.getFuturesContractDetail();
        if (!pairs.success || !Array.isArray(pairs.data)) { logger.warn(`Could not fetch pairs for ${exchangeName}.`); return []; }
        const blacklist = (exchangeConfig.blacklisted_tokens || "").split(',').map(t => t.trim().toUpperCase());
        return pairs.data.filter(c => c.quoteCoin === "USDT" && c.settleCoin === "USDT").map(c => c.symbol.replace("_", "/")).filter(p => !blacklist.includes(p.split('/')[0]));
    } catch (error) {
        logger.error(`[fetchAndFilterPairs] Error for ${exchangeName}: ${error.message}`);
        return [];
    }
}

// --- INÍCIO DA EXECUÇÃO ---
sequelize.sync()
    .then(() => {
        mySessionStore.sync();
        logger.info("Database and session store synchronized.");
        const PORT = process.env.PORT || 3000;
        server.listen(PORT, () => {
            logger.info(`Server listening on port ${PORT}.`);
            setupWebSockets(); // O setup do WebSocket agora depende do server estar ouvindo
            initializeAndStartBot();
        });
    })
    .catch(err => {
        logger.error(`[CRITICAL] Could not connect/sync to the database: ${err.message}`);
        process.exit(1);
    });

// --- LÓGICA DE ENCERRAMENTO ---
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
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);