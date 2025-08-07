// /lib/WebSocketServer.js
const WebSocket = require('ws');

class WebSocketServer {
    constructor(logger) {
        this.logger = logger;
        this.wss = new WebSocket.Server({ port: 8765 });
        this.clients = new Set();
        this.logger.info('[WebSocketServer] Initialized on ws://localhost:8765');
    }

    start(broadcastCallback) {
        this.wss.on('connection', (ws) => {
            this.logger.info('[WebSocketServer] New client connected');
            this.clients.add(ws);
            ws.on('close', () => {
                this.logger.info('[WebSocketServer] Client disconnected');
                this.clients.delete(ws);
            });
        });
        broadcastCallback(this.broadcast.bind(this));
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