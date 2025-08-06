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

const MEXCConnector = require('./lib/MEXCConnector');
const GateConnector = require('./lib/GateConnector');
const MarketMonitor = require('./lib/MarketMonitor');
const ArbitrageEngine = require('./lib/ArbitrageEngine');
const OpportunitySignaler = require('./lib/OpportunitySignaler');
const { sendPasswordResetEmail } = require('./utils/emailService');

// --- 2. DEFINIÇÃO DE FUNÇÕES E CLASSES AUXILIARES ---

const broadcastToClients = (wssInstance, data) => {
    if (!wssInstance || !wssInstance.clients) return;
    const startTime = Date.now();
    let broadcastCount = 0;
    wssInstance.clients.forEach(c => {
        if (c.readyState === WebSocket.OPEN && c.userId) {
            if (data.type === 'opportunity' && c.subscriptionStatus === 'free' && data.data.netSpreadPercentage >= 1.0) return;
            c.send(JSON.stringify(data));
            broadcastCount++;
        }
    });
    const duration = Date.now() - startTime;
    if (duration > 100) {
        console.log(`[WebSocket] Broadcast took ${duration}ms for ${broadcastCount} clients at ${new Date().toISOString()}`);
    }
};

function createLoggerWithWSS(wssInstance, currentConfig) {
    const logLevel = (currentConfig.general && currentConfig.general.log_level) || "info";
    const log = (level, msg) => {
        const formattedMsg = `[${level.toUpperCase()}] ${new Date().toISOString()} - ${msg}`;
        if (level === 'error') {
            console.error(formattedMsg);
            // Enviar notificação por e-mail para erros críticos
            if (msg.includes('[CRITICAL]') || msg.includes('[RateLimit]')) {
                sendPasswordResetEmail('admin@arbflash.com', 'Erro Crítico no Servidor', formattedMsg)
                    .catch(err => console.error('[Email] Failed to send error notification:', err));
            }
        } else if (level === 'warn') {
            console.warn(formattedMsg);
        } else {
            console.log(formattedMsg);
        }
        
        if (wssInstance) {
            broadcastToClients(wssInstance, { type: 'log', level, message: msg });
        }
    };
    return {
        info: (msg) => log('info', msg),
        error: (msg) => log('error', msg),
        warn: (msg) => log('warn', msg)
    };
}

// Função para limitar a frequência de broadcasting
function throttleBroadcast(wss, data, interval = 500) {
    if (!wss.lastBroadcast || (Date.now() - wss.lastBroadcast > interval)) {
        broadcastToClients(wss, data);
        wss.lastBroadcast = Date.now();
    }
}

const broadcastCallback = (data) => {
    if (wss) {
        throttleBroadcast(wss, { type: 'update', data }, 200); // Limita a 5 atualizações por segundo
    }
};

// --- 3. CONFIGURAÇÃO DO SERVIDOR ---
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(helmet());
app.use(cors({ origin: process.env.APP_BASE_URL || 'http://localhost:3000', credentials: true }));
app.use(compression());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const mySessionStore = new SequelizeStore({
    db: sequelize,
    tableName: 'Sessions'
});

app.use(session({
    secret: process.env.SESSION_SECRET || 'default_secret',
    resave: false,
    saveUninitialized: false,
    store: mySessionStore,
    cookie: { secure: process.env.NODE_ENV === 'production' }
}));

function isAuthenticated(req, res, next) {
    if (!req.session.userId) return res.status(401).json({ message: 'Unauthorized' });
    next();
}

// --- 4. LÓGICA DO BOT ---
let marketMonitor = null;
let arbitrageEngine = null;
let logger = null;
let connectors = {};
let pairsByExchange = { mexc: [], gateio: [] };

const initializeAndStartBot = () => {
    try {
        const configFile = fs.readFileSync(path.join(__dirname, 'conf.ini'), 'utf-8');
        const currentConfig = ini.parse(configFile);

        logger = createLoggerWithWSS(wss, currentConfig);

        // Configurar conectores
        connectors.mexc = new MEXCConnector(currentConfig.mexc, logger);
        connectors.gateio = new GateConnector(currentConfig.gateio, logger);

        // Carregar pares de monitoramento
        pairsByExchange.mexc = (currentConfig.mexc.debug_pairs || '').split(',').map(p => p.trim()).filter(p => p);
        pairsByExchange.gateio = (currentConfig.gateio.debug_pairs || '').split(',').map(p => p.trim()).filter(p => p);

        // Inicializar engine e signaler
        const signaler = new OpportunitySignaler(currentConfig.signaling, logger);
        arbitrageEngine = new ArbitrageEngine(currentConfig, signaler, logger);

        // Inicializar monitor de mercado
        marketMonitor = new MarketMonitor(connectors, pairsByExchange, arbitrageEngine, logger, currentConfig, broadcastCallback);
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

// --- 5. ROTA PRINCIPAL E TRATAMENTO DE ERROS ---

// Rota para servir a página principal após todas as outras rotas da API
app.get('/', isAuthenticated, (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// Middleware de tratamento de erros global (deve ser o último)
app.use((err, req, res, next) => {
    console.error("ERRO INESPERADO:", err.stack);
    res.status(500).json({ message: "Ocorreu um erro inesperado no servidor." });
});

wss.on('connection', (ws) => {
    ws.userId = null;
    ws.subscriptionStatus = 'free';
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            if (data.type === 'auth' && data.userId) {
                ws.userId = data.userId;
                ws.subscriptionStatus = data.subscriptionStatus || 'free';
                logger.info(`[WebSocket] User ${ws.userId} connected with status ${ws.subscriptionStatus}`);
            }
        } catch (e) {
            logger.error(`[WebSocket] Invalid message: ${e.message}`);
        }
    });
    ws.on('close', () => {
        logger.info(`[WebSocket] User ${ws.userId} disconnected`);
    });
});

// --- 6. INÍCIO DA EXECUÇÃO ---
sequelize.sync({ alter: true })
    .then(() => {
        mySessionStore.sync();
        logger.info("Database and session store synchronized.");
        const PORT = process.env.PORT || 3000;
        server.listen(PORT, () => {
            logger.info(`Server listening on port ${PORT}.`);
            initializeAndStartBot();
        });
    })
    .catch(err => {
        logger.error(`[CRITICAL] Could not connect/sync to the database: ${err.message}`);
        process.exit(1);
    });

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);