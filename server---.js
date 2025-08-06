// /server.js (VERSÃO COM GATE.IO DESATIVADA PARA TESTE)

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
// const GateConnector = require('./lib/GateConnector'); // <<-- DESATIVADO TEMPORARIAMENTE
const MarketMonitor = require('./lib/MarketMonitor');
const ArbitrageEngine = require('./lib/ArbitrageEngine');
const OpportunitySignaler = require('./lib/OpportunitySignaler');


// --- 2. FUNÇÕES AUXILIARES E CLASSES ---

function broadcastToClients(wssInstance, data) {
    if (!wssInstance || !wssInstance.clients) return;
    wssInstance.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN && client.userId) {
            if (data.type === 'opportunity' && client.subscriptionStatus === 'free' && data.data.netSpreadPercentage >= 1.0) {
                return;
            }
            client.send(JSON.stringify(data));
        }
    });
};

function createLoggerWithWSS(wssInstance, currentConfig) {
    const logLevel = currentConfig.general?.log_level || "info";
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
    constructor(sigConfig, signalerLogger, wssInstance) {
        super(sigConfig, signalerLogger);
        this.wss = wssInstance;
        this.opportunities = [];
        this.maxOpportunities = 50;
    }
    
    signal(opportunity) {
        super.signal(opportunity);
        const existingIndex = this.opportunities.findIndex(op => op.pair === opportunity.pair && op.direction === opportunity.direction);
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
        broadcastToClients(this.wss, { type: 'opportunity', data: opportunity });
    }

    getOpportunities() { 
        return this.opportunities; 
    }
}

async function fetchAndFilterPairs(connector, exchangeName, exchangeConfig, logger) {
    if (!connector) return [];
    try {
        logger.info(`[${exchangeName}] Iniciando busca de detalhes de contratos de futuros...`);
        const pairs = await connector.getFuturesContractDetail();
        if (!pairs.success || !Array.isArray(pairs.data)) { 
            logger.warn(`[${exchangeName}] Não foi possível buscar os pares.`); 
            return [];
        }
        const blacklist = (exchangeConfig.blacklisted_tokens || "").split(",").map(t => t.trim().toUpperCase());
        const filteredPairs = pairs.data
            .filter(c => c.quoteCoin === "USDT" && c.settleCoin === "USDT")
            .map(c => c.symbol.replace("_", "/"))
            .filter(p => !blacklist.includes(p.split("/")[0]));
        logger.info(`[${exchangeName}] Sucesso! ${filteredPairs.length} pares encontrados e filtrados.`);
        return filteredPairs;
    } catch (error) {
        logger.error(`[fetchAndFilterPairs] Erro para ${exchangeName}: ${error.message}`);
        return [];
    }
}


// --- 3. CONFIGURAÇÃO PRINCIPAL E INICIALIZAÇÃO ---
// ... (O resto do seu código de configuração do express, session, etc. continua aqui)
// (Vou omitir para não ser repetitivo, pois essa parte está correta)
const config = ini.parse(fs.readFileSync(path.resolve(__dirname, "conf.ini"), "utf-8"));
const app = express();
const server = http.createServer(app);

const corsOptions = {
    origin: process.env.NODE_ENV === 'production' ? ['https://app.arbflash.com', 'https://arbflash.com'] : 'http://localhost:3000',
    credentials: true
};
app.set('trust proxy', 1);
app.use(helmet());
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


// --- 4. LÓGICA DO BOT ---

const connectors = { 
    mexc: new MEXCConnector(config.mexc, logger), 
    // gateio: new GateConnector(config.gateio, logger) // <<-- DESATIVADO TEMPORARIAMENTE
};
const opportunitySignaler = new WebSocketOpportunitySignaler(config.signaling, logger, wss);
const arbitrageEngine = new ArbitrageEngine(config, opportunitySignaler, logger);
let marketMonitor;

async function initializeAndStartBot() {
    logger.info("Inicializando a lógica do bot...");

    const IS_TEST_MODE = true; 
    let pairsByExchange;

    if (IS_TEST_MODE) {
        logger.warn(">>> MODO DE TESTE ATIVO <<< Usando lista de pares fixa (BTC, ETH).");
        pairsByExchange = {
            mexc: ["BTC/USDT", "ETH/USDT"],
            // gateio: ["BTC/USDT", "ETH/USDT"] // <<-- DESATIVADO TEMPORARIAMENTE
        };
    } else {
        logger.info("Modo de produção. Buscando pares dinamicamente...");
        const mexcPairs = await fetchAndFilterPairs(connectors.mexc, "MEXC", config.mexc, logger);
        pairsByExchange = {
            mexc: mexcPairs.length > 0 ? mexcPairs : ["BTC/USDT", "ETH/USDT"],
        };
        if (mexcPairs.length === 0) logger.warn("Usando pares de fallback para MEXC.");
    }
    
    const broadcastCallback = () => {
        if (marketMonitor) broadcastToClients(wss, { type: 'all_pairs_update', data: marketMonitor.getAllMarketData() });
    };

    marketMonitor = new MarketMonitor(connectors, pairsByExchange, arbitrageEngine, logger, config, broadcastCallback);
    marketMonitor.start();
    
    logger.info("Bot inicializado e a monitorar o mercado!");
}


// --- 5. ROTAS DA API E SERVIDOR WEBSOCKET ---
// ... (Seu código de rotas continua aqui, ele está correto)
// (Vou omitir para não ser repetitivo)
const paymentRoutes = require('./routes/payment.routes');
app.use('/api/payments', paymentRoutes);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
const userRoutes = require('./routes/user.routes');
app.use('/api/users', userRoutes);
const passwordResetRoutes = require('./routes/passwordReset.routes');
app.use('/api/users', passwordResetRoutes);

const isAuthenticated = (req, res, next) => {
    if (req.session && req.session.userId) return next();
    res.status(401).json({ message: "Acesso não autorizado." });
};

app.get('/api/config', isAuthenticated, (req, res) => res.json({ arbitrage: config.arbitrage, exchanges: config.exchanges }));
app.use(express.static(path.join(__dirname, 'public')));
app.get('*', isAuthenticated, (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

server.on('upgrade', (request, socket, head) => {
    sessionMiddleware(request, {}, () => {
        if (!request.session.userId) {
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
    logger.info(`Utilizador ${wsClient.userId} conectou-se via WebSocket.`);
    try {
        const user = await User.findByPk(wsClient.userId);
        wsClient.subscriptionStatus = user ? user.subscriptionStatus : 'free';
        const initialOpportunities = opportunitySignaler.getOpportunities().filter(op => 
            !(wsClient.subscriptionStatus === 'free' && op.netSpreadPercentage >= 1.0)
        );
        wsClient.send(JSON.stringify({ type: 'opportunities', data: initialOpportunities }));
        if (marketMonitor) wsClient.send(JSON.stringify({ type: 'all_pairs_update', data: marketMonitor.getAllMarketData() }));
    } catch (e) {
        logger.error(`Erro ao enviar dados iniciais para o utilizador ${wsClient.userId}: ${e.message}`);
    }
    wsClient.on("close", () => logger.info(`Utilizador ${wsClient.userId} desconectou-se.`));
});

app.use((err, req, res, next) => {
  console.error("ERRO INESPERADO:", err.stack);
  res.status(500).json({ message: "Ocorreu um erro inesperado no servidor." });
});


// --- 6. INÍCIO DA EXECUÇÃO E SHUTDOWN ---

sequelize.sync({ alter: true })
    .then(() => {
        mySessionStore.sync();
        logger.info("Base de dados e sessão sincronizadas.");
        const PORT = process.env.PORT || 3000;
        server.listen(PORT, () => {
            logger.info(`Servidor a escutar na porta ${PORT}.`);
            initializeAndStartBot();
        });
    })
    .catch(err => {
        logger.error(`[CRÍTICO] Não foi possível conectar/sincronizar com a base de dados: ${err.message}`);
        process.exit(1);
    });

const shutdown = () => {
    logger.info("A desligar o servidor de forma graciosa...");
    if (marketMonitor) marketMonitor.stop();
    server.close(() => {
        logger.info("Servidor fechado.");
        sequelize.close().then(() => logger.info("Conexão com a base de dados fechada."));
        process.exit(0);
    });
    setTimeout(() => { logger.warn("Forçando o encerramento após timeout."); process.exit(1); }, 10000);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);