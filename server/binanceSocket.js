/**
 * Binance WebSocket Client
 *
 * Implements:
 * - Direct connection to Binance live ticker stream (wss://stream.binance.com:9443/ws/!ticker@arr)
 * - Watchdog timer for silent connection detection (reconnects if no data in 25s)
 * - Connection rotation before Binance's 24-hour lifetime limit (rotates at ~23h)
 * - Exponential backoff reconnect
 * - Preserves last known valid prices across reconnects
 */

import WebSocket from 'ws';
import { EventEmitter } from 'node:events';
import { marketCache } from './marketCache.js';
import { isPermanentlyExcludedSymbol } from './binanceRest.js';

const BINANCE_WS_URLS = [
  'wss://data-stream.binance.vision/ws/!miniTicker@arr',
  'wss://stream.binance.com/ws/!miniTicker@arr',
  'wss://stream.binance.com:9443/ws/!miniTicker@arr'
];
const ROTATION_INTERVAL_MS = 23 * 60 * 60 * 1000; // 23 hours (proactive rotation before 24h disconnect)
const WATCHDOG_CHECK_MS = 10000;
const WATCHDOG_TIMEOUT_MS = 25000;

class BinanceSocketManager extends EventEmitter {
  constructor(options = {}) {
    super();
    this.urls = options.urls || BINANCE_WS_URLS;
    this.watchdogCheckMs = options.watchdogCheckMs || WATCHDOG_CHECK_MS;
    this.watchdogTimeoutMs = options.watchdogTimeoutMs || WATCHDOG_TIMEOUT_MS;
    this.rotationIntervalMs = options.rotationIntervalMs || ROTATION_INTERVAL_MS;
    this.reconnectBaseDelayMs = options.reconnectBaseDelayMs || 1000;
    this.reconnectMaxDelayMs = options.reconnectMaxDelayMs || 10000;
    this.createSocket = options.createSocket || null;

    this.ws = null;
    this.status = 'disconnected'; // 'connecting' | 'connected' | 'reconnecting' | 'disconnected'
    this.currentUrlIndex = 0;
    this.lastConnectedUrl = null;
    this.reconnectAttempts = 0;
    this.reconnectTimer = null;
    this.watchdogTimer = null;
    this.rotationTimer = null;
    this.lastMessageTime = 0;
    this.connectedAt = 0;
    this.isDestroyed = false;

    // Listeners
    this.onTickerCallbacks = new Set();
    this.onStatusCallbacks = new Set();
  }

  onTickerUpdate(cb) {
    this.onTickerCallbacks.add(cb);
  }

  onStatusChange(cb) {
    this.onStatusCallbacks.add(cb);
  }

  notifyStatus(status) {
    this.status = status;
    marketCache.setConnectionStatus(status);
    for (const cb of this.onStatusCallbacks) {
      try {
        cb(status, this.getConnectionStats());
      } catch (e) {
        // ignore
      }
    }
  }

  start() {
    if (this.isDestroyed) return;
    this.connect();
    this.startWatchdog();
  }

  connect() {
    if (this.isDestroyed) return;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    const wsUrl = this.urls[this.currentUrlIndex % this.urls.length];
    this.lastConnectedUrl = wsUrl;
    this.notifyStatus(this.reconnectAttempts > 0 ? 'reconnecting' : 'connecting');
    console.log(`[binanceSocket] Connecting to Binance WebSocket: ${wsUrl}...`);

    try {
      if (typeof this.createSocket === 'function') {
        this.ws = this.createSocket(wsUrl);
      } else {
        this.ws = new WebSocket(wsUrl, {
          handshakeTimeout: 10000
        });
      }

      this.ws.on('open', () => this.handleOpen());
      this.ws.on('message', (data) => this.handleMessage(data));
      this.ws.on('error', (err) => this.handleError(err));
      this.ws.on('close', (code, reason) => this.handleClose(code, reason));
      this.ws.on('ping', (data) => {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          this.ws.pong(data);
        }
      });
      this.ws.on('pong', () => {
        this.lastMessageTime = Date.now();
      });
    } catch (err) {
      console.error('[binanceSocket] Connection init error:', err.message);
      this.scheduleReconnect();
    }
  }

  handleOpen() {
    console.log('[binanceSocket] Successfully connected to Binance live stream!');
    this.connectedAt = Date.now();
    this.lastMessageTime = Date.now();
    this.reconnectAttempts = 0;
    this.notifyStatus('connected');

    // Schedule connection rotation to respect Binance 24h lifetime
    if (this.rotationTimer) clearTimeout(this.rotationTimer);
    this.rotationTimer = setTimeout(() => {
      console.log('[binanceSocket] Rotating connection before 24-hour Binance lifetime limit...');
      this.rotateConnection();
    }, this.rotationIntervalMs);
  }

  handleMessage(raw) {
    this.lastMessageTime = Date.now();

    try {
      const data = JSON.parse(raw.toString());
      if (Array.isArray(data)) {
        // Array of 24hr tickers: [{ e: '24hrTicker', E: 167..., s: 'BTCUSDT', c: '...', ... }]
        for (const item of data) {
          if (!item || !item.s) continue;
          // Venue-agnostic data feed: USDC and USD pairs remain in data layer for multi-quote tracking, while scanner evaluates USDT-only.
          const isAllowedQuote = item.s.endsWith('USDT') || item.s.endsWith('USDC') || item.s.endsWith('USD');
          if (!isAllowedQuote || isPermanentlyExcludedSymbol(item.s)) continue;

          const updated = marketCache.updateFromWs(item.s, item, item.E || Date.now());
          if (updated) {
            this.emit('price', updated);
            for (const cb of this.onTickerCallbacks) {
              try {
                cb(updated);
              } catch (e) {
                // ignore
              }
            }
          }
        }
      } else if (data && data.s) {
        const isAllowedQuote = data.s.endsWith('USDT') || data.s.endsWith('USDC') || data.s.endsWith('USD');
        if (isAllowedQuote && !isPermanentlyExcludedSymbol(data.s)) {
          const updated = marketCache.updateFromWs(data.s, data, data.E || Date.now());
          if (updated) {
            for (const cb of this.onTickerCallbacks) {
              try {
                cb(updated);
              } catch (e) {
                // ignore
              }
            }
          }
        }
      }
    } catch (err) {
      // Ignore parse error
    }
  }

  handleError(err) {
    console.warn('[binanceSocket] WebSocket error:', err.message);
  }

  handleClose(code, reason) {
    console.warn(`[binanceSocket] Closed (code: ${code}, reason: ${reason || 'none'}).`);
    if (this.ws) {
      try {
        this.ws.removeAllListeners?.();
      } catch (e) {}
    }
    this.ws = null;
    this.notifyStatus('reconnecting');
    this.scheduleReconnect();
  }

  rotateConnection() {
    console.log('[binanceSocket] Performing scheduled connection rotation...');
    if (this.ws) {
      try {
        this.ws.removeAllListeners?.();
        this.ws.close(1000, 'Scheduled 23h rotation');
      } catch (e) {}
      this.ws = null;
    }
    this.connect();
  }

  scheduleReconnect() {
    if (this.isDestroyed || this.reconnectTimer) return;

    this.reconnectAttempts++;
    this.currentUrlIndex++;
    // Exponential backoff
    const delay = Math.min(this.reconnectMaxDelayMs, Math.pow(2, this.reconnectAttempts - 1) * this.reconnectBaseDelayMs);
    console.log(`[binanceSocket] Scheduling reconnect attempt #${this.reconnectAttempts} in ${delay}ms...`);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  startWatchdog() {
    if (this.watchdogTimer) clearInterval(this.watchdogTimer);

    this.watchdogTimer = setInterval(() => {
      if (this.isDestroyed) return;

      const now = Date.now();
      // If connected but no message received for > watchdogTimeoutMs, reconnect
      if (this.status === 'connected' && this.lastMessageTime > 0 && now - this.lastMessageTime > this.watchdogTimeoutMs) {
        console.warn(`[binanceSocket] Watchdog: silent connection detected (${now - this.lastMessageTime}ms). Reconnecting...`);
        const oldWs = this.ws;
        this.ws = null;
        if (oldWs) {
          try {
            oldWs.removeAllListeners?.();
            oldWs.terminate?.();
          } catch (e) {}
        }
        this.notifyStatus('reconnecting');
        this.scheduleReconnect();
      }
    }, this.watchdogCheckMs);
  }

  // =========================================================================
  // Minimal test hooks (guarded so they have no production effect)
  // =========================================================================

  /**
   * Test hook: simulates receiving a raw message from the WebSocket
   */
  _simulateMessage(msg) {
    const raw = typeof msg === 'string' ? Buffer.from(msg) : Buffer.from(JSON.stringify(msg));
    this.handleMessage(raw);
  }

  /**
   * Test hook: simulates connection silence (socket stays open, no messages arrive)
   */
  _simulateSilence() {
    this.lastMessageTime = Date.now() - (this.watchdogTimeoutMs + 2000);
  }

  /**
   * Test hook: simulates abrupt socket drop
   */
  _simulateDrop(code = 1006, reason = 'Simulated connection drop') {
    if (this.ws) {
      try {
        if (typeof this.ws.terminate === 'function') {
          this.ws.terminate();
        } else if (typeof this.ws.close === 'function') {
          this.ws.close(code, reason);
        }
      } catch (e) {}
    }
    this.handleClose(code, reason);
  }

  /**
   * Test hook: forces connection rotation path
   */
  _simulateRotation() {
    this.rotateConnection();
  }

  getAggregateStatus() {
    return this.status;
  }

  getConnectionStats() {
    return {
      status: this.status,
      reconnectAttempts: this.reconnectAttempts,
      connectedAt: this.connectedAt,
      lastMessageTime: this.lastMessageTime,
      totalSymbols: marketCache.tickers.size
    };
  }

  destroy() {
    this.isDestroyed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.watchdogTimer) clearInterval(this.watchdogTimer);
    if (this.rotationTimer) clearTimeout(this.rotationTimer);
    if (this.ws) {
      try {
        this.ws.removeAllListeners?.();
        this.ws.close();
      } catch (e) {}
      this.ws = null;
    }
  }
}

export { BinanceSocketManager };
export const binanceSocket = new BinanceSocketManager();
export default binanceSocket;
