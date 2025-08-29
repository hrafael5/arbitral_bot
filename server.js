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

// --- 2. DEFINIÇÃO DE FUNÇÕES E CLASSES AUXILIARES ---

const broadcastToClients = (wssInstance, data) => {
    if (!wssInstance || !wssInstance.clients) return;
    const message = JSON.stringify(data);
    wssInstance.clients.forEach(c => {
        if (c.readyState === WebSocket.OPEN && c.userId) {
            // Filtra oportunidades >1% para usuários 'free' no momento do broadcast
            if (data.type === 'opportunities' && c.subscriptionStatus === 'free') {
                const filteredData = {
                    ...data,
                    data: data.data.filter(op => op.netSpreadPercentage < 1.0)
                };
                c.send(JSON.stringify(filteredData));
                return;
            }
            c.send(message);
        }
    });
};

function createLoggerWithWSS(wssInstance, currentConfig) {
    const logLevel = (currentConfig.general && currentConfig.general.log_level) || "info";
    const log = (level, msg) => {
        const formattedMsg = `[${level.toUpperCase()}] ${new Date().toISOString()} - ${msg}`;
        if (level === 'error') console.error(formattedMsg);
        else if (level === 'warn') console.warn(formattedMsg);
        else console.log(formattedMsg);
    };
    return {
        info: (msg) => log('info', msg),
        warn: (msg) => log('warn', msg),
        error: (msg) => log('error', msg),
        debug: (msg) => { if (logLevel === "debug") log('debug', msg); }
    };
}

class WebSocketOpportunitySignaler extends OpportunitySignaler {
    constructor(sigConfig, signalerLogger) {
        super(sigConfig, signalerLogger);
        this.opportunities = [];
        this.maxOpportunities = 50;
    }

    signal(opportunity) {
        super.signal(opportunity);

        const existingIndex = this.opportunities.findIndex(op => op.pair === opportunity.pair && op.direction === opportunity.direction);
        
        opportunity.lastSeen = Date.now();

        if (existingIndex > -1) {
            opportunity.firstSeen = this.opportunities[existingIndex].firstSeen;
            this.opportunities[existingIndex] = opportunity;
        } else {
            opportunity.firstSeen = Date.now();
            this.opportunities.unshift(opportunity);

            if (this.opportunities.length > this.maxOpportunities) {
                this.opportunities.pop();
            }
        }
    }

    pruneStaleOpportunities(currentTime, ttl) {
        this.opportunities = this.opportunities.filter(op => (currentTime - op.lastSeen) < ttl);
    }

    getOpportunities() { 
        return this.opportunities; 
    }
}

const createMasterUser = async () => {
    const masterEmail = process.env.MASTER_USER_EMAIL;
    const masterPassword = process.env.MASTER_USER_PASSWORD;

    if (!masterEmail || !masterPassword) {
        logger.info('[MasterUser] Credenciais de usuário mestre não definidas no arquivo .env. Pulando criação.');
        return;
    }

    try {
        const existingUser = await User.findOne({ where: { email: masterEmail } });

        if (!existingUser) {
            const masterUser = await User.create({
                name: 'Master Admin',
                email: masterEmail,
                password: masterPassword,
                subscriptionStatus: 'active', // Define o usuário como premium
                emailVerified: true // Já considera o email como verificado
            });
            await UserConfiguration.create({ UserId: masterUser.id });
            logger.info(`[MasterUser] Usuário mestre '${masterEmail}' criado com sucesso.`);
        } else {
            logger.info(`[MasterUser] Usuário mestre '${masterEmail}' já existe.`);
        }
    } catch (error) {
        logger.error(`[MasterUser] Erro ao criar o usuário mestre: ${error.message}`);
    }
};

async function fetchAndFilterPairs(connector, exchangeName, exchangeConfig) {
    if (!connector) return [];
    try {
        logger.info(`[${exchangeName}] Starting to fetch futures contract details...`);
        const pairs = await connector.getFuturesContractDetail();
        
        if (!pairs.success || !Array.isArray(pairs.data)) { 
            logger.warn(`[${exchangeName}] Could not fetch pairs.`); 
            return [];
        }
        
        const blacklist = (exchangeConfig.blacklisted_tokens || "").split(",").map(t => t.trim().toUpperCase());
        const filteredPairs = pairs.data
            .filter(c => c.quoteCoin === "USDT" && c.settleCoin === "USDT")
            .map(c => c.symbol.replace("_", "/"))
            .filter(p => !blacklist.includes(p.split("/")[0]));
        
        logger.info(`[${exchangeName}] Successfully fetched ${filteredPairs.length} pairs.`);
        return filteredPairs;
        
    } catch (error) {
        logger.error(`[fetchAndFilterPairs] Error for ${exchangeName}: ${error.message}`);
        return [];
    }
}

// --- 3. CONFIGURAÇÃO PRINCIPAL E INICIALIZAÇÃO ---

const config = ini.parse(fs.readFileSync(path.resolve(__dirname, "conf.ini"), "utf-8"));
const app = express();
const server = http.createServer(app);

const corsOptions = {
  origin: process.env.NODE_ENV === 'production' 
    ? ['https://app.arbflash.com', 'https://arbflash.com'] 
    : 'http://localhost:3000',
  credentials: true
};

app.set('trust proxy', 1);
app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginOpenerPolicy: { policy: "same-origin-allow-popups" },
}));
app.use(cors(corsOptions));
app.use(compression());

const mySessionStore = new SequelizeStore({ db: sequelize });
const sessionMiddleware = session({
    secret: process.env.SESSION_SECRET,
    store: mySessionStore,
    resave: false,
    saveUninitialized: false,
    proxy: true,
    cookie: {
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true,
        maxAge: 7 * 24 * 60 * 60 * 1000,
        sameSite: 'lax'
    }
});
app.use(sessionMiddleware);

const wss = new WebSocket.Server({ noServer: true });
const logger = createLoggerWithWSS(wss, config);

User.hasOne(UserConfiguration);
UserConfiguration.belongsTo(User);

config.mexc.api_key = process.env.MY_MEXC_API_KEY;
config.mexc.api_secret = process.env.MY_MEXC_API_SECRET;
config.gateio.api_key = process.env.MY_GATEIO_API_KEY;
config.gateio.api_secret = process.env.MY_GATEIO_API_SECRET;

const connectors = { mexc: new MEXCConnector(config.mexc, logger), gateio: new GateConnector(config.gateio, logger) };
const opportunitySignaler = new WebSocketOpportunitySignaler(config.signaling, logger);
const arbitrageEngine = new ArbitrageEngine(config, opportunitySignaler, logger);
let marketMonitor;

// --- 4. DEFINIÇÃO DE ROTAS E LÓGICA DE EXECUÇÃO ---

const paymentRoutes = require('./routes/payment.routes');
app.use('/api/payments', paymentRoutes);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(express.static(path.join(__dirname, 'public')));

const userRoutes = require('./routes/user.routes');
app.use('/api/users', userRoutes);

const passwordResetRoutes = require('./routes/passwordReset.routes');
app.use('/api/users', passwordResetRoutes);

const isAuthenticated = (req, res, next) => {
    if (req.session && req.session.userId) {
        return next();
    }
    res.status(401).json({ message: "Acesso não autorizado. Por favor, faça login para continuar." });
};

app.post('/api/config/arbitrage', isAuthenticated, (req, res) => {
    const { enableFuturesVsFutures } = req.body;
    if (typeof enableFuturesVsFutures === 'boolean') {
        config.arbitrage.enable_futures_vs_futures = enableFuturesVsFutures;
        logger.info(`Strategy 'Futures vs Futures' was ${enableFuturesVsFutures ? 'ATIVADA' : 'DESATIVADA'} pelo utilizador ${req.session.userId}.`);
        res.status(200).json({ success: true, message: 'Configuração de Futuros vs Futuros atualizada.' });
    } else {
        res.status(400).json({ success: false, message: 'Valor inválido fornecido.' });
    }
});

app.post('/api/config/arbitrage/spot', isAuthenticated, (req, res) => {
    const { enableSpotVsSpot } = req.body;
    if (typeof enableSpotVsSpot === 'boolean') {
        config.arbitrage.enable_spot_vs_spot = enableSpotVsSpot;
        logger.info(`Strategy 'Spot vs Spot' was ${enableSpotVsSpot ? 'ATIVADA' : 'DESATIVADA'} pelo utilizador ${req.session.userId}.`);
        res.status(200).json({ success: true, message: 'Configuração de Spot vs Spot atualizada.' });
    } else {
        res.status(400).json({ success: false, message: 'Valor inválido fornecido.' });
    }
});

app.post('/api/config/update-interval', isAuthenticated, (req, res) => {
    const { interval } = req.body;
    const newInterval = parseInt(interval);

    if (isNaN(newInterval) || newInterval < 200 || newInterval > 5000) {
        return res.status(400).json({ success: false, message: 'Intervalo inválido.' });
    }

    config.general.main_tick_interval_ms = newInterval;
    
    if (marketMonitor && typeof marketMonitor.updateTickInterval === 'function') {
        marketMonitor.updateTickInterval(newInterval);
        logger.info(`Update interval changed to ${newInterval}ms by user ${req.session.userId}.`);
        res.status(200).json({ success: true, message: 'Intervalo de atualização alterado.' });
    } else {
        logger.warn(`Market monitor not running or does not support dynamic interval changes.`);
        res.status(500).json({ success: false, message: 'Não foi possível alterar o intervalo no momento.' });
    }
});

