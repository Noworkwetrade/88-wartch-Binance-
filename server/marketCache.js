/**
 * In-Memory Market Cache
 *
 * Enforces strict price stability and data integrity:
 * - Separates Binance WebSocket event timestamps from REST snapshot timestamps
 * - Rejects stale REST prices from overwriting fresh WebSocket prices
 * - Rejects malformed, zero, negative, or NaN prices
 * - Keeps the last known valid price during reconnects
 */

class MarketCache {
  constructor() {
    /** @type {Map<string, Object>} */
    this.tickers = new Map();
    this.connectionStatus = 'disconnected'; // 'connected' | 'connecting' | 'reconnecting' | 'disconnected'
    this.lastUpdateTime = 0;
    this.totalUpdates = 0;

    // Buffer for batch updates
    /** @type {Map<string, Object>} */
    this.pendingBatch = new Map();
  }

  /**
   * Initializes symbols in the cache
   * @param {Array<Object>} symbolsList
   */
  initSymbols(symbolsList) {
    for (const item of symbolsList) {
      const sym = item.symbol;
      if (!this.tickers.has(sym)) {
        this.tickers.set(sym, {
          symbol: sym,
          baseAsset: item.baseAsset || '',
          quoteAsset: item.quoteAsset || 'USDT',
          lastPrice: '--',
          priceChange: '0.00',
          priceChangePercent: '0.00',
          highPrice: '--',
          lowPrice: '--',
          bidPrice: '--',
          askPrice: '--',
          volume: '0',
          quoteVolume: '0',
          lastWsUpdateTime: 0,
          lastRestUpdateTime: 0,
          lastUpdateTime: 0,
          priceDirection: 'neutral',
          connectionStatus: this.connectionStatus
        });
      }
    }
  }

  /**
   * Updates a single ticker from Binance WebSocket event
   * Discards zero, negative, malformed, or out-of-order event times
   * @param {string} symbol
   * @param {Object} raw
   * @param {number} eventTime
   */
  updateFromWs(symbol, raw, eventTime = 0) {
    if (!symbol) return null;
    const cleanSymbol = symbol.toUpperCase();

    // Validate price
    const rawPrice = raw.c !== undefined ? raw.c : (raw.lastPrice || raw.p);
    const parsedPrice = parseFloat(rawPrice);
    if (isNaN(parsedPrice) || parsedPrice <= 0) {
      // Discard malformed, zero, or negative price
      return null;
    }

    const existing = this.tickers.get(cleanSymbol) || {
      symbol: cleanSymbol,
      baseAsset: cleanSymbol.replace(/USDT$/, ''),
      quoteAsset: 'USDT',
      lastPrice: '--',
      priceChange: '0.00',
      priceChangePercent: '0.00',
      highPrice: '--',
      lowPrice: '--',
      bidPrice: '--',
      askPrice: '--',
      volume: '0',
      quoteVolume: '0',
      lastWsUpdateTime: 0,
      lastRestUpdateTime: 0,
      lastUpdateTime: 0,
      priceDirection: 'neutral',
      connectionStatus: this.connectionStatus
    };

    // Ignore out-of-order WebSocket messages if eventTime is older than our latest WS timestamp
    if (eventTime > 0 && existing.lastWsUpdateTime > 0 && eventTime < existing.lastWsUpdateTime) {
      return null;
    }

    // Determine price tick direction
    let direction = existing.priceDirection || 'neutral';
    if (existing.lastPrice !== '--') {
      const oldNum = parseFloat(existing.lastPrice);
      if (!isNaN(oldNum)) {
        if (parsedPrice > oldNum) direction = 'up';
        else if (parsedPrice < oldNum) direction = 'down';
      }
    }

    // Parse percentage and price change
    let priceChangePercent = existing.priceChangePercent;
    let priceChange = existing.priceChange;

    if (raw.P !== undefined && raw.P !== null) {
      const pNum = parseFloat(raw.P);
      if (!isNaN(pNum)) {
        priceChangePercent = pNum.toFixed(2);
      }
    } else if (raw.o !== undefined && raw.c !== undefined) {
      const openNum = parseFloat(raw.o);
      const closeNum = parseFloat(raw.c);
      if (!isNaN(openNum) && openNum > 0 && !isNaN(closeNum)) {
        const pct = ((closeNum - openNum) / openNum) * 100;
        priceChangePercent = pct.toFixed(2);
        priceChange = (closeNum - openNum).toFixed(4);
      }
    }

    if (raw.p !== undefined && raw.p !== null) {
      priceChange = String(raw.p);
    }

    const updated = {
      ...existing,
      symbol: cleanSymbol,
      lastPrice: String(rawPrice),
      priceChange: priceChange,
      priceChangePercent: priceChangePercent,
      highPrice: raw.h !== undefined ? String(raw.h) : existing.highPrice,
      lowPrice: raw.l !== undefined ? String(raw.l) : existing.lowPrice,
      volume: raw.v !== undefined ? String(raw.v) : existing.volume,
      quoteVolume: raw.q !== undefined ? String(raw.q) : existing.quoteVolume,
      lastWsUpdateTime: eventTime > 0 ? eventTime : Date.now(),
      lastUpdateTime: Date.now(),
      priceDirection: direction,
      connectionStatus: 'connected'
    };

    this.tickers.set(cleanSymbol, updated);
    this.pendingBatch.set(cleanSymbol, updated);
    this.lastUpdateTime = updated.lastUpdateTime;
    this.totalUpdates++;

    return updated;
  }

  /**
   * Bulk updates from REST snapshot.
   * STRICT INTEGRITY:
   * A REST snapshot NEVER overwrites a fresh WebSocket price.
   * If an asset already has a valid lastPrice from WebSocket (lastWsUpdateTime > 0),
   * we keep the live WebSocket price intact and only update background 24h stats if missing.
   * @param {Array<Object>} rawTickersList
   */
  updateFromRestSnapshot(rawTickersList) {
    if (!Array.isArray(rawTickersList)) return 0;
    const now = Date.now();
    let updatedCount = 0;

    for (const item of rawTickersList) {
      if (!item || !item.symbol) continue;
      const cleanSymbol = item.symbol.toUpperCase();
      if (!cleanSymbol.endsWith('USDT')) continue;

      const restPrice = parseFloat(item.lastPrice);
      if (isNaN(restPrice) || restPrice <= 0) continue;

      const existing = this.tickers.get(cleanSymbol);

      // If we already have a live price from WebSocket received recently, DO NOT overwrite the price!
      const hasFreshWsPrice = existing && existing.lastWsUpdateTime > 0 && existing.lastPrice !== '--';

      const lastPrice = hasFreshWsPrice ? existing.lastPrice : String(item.lastPrice);
      const priceChange = item.priceChange !== undefined ? String(item.priceChange) : (existing?.priceChange || '0.00');
      
      let priceChangePercent = '0.00';
      if (item.priceChangePercent !== undefined) {
        const pNum = parseFloat(item.priceChangePercent);
        if (!isNaN(pNum)) priceChangePercent = pNum.toFixed(2);
      } else if (existing?.priceChangePercent) {
        priceChangePercent = existing.priceChangePercent;
      }

      const updated = {
        symbol: cleanSymbol,
        baseAsset: existing?.baseAsset || cleanSymbol.replace(/USDT$/, ''),
        quoteAsset: 'USDT',
        lastPrice: lastPrice,
        priceChange: priceChange,
        priceChangePercent: priceChangePercent,
        highPrice: item.highPrice !== undefined ? String(item.highPrice) : (existing?.highPrice || '--'),
        lowPrice: item.lowPrice !== undefined ? String(item.lowPrice) : (existing?.lowPrice || '--'),
        bidPrice: item.bidPrice !== undefined ? String(item.bidPrice) : (existing?.bidPrice || '--'),
        askPrice: item.askPrice !== undefined ? String(item.askPrice) : (existing?.askPrice || '--'),
        volume: item.volume !== undefined ? String(item.volume) : (existing?.volume || '0'),
        quoteVolume: item.quoteVolume !== undefined ? String(item.quoteVolume) : (existing?.quoteVolume || '0'),
        lastWsUpdateTime: existing?.lastWsUpdateTime || 0,
        lastRestUpdateTime: now,
        lastUpdateTime: existing?.lastUpdateTime || now,
        priceDirection: existing?.priceDirection || 'neutral',
        connectionStatus: this.connectionStatus
      };

      this.tickers.set(cleanSymbol, updated);
      updatedCount++;
    }

    this.lastUpdateTime = now;
    return updatedCount;
  }

  /**
   * Drain pending batch of updates for broadcast
   * @returns {Array<Object>}
   */
  drainPendingBatch() {
    if (this.pendingBatch.size === 0) return [];
    const batch = Array.from(this.pendingBatch.values());
    this.pendingBatch.clear();
    return batch;
  }

  getTicker(symbol) {
    return this.tickers.get(symbol?.toUpperCase()) || null;
  }

  getAllTickers() {
    return Array.from(this.tickers.values());
  }

  setConnectionStatus(status) {
    this.connectionStatus = status;
    for (const ticker of this.tickers.values()) {
      ticker.connectionStatus = status;
    }
  }

  getConnectionStatus() {
    return this.connectionStatus;
  }

  getStats() {
    return {
      totalSymbols: this.tickers.size,
      connectionStatus: this.connectionStatus,
      lastUpdateTime: this.lastUpdateTime,
      totalUpdates: this.totalUpdates
    };
  }
}

export const marketCache = new MarketCache();
export default marketCache;
