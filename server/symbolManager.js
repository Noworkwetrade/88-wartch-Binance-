/**
 * Binance Symbol Manager
 * Dynamically loads all active Binance Spot USDT trading pairs
 */

import { fetchExchangeInfo, fetchSpotTickers } from './binanceRest.js';
import { marketCache } from './marketCache.js';

class SymbolManager {
  constructor() {
    /** @type {Array<Object>} */
    this.rawSymbols = [];
    /** @type {Array<string>} */
    this.symbolNames = [];
    /** @type {Map<string, Object>} */
    this.symbolMetaMap = new Map();
    this.isLoaded = false;
    this.lastLoadedTime = 0;
    this.snapshotInterval = null;
    this.onSnapshotUpdate = null;
  }

  async loadSymbols() {
    try {
      console.log('[symbolManager] Fetching active Binance Spot USDT trading pairs...');
      const exchangeInfo = await fetchExchangeInfo();
      this.rawSymbols = exchangeInfo.symbols;

      this.symbolNames = [];
      this.symbolMetaMap.clear();

      for (const item of this.rawSymbols) {
        this.symbolNames.push(item.symbol);
        this.symbolMetaMap.set(item.symbol, {
          symbol: item.symbol,
          baseAsset: item.baseAsset,
          quoteAsset: item.quoteAsset,
          status: item.status
        });
      }

      console.log(`[symbolManager] Dynamically loaded ${this.symbolNames.length} Binance Spot USDT pairs!`);

      // Initialize the market cache
      marketCache.initSymbols(this.rawSymbols);

      // Fetch initial 24hr snapshot to populate immediate prices
      try {
        console.log('[symbolManager] Populating initial 24hr Binance snapshot...');
        const tickers = await fetchSpotTickers();
        if (tickers && tickers.length > 0) {
          const updated = marketCache.updateFromRestSnapshot(tickers);
          console.log(`[symbolManager] Populated prices for ${updated} Binance USDT pairs.`);
        }
      } catch (err) {
        console.warn('[symbolManager] Note loading initial 24hr snapshot:', err.message);
      }

      // Background periodic snapshot sync (every 30s)
      if (!this.snapshotInterval) {
        this.snapshotInterval = setInterval(async () => {
          try {
            const tickers = await fetchSpotTickers();
            if (tickers && tickers.length > 0) {
              marketCache.updateFromRestSnapshot(tickers);
              if (typeof this.onSnapshotUpdate === 'function') {
                this.onSnapshotUpdate();
              }
            }
          } catch (e) {
            // ignore
          }
        }, 30000);
      }

      this.isLoaded = true;
      this.lastLoadedTime = Date.now();
      return this.symbolNames;
    } catch (err) {
      console.error('[symbolManager] Error loading symbols:', err.message);
      throw err;
    }
  }

  getSymbolChunks() {
    return [this.symbolNames];
  }

  getTotalCount() {
    return this.symbolNames.length;
  }

  getAllSymbolMeta() {
    return Array.from(this.symbolMetaMap.values());
  }

  getMeta(symbol) {
    return this.symbolMetaMap.get(symbol?.toUpperCase()) || null;
  }
}

export const symbolManager = new SymbolManager();
export default symbolManager;