app.get('/api/opportunities', isAuthenticated, (req, res) => res.json(opportunitySignaler.getOpportunities()));
app.get('/api/config', isAuthenticated, (req, res) => res.json({ arbitrage: config.arbitrage, exchanges: config.exchanges }));

server.on('upgrade', (request, socket, head) => {
    sessionMiddleware(request, {}, () => {
        if (!request.session.userId) {
            socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
            socket.destroy();
            return;
        }
        wss.handleUpgrade(request, socket, head, (ws) => {
            ws.userId = request.session.userId;
            wss.emit('connection', ws, request);
        });
    });
});

wss.on("connection", async (wsClient) => {
    logger.info(`User ${wsClient.userId} connected via WebSocket.`);
    try {
        const user = await User.findByPk(wsClient.userId);
        wsClient.subscriptionStatus = user ? user.subscriptionStatus : 'free';
        logger.info(`User ${wsClient.userId} subscription status: ${wsClient.subscriptionStatus}`);

        const initialOpportunities = opportunitySignaler.getOpportunities();
        const initialData = { type: 'opportunities', data: initialOpportunities };
        
        if (wsClient.subscriptionStatus === 'free') {
            initialData.data = initialData.data.filter(op => op.netSpreadPercentage < 1.0);
        }

        wsClient.send(JSON.stringify(initialData));

        if (marketMonitor) {
            wsClient.send(JSON.stringify({ type: 'all_pairs_update', data: marketMonitor.getAllMarketData() }));
        }
    } catch (e) {
        logger.error(`Error sending initial data to user ${wsClient.userId}: ${e.message}`);
    }
    wsClient.on("close", () => logger.info(`User ${wsClient.userId} disconnected.`));
});

async function initializeAndStartBot() {
    logger.info("Initializing bot with Centralized Scanner model...");
    try {
        const startTime = Date.now();
        const [mexcPairsArr, gateioPairsArr] = await Promise.all([
            fetchAndFilterPairs(connectors.mexc, "MEXC", config.mexc),
            fetchAndFilterPairs(connectors.gateio, "GateIO", config.gateio)
        ]);
        const fetchTime = Date.now() - startTime;
        logger.info(`Pairs fetching completed in ${fetchTime}ms`);

        if (mexcPairsArr.length === 0 || gateioPairsArr.length === 0) {
            logger.error("[CRITICAL] Failed to fetch pairs from one or both exchanges. Bot will be idle.");
            return;
        }

        const mexcPairSet = new Set(mexcPairsArr);
        const commonPairs = gateioPairsArr.filter(pair => mexcPairSet.has(pair));
        logger.info(`Found ${commonPairs.length} common pairs between exchanges to monitor.`);

        const pairsByExchange = {
            mexc: commonPairs,
            gateio: commonPairs
        };
        
        const broadcastCallback = () => {
            if (marketMonitor) broadcastToClients(wss, { type: 'all_pairs_update', data: marketMonitor.getAllMarketData() });
        };
        
        marketMonitor = new MarketMonitor(connectors, pairsByExchange, arbitrageEngine, logger, config, broadcastCallback);
        
        if (commonPairs.length > 0) {
            logger.info("Starting market monitor...");
            marketMonitor.start();
            logger.info("Bot initialization completed successfully!");
        } else {
            logger.error("[CRITICAL] No common pairs found between exchanges. Bot will be idle.");
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
app.use((err, req, res, next) => {
  console.error("ERRO INESPERADO:", err.stack);
  res.status(500).json({ message: "Ocorreu um erro inesperado no servidor." });
});


// --- 6. INÍCIO DA EXECUÇÃO ---
sequelize.sync({ alter: true })
    .then(async () => {
        mySessionStore.sync();
        logger.info("Database and session store synchronized.");
        
        await createMasterUser();

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

const BROADCAST_INTERVAL_MS = 1000;
const OPPORTUNITY_TTL_MS = 4000;

setInterval(() => {
    if (opportunitySignaler) {
        opportunitySignaler.pruneStaleOpportunities(Date.now(), OPPORTUNITY_TTL_MS);
        const freshList = opportunitySignaler.getOpportunities();
        broadcastToClients(wss, { type: 'opportunities', data: freshList });
    }
}, BROADCAST_INTERVAL_MS);

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);