// /lib/WebSocketServer.js
const WebSocket = require('ws');

class WebSocketServer {
    constructor(logger, server) {
        this.logger = logger;
        this.wss = new WebSocket.Server({ server }); // Usa o servidor HTTP passado como parâmetro
        this.clients = new Set();
        this.logger.info('[WebSocketServer] Initialized on WebSocket server');
    }

    start(broadcastCallback) {
        this.wss.on('connection', (ws) => {
            this.logger.info('[WebSocketServer] New client connected');
            this.clients.add(ws);

            // Manter a conexão viva com ping/pong (opcional, mas recomendado)
            ws.isAlive = true;
            ws.on('pong', () => {
                ws.isAlive = true;
            });

            ws.on('close', () => {
                this.logger.info('[WebSocketServer] Client disconnected');
                this.clients.delete(ws);
            });

            // Tratar mensagens recebidas (se necessário)
            ws.on('message', (message) => {
                this.logger.debug('[WebSocketServer] Message received from client:', message.toString());
                // Adicione lógica para processar mensagens, se aplicável
            });

            // Enviar ping periodicamente para verificar conexões
            const pingInterval = setInterval(() => {
                if (ws.isAlive === false) {
                    this.logger.warn('[WebSocketServer] Client timeout, terminating connection');
                    return ws.terminate();
                }
                ws.isAlive = false;
                ws.ping(() => {});
            }, 30000); // Ping a cada 30 segundos

            ws.on('close', () => {
                clearInterval(pingInterval);
            });
        });

        // Registrar a função de broadcast para ser usada externamente
        if (broadcastCallback) {
            broadcastCallback(this.broadcast.bind(this));
        }
    }

    broadcast(data) {
        const message = JSON.stringify(data);
        this.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                try {
                    client.send(message);
                } catch (error) {
                    this.logger.error(`[WebSocketServer] Error broadcasting to client: ${error.message}`);
                }
            }
        });
    }

    close() {
        this.wss.close();
        this.logger.info('[WebSocketServer] Closed');
    }
}

module.exports = WebSocketServer;