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
    wssInstance.clients.forEach(c => {
        if (c.readyState === WebSocket.OPEN && c.userId) {
            if (data.type === 'opportunity' && c.subscriptionStatus === 'free' && data.data.netSpreadPercentage >= 1.0) {
                return;
            }
            c.send(JSON.stringify(data));
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

        // --- LÓGICA CORRIGIDA PARA O TIMESTAMP 'firstSeen' ---
        const existingIndex = this.opportunities.findIndex(op => op.pair === opportunity.pair && op.direction === opportunity.direction);
        
        if (existingIndex > -1) {
            // Se a oportunidade já existe, nós preservamos o timestamp original dela.
            opportunity.firstSeen = this.opportunities[existingIndex].firstSeen;
            this.opportunities[existingIndex] = opportunity; // Atualiza com os novos dados de mercado
        } else {
            // Se for uma oportunidade nova, nós criamos um novo timestamp.
            opportunity.firstSeen = Date.now();
            this.opportunities.unshift(opportunity);
            if (this.opportunities.length > this.maxOpportunities) {
                this.opportunities.pop();
            }
        }

        // Envia para os clientes a oportunidade já com o timestamp 'firstSeen' correto.
        broadcastToClients(this.wss, { type: 'opportunity', data: opportunity });
    }
    getOpportunities() { 
        return this.opportunities; 
    }
}

async function fetchAndFilterPairs(connector, exchangeName, exchangeConfig) {
    if (!connector) return [];
    try {
        logger.info(`[${exchangeName}] Starting to fetch futures contract details...`);
        const maxRetries = 3;
        const timeout = 15000;
        
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                const timeoutPromise = new Promise((_, reject) => 
                    setTimeout(() => reject(new Error("Request timeout")), timeout)
                );
                
                const fetchPromise = connector.getFuturesContractDetail();
                const pairs = await Promise.race([fetchPromise, timeoutPromise]);
                
                if (!pairs.success || !Array.isArray(pairs.data)) { 
                    logger.warn(`[${exchangeName}] Could not fetch pairs (attempt ${attempt}/${maxRetries}).`); 
                    if (attempt === maxRetries) return [];
                    continue;
                }
                
                const blacklist = (exchangeConfig.blacklisted_tokens || "").split(",").map(t => t.trim().toUpperCase());
                const filteredPairs = pairs.data
                    .filter(c => c.quoteCoin === "USDT" && c.settleCoin === "USDT")
                    .map(c => c.symbol.replace("_", "/"))
                    .filter(p => !blacklist.includes(p.split("/")[0]));
                
                logger.info(`[${exchangeName}] Successfully fetched ${filteredPairs.length} pairs.`);
                return filteredPairs;
                
            } catch (attemptError) {
                logger.warn(`[${exchangeName}] Attempt ${attempt}/${maxRetries} failed: ${attemptError.message}`);
                if (attempt === maxRetries) {
                    logger.error(`[${exchangeName}] All attempts failed. Using empty pairs list.`);
                    return [];
                }
                await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
            }
        }
        return [];
    } catch (error) {
        logger.error(`[fetchAndFilterPairs] Error for ${exchangeName}: ${error.message}`);
        return [];
    }
}


// --- 3. CONFIGURAÇÃO PRINCIPAL E INICIALIZAÇÃO ---

const config = ini.parse(fs.readFileSync(path.resolve(__dirname, "conf.ini"), "utf-8"));
const app = express();
const server = http.createServer(app);

// Configuração do CORS para ser mais restritivo em produção
const corsOptions = {
  origin: process.env.NODE_ENV === 'production' 
    ? ['https://app.arbflash.com', 'https://arbflash.com'] 
    : 'http://localhost:3000',
  credentials: true
};

app.set('trust proxy', 1);
app.use(helmet()); // Adiciona cabeçalhos de segurança
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
const opportunitySignaler = new WebSocketOpportunitySignaler(config.signaling, logger, wss);
const arbitrageEngine = new ArbitrageEngine(config, opportunitySignaler, logger);
let marketMonitor;


// --- 4. DEFINIÇÃO DE ROTAS E LÓGICA DE EXECUÇÃO ---

// A rota do webhook do Stripe precisa vir ANTES do express.json()
const paymentRoutes = require('./routes/payment.routes');
app.use('/api/payments', paymentRoutes);

// Agora usamos o express.json() para as outras rotas
app.use(express.json());
app.use(express.urlencoded({ extended: true }));


// Servir os ficheiros estáticos da pasta 'public'
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
        if (user) {
            wsClient.subscriptionStatus = user.subscriptionStatus;
            logger.info(`User ${wsClient.userId} subscription status: ${wsClient.subscriptionStatus}`);
            
            // Ativação automática de estratégias premium
            if (user.subscriptionStatus === 'premium') {
                config.arbitrage.enable_futures_vs_futures = true;
                config.arbitrage.enable_spot_vs_spot = true;
                logger.info(`Premium strategies automatically enabled for user ${wsClient.userId}`);
            }
        } else {
            logger.warn(`User ${wsClient.userId} not found in database.`);
            wsClient.subscriptionStatus = 'free';
        }

        const initialOpportunities = opportunitySignaler.getOpportunities().filter(op => {
            if (wsClient.subscriptionStatus === 'free' && op.netSpreadPercentage >= 1.0) {
                return false;
            }
            return true;
        });
        wsClient.send(JSON.stringify({ type: 'opportunities', data: initialOpportunities }));

        if (marketMonitor) wsClient.send(JSON.stringify({ type: 'all_pairs_update', data: marketMonitor.getAllMarketData() }));
    } catch (e) {
        logger.error(`Error sending initial data to user ${wsClient.userId}: ${e.message}`);
    }
    wsClient.on("close", () => logger.info(`User ${wsClient.userId} disconnected.`));
});

async function initializeAndStartBot() {
    logger.info("Initializing bot with Centralized Scanner model...");
    try {
        const fallbackPairs = {
            mexc: ["BTC/USDT", "ETH/USDT"],
            gateio: ["BTC/USDT", "ETH/USDT"]
        };
        const startTime = Date.now();
        const [mexcPairs, gateioPairs] = await Promise.all([
            fetchAndFilterPairs(connectors.mexc, "MEXC", config.mexc),
            fetchAndFilterPairs(connectors.gateio, "GateIO", config.gateio)
        ]);
        const fetchTime = Date.now() - startTime;
        logger.info(`Pairs fetching completed in ${fetchTime}ms`);

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

// --- 5. ROTA PRINCIPAL E TRATAMENTO DE ERROS ---

// Rota para servir a página principal após todas as outras rotas da API
app.get('/', isAuthenticated, (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// Middleware de tratamento de erros global (deve ser o último)
app.use((err, req, res, next) => {
  console.error("ERRO INESPERADO:", err.stack);
  res.status(500).json({ message: "Ocorreu um erro inesperado no servidor." });
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