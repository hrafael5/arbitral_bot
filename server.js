// server.js (Revisado)

// A linha abaixo deve ser a PRIMEIRA LINHA do seu ficheiro
require('dotenv').config();

// --- 1. DEPENDÊNCIAS ---
const express = require('express');
const http = require('http');
const cors = require('cors');
const helmet = require('helmet'); // <-- ADICIONADO para segurança
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

// Dependências da lógica do Bot
const MEXCConnector = require('./lib/MEXCConnector');
const GateConnector = require('./lib/GateConnector');
const MarketMonitor = require('./lib/MarketMonitor');
const ArbitrageEngine = require('./lib/ArbitrageEngine');
const OpportunitySignaler = require('./lib/OpportunitySignaler');

// --- 2. DEFINIÇÃO DE FUNÇÕES E CLASSES AUXILIARES (Lógica do Bot) ---

const broadcastToClients = (wssInstance, data) => {
    if (!wssInstance || !wssInstance.clients) return;
    wssInstance.clients.forEach(c => {
        if (c.readyState === WebSocket.OPEN && c.userId) {
            // Lógica Freemium
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
};

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
        if (existingIndex > -1) this.opportunities.splice(existingIndex, 1);
        this.opportunities.unshift(opportunity);
        if (this.opportunities.length > this.maxOpportunities) this.opportunities.pop();
        broadcastToClients(this.wss, { type: 'opportunity', data: opportunity });
    }
    getOpportunities() { return this.opportunities; }
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

// --- 3. CONFIGURAÇÃO PRINCIPAL E MIDDLEWARES ---

const config = ini.parse(fs.readFileSync(path.resolve(__dirname, "conf.ini"), "utf-8"));
const app = express();
const server = http.createServer(app);

// Configuração do CORS para ser mais restritivo em produção
const corsOptions = {
  origin: process.env.NODE_ENV === 'production' 
    ? ['https://app.arbflash.com', 'https://arbflash.com'] // <-- MUDANÇA AQUI
    : 'http://localhost:3000',
  credentials: true
};

app.set('trust proxy', 1);
app.use(helmet()); // <-- MUDANÇA AQUI: Adiciona cabeçalhos de segurança
app.use(cors(corsOptions)); // <-- MUDANÇA AQUI: Usa a configuração segura
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
        sameSite: 'lax' // <-- MUDANÇA AQUI: Proteção contra CSRF
    }
});
app.use(sessionMiddleware);

const wss = new WebSocket.Server({ noServer: true });
const logger = createLoggerWithWSS(wss, config);

User.hasOne(UserConfiguration);
UserConfiguration.belongsTo(User);

// Carregar chaves de API para a configuração
config.mexc.api_key = process.env.MY_MEXC_API_KEY;
config.mexc.api_secret = process.env.MY_MEXC_API_SECRET;
config.gateio.api_key = process.env.MY_GATEIO_API_KEY;
config.gateio.api_secret = process.env.MY_GATEIO_API_SECRET;

// Inicialização dos componentes do Bot
const connectors = { mexc: new MEXCConnector(config.mexc, logger), gateio: new GateConnector(config.gateio, logger) };
const opportunitySignaler = new WebSocketOpportunitySignaler(config.signaling, logger, wss);
const arbitrageEngine = new ArbitrageEngine(config, opportunitySignaler, logger);
let marketMonitor;


// --- 4. DEFINIÇÃO DE ROTAS ---

// A rota do webhook do Stripe precisa vir ANTES do express.json()
const paymentRoutes = require('./routes/payment.routes');
app.use('/api/payments', paymentRoutes);

// Middlewares para parsear o corpo das requisições
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
    res.status(401).json({ message: "Acesso não autorizado." });
};

app.post('/api/config/arbitrage', isAuthenticated, (req, res) => {
    // ... (Sua rota original)
});

app.post('/api/config/arbitrage/spot', isAuthenticated, (req, res) => {
    // ... (Sua rota original)
});

app.get('/api/opportunities', isAuthenticated, (req, res) => res.json(opportunitySignaler.getOpportunities()));
app.get('/api/config', isAuthenticated, (req, res) => res.json({ arbitrage: config.arbitrage, exchanges: { mexc: config.mexc, gateio: config.gateio } }));

// Rotas para servir os ficheiros HTML protegidos
app.get('/', isAuthenticated, (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));


// --- 5. LÓGICA DO WEBSOCKET ---

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
        } else {
            wsClient.subscriptionStatus = 'free'; // Default seguro
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


// --- 6. INICIALIZAÇÃO E SHUTDOWN DO BOT ---

async function initializeAndStartBot() {
    // ... (Sua função original)
    logger.info("Initializing bot with Centralized Scanner model...");
    // ... etc.
}

const shutdown = () => {
    // ... (Sua função original)
    logger.info("Shutting down...");
    // ... etc.
};


// --- 7. ERROS E INÍCIO DA EXECUÇÃO ---

// Middleware de tratamento de erros global
app.use((err, req, res, next) => {
  console.error("ERRO INESPERADO:", err.stack);
  res.status(500).json({ message: "Ocorreu um erro inesperado no servidor." });
});

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