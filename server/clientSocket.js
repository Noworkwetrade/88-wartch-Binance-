/**
 * Client WebSocket Server
 * Connects frontend clients to live Binance Market Data and NWWT Scanner
 *
 * Implements high-frequency update batching:
 * Buffers incoming ticker updates and broadcasts them in batches every 80ms,
 * preventing hundreds of individual DOM reflows and reducing CPU overhead.
 */

import { WebSocketServer, WebSocket } from 'ws';
import { marketCache } from './marketCache.js';
import { binanceSocket } from './binanceSocket.js';
import { symbolManager } from './symbolManager.js';
import { scannerService } from './scannerService.js';

class ClientSocketServer {
  constructor() {
    /** @type {WebSocketServer|null} */
    this.wss = null;
    /** @type {Set<WebSocket>} */
    this.clients = new Set();
    this.batchInterval = null;
    this.heartbeatInterval = null;
  }

  attach(httpServer, path = '/ws') {
    this.wss = new WebSocketServer({
      server: httpServer,
      path: path
    });

    console.log(`[clientSocket] Client WebSocket server listening on: ${path}`);

    this.wss.on('connection', (ws, req) => {
      this.handleConnection(ws, req);
    });

    // Wire up status updates
    binanceSocket.onStatusChange((status, stats) => {
      this.broadcastStatus(status, stats);
    });

    // Start 80ms batch broadcasting loop
    this.startBatchBroadcast();
    this.startHeartbeat();
  }

  handleConnection(ws, req) {
    ws.isAlive = true;
    this.clients.add(ws);
    const ip = req.socket.remoteAddress;
    console.log(`[clientSocket] Frontend client connected from ${ip}. Total clients: ${this.clients.size}`);

    ws.on('pong', () => {
      ws.isAlive = true;
    });

    ws.on('message', (message) => {
      try {
        const parsed = JSON.parse(message.toString());
        if (parsed.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
        } else if (parsed.type === 'request_snapshot') {
          this.sendSnapshot(ws);
        } else if (parsed.type === 'run_scan') {
          if (parsed.timeframe) {
            scannerService.timeframe = parsed.timeframe;
          }
          if (parsed.htfConfirmationEnabled !== undefined) {
            scannerService.htfConfirmationEnabled = Boolean(parsed.htfConfirmationEnabled);
          }
          if (parsed.htfTimeframe) {
            scannerService.htfTimeframe = parsed.htfTimeframe;
          }
          if (parsed.htfRuleMode) {
            scannerService.htfRuleMode = parsed.htfRuleMode;
          }
          scannerService.runScan(parsed.timeframe || scannerService.timeframe).then(() => {
            this.sendScannerData(ws);
          });
        } else if (parsed.type === 'update_scanner_config') {
          scannerService.setScannerConfig(parsed);
          this.sendScannerData(ws);
        }
      } catch (e) {
        // ignore
      }
    });

    ws.on('close', () => {
      this.clients.delete(ws);
    });

    ws.on('error', (err) => {
      console.warn('[clientSocket] Client socket error:', err.message);
      this.clients.delete(ws);
    });

    // Send initial snapshot & scanner data immediately
    this.sendInit(ws);
  }

  sendInit(ws) {
    if (ws.readyState !== WebSocket.OPEN) return;

    try {
      const allTickers = marketCache.getAllTickers();
      const status = binanceSocket.getAggregateStatus();
      const stats = binanceSocket.getConnectionStats();
      const scanData = scannerService.getScanData();

      const payload = {
        type: 'init',
        data: {
          status,
          totalSymbols: symbolManager.getTotalCount(),
          connections: stats,
          tickers: allTickers,
          scanner: scanData,
          timestamp: Date.now()
        }
      };

      ws.send(JSON.stringify(payload));
    } catch (err) {
      console.warn('[clientSocket] Error sending init:', err.message);
    }
  }

  sendSnapshot(ws) {
    if (ws.readyState !== WebSocket.OPEN) return;

    try {
      ws.send(JSON.stringify({
        type: 'snapshot',
        data: {
          tickers: marketCache.getAllTickers(),
          scanner: scannerService.getScanData(),
          timestamp: Date.now()
        }
      }));
    } catch (e) {
      // ignore
    }
  }

  sendScannerData(ws) {
    if (ws.readyState !== WebSocket.OPEN) return;
    try {
      ws.send(JSON.stringify({
        type: 'scanner_update',
        data: scannerService.getScanData()
      }));
    } catch (e) {
      // ignore
    }
  }

  broadcastScannerData(data = null) {
    if (this.clients.size === 0) return;
    try {
      const message = JSON.stringify({
        type: 'scanner_update',
        data: data || scannerService.getScanData()
      });
      for (const client of this.clients) {
        if (client.readyState === WebSocket.OPEN) {
          try {
            client.send(message);
          } catch (e) {}
        }
      }
    } catch (err) {
      // ignore
    }
  }

  startBatchBroadcast() {
    if (this.batchInterval) clearInterval(this.batchInterval);

    this.batchInterval = setInterval(() => {
      if (this.clients.size === 0) return;

      const batch = marketCache.drainPendingBatch();
      if (batch.length === 0) return;

      const message = JSON.stringify({
        type: 'ticker_batch',
        data: batch
      });

      for (const client of this.clients) {
        if (client.readyState === WebSocket.OPEN) {
          try {
            client.send(message);
          } catch (e) {}
        }
      }
    }, 80); // Batch every 80ms for buttery smooth, CPU-friendly 12 updates/sec
  }

  broadcastSnapshot() {
    if (this.clients.size === 0) return;
    const message = JSON.stringify({
      type: 'snapshot',
      data: {
        tickers: marketCache.getAllTickers(),
        timestamp: Date.now()
      }
    });

    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        try {
          client.send(message);
        } catch (e) {}
      }
    }
  }

  broadcastStatus(status, stats) {
    if (this.clients.size === 0) return;
    const message = JSON.stringify({
      type: 'status',
      data: {
        status,
        connections: stats,
        totalSymbols: symbolManager.getTotalCount(),
        timestamp: Date.now()
      }
    });

    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        try {
          client.send(message);
        } catch (e) {}
      }
    }
  }

  startHeartbeat() {
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);

    this.heartbeatInterval = setInterval(() => {
      for (const ws of this.clients) {
        if (ws.isAlive === false) {
          try {
            ws.terminate();
          } catch (e) {}
          this.clients.delete(ws);
          continue;
        }
        ws.isAlive = false;
        try {
          ws.ping();
        } catch (e) {}
      }
    }, 30000);
  }
}

export const clientSocket = new ClientSocketServer();
export default clientSocket;
