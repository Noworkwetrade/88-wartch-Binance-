/**
 * Real-Time Binance Spot Market Data Backend
 * Main entrypoint for Node.js Express & WebSocket Server
 */

import express from 'express';
import http from 'http';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { symbolManager } from './symbolManager.js';
import { binanceSocket } from './binanceSocket.js';
import { marketCache } from './marketCache.js';
import { clientSocket } from './clientSocket.js';
import { fetchKlines } from './binanceRest.js';
import { scannerService } from './scannerService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const PORT = parseInt(process.env.PORT || '3000', 10);
const app = express();
const server = http.createServer(app);

app.use(express.json());

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.path.startsWith('/api/')) {
    res.header('Cache-Control', 'no-store, no-cache, must-revalidate');
  }
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// API Routes
app.get('/api/status', (req, res) => {
  res.json({
    status: binanceSocket.getAggregateStatus(),
    pool: binanceSocket.getConnectionStats(),
    cache: marketCache.getStats(),
    clientConnections: clientSocket.clients.size,
    totalSymbols: symbolManager.getTotalCount(),
    timestamp: Date.now()
  });
});

app.get('/api/symbols', (req, res) => {
  res.json({
    total: symbolManager.getTotalCount(),
    symbols: symbolManager.getAllSymbolMeta()
  });
});

app.get('/api/tickers', (req, res) => {
  res.json({
    total: marketCache.tickers.size,
    connectionStatus: binanceSocket.getAggregateStatus(),
    tickers: marketCache.getAllTickers()
  });
});

app.get('/api/ticker/:symbol', (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  const ticker = marketCache.getTicker(symbol);
  if (!ticker) {
    return res.status(404).json({ error: `Symbol ${symbol} not found in market cache` });
  }
  res.json(ticker);
});

app.get('/api/klines', async (req, res) => {
  const symbol = (req.query.symbol || 'BTCUSDT').toString().toUpperCase();
  const interval = (req.query.interval || '15m').toString();
  const limit = parseInt(req.query.limit || '200', 10);

  try {
    const candles = await fetchKlines(symbol, interval, limit);
    res.json({
      symbol,
      interval,
      count: candles.length,
      candles,
      hasData: candles.length > 0
    });
  } catch (err) {
    console.warn(`[/api/klines] Fallback for ${symbol}:`, err.message);
    res.json({
      symbol,
      interval,
      count: 0,
      candles: [],
      hasData: false,
      message: err.message
    });
  }
});

app.get('/api/scanner', (req, res) => {
  res.json(scannerService.getScanData());
});

app.post('/api/reconnect', async (req, res) => {
  try {
    binanceSocket.connect();
    res.json({ message: 'Reconnecting Binance socket...', status: binanceSocket.getAggregateStatus() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

let backendInitialized = false;

/**
 * Initializes backend services: symbols loader, Binance socket, client socket server, scanner
 */
export async function initializeBackend(httpServer = server) {
  if (backendInitialized) {
    return;
  }
  backendInitialized = true;

  try {
    console.log('[backend] Initializing client WebSocket server...');
    clientSocket.attach(httpServer, '/ws');

    console.log('[backend] Loading dynamic symbols from Binance Spot...');
    symbolManager.onSnapshotUpdate = () => {
      clientSocket.broadcastSnapshot();
    };
    await symbolManager.loadSymbols();

    console.log('[backend] Launching Binance WebSocket streaming...');
    binanceSocket.start();

    console.log('[backend] Starting NWWT Market Scanner engine...');
    scannerService.start();

    console.log('[backend] Binance Spot Market & Scanner Backend initialized successfully!');
  } catch (error) {
    console.error('[backend] Initialization error:', error);
  }
}

// Function to start standalone server
export async function startServer() {
  await initializeBackend(server);

  const isProduction = process.env.NODE_ENV === 'production';
  const distPath = path.resolve(rootDir, 'dist');

  if (isProduction && fs.existsSync(distPath)) {
    console.log('[backend] Serving production static files from', distPath);
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.resolve(distPath, 'index.html'));
    });
  } else {
    console.log('[backend] Development mode: integrating Vite middleware...');
    try {
      const { createServer } = await import('vite');
      const vite = await createServer({
        root: rootDir,
        server: {
          middlewareMode: true,
          hmr: process.env.DISABLE_HMR !== 'true'
        },
        appType: 'spa'
      });
      app.use(vite.middlewares);
    } catch (err) {
      console.warn('[backend] Vite middleware note:', err.message);
    }
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`[backend] NWWT Market Server running at http://0.0.0.0:${PORT}`);
    console.log(`[backend] WebSocket streaming at ws://0.0.0.0:${PORT}/ws`);
  });
}

const isMain = process.argv[1] && (
  process.argv[1].endsWith('server/index.js') || 
  process.argv[1].endsWith('server/index') ||
  process.argv[1].endsWith('server.js')
);

if (isMain) {
  startServer().catch((err) => {
    console.error('[backend] Failed to start server:', err);
    process.exit(1);
  });
}

export { app, server };
export default app;
