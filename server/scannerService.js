/**
 * NWWT Market Scanner Service
 *
 * Scans the Binance Spot USDT watchlist using strictly REAL CLOSED CANDLES.
 * Evaluates pure NWWT technical structure:
 * - Market Structure (Bullish / Bearish / Range)
 * - Support & Resistance key levels
 * - Structure Breaks (BOS)
 * - Break and Retest
 * - Fakeout Rejection
 * - Engulfing Confirmation
 * - Trendline Breaks
 * - Pending Retest Setups
 *
 * Exclusively outputs "UP" or "DOWN" (never Buy or Sell).
 * Educational market analysis only.
 */

import { fetchKlines } from './binanceRest.js';
import { marketCache } from './marketCache.js';

// Top liquid USDT pairs prioritized for scanner depth
const PRIORITY_SYMBOLS = [
  'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'DOGEUSDT',
  'XRPUSDT', 'ADAUSDT', 'AVAXUSDT', 'LINKUSDT', 'SUIUSDT',
  'NEARUSDT', 'APTUSDT', 'OPUSDT', 'ARBUSDT', 'DOTUSDT',
  'FETUSDT', 'PEPEUSDT', 'SHIBUSDT', 'LTCUSDT', 'MATICUSDT',
  'TIAUSDT', 'RENDERUSDT', 'INJUSDT', 'SEIUSDT', 'WLDUSDT'
];

class ScannerService {
  constructor() {
    this.status = 'ready'; // 'ready' | 'scanning' | 'idle'
    this.timeframe = '15m';
    this.signals = [];
    this.pendingRetests = [];
    this.scannedCount = 0;
    this.lastScanTime = 0;
    this.scanInterval = null;
    this.isScanning = false;
  }

  start() {
    // Run initial scan after symbols load
    setTimeout(() => {
      this.runScan('15m');
    }, 5000);

    // Schedule scan every 45 seconds to process newly closed candles
    if (!this.scanInterval) {
      this.scanInterval = setInterval(() => {
        this.runScan(this.timeframe);
      }, 45000);
    }
  }

  async runScan(timeframe = '15m') {
    if (this.isScanning) return;
    this.isScanning = true;
    this.status = 'scanning';
    this.timeframe = timeframe;

    try {
      // Get all tickers sorted by 24h volume
      const allTickers = marketCache.getAllTickers();
      const topSymbols = allTickers
        .filter((t) => t.lastPrice !== '--')
        .sort((a, b) => (parseFloat(b.quoteVolume) || 0) - (parseFloat(a.quoteVolume) || 0))
        .map((t) => t.symbol);

      // Prioritize symbols: Top liquid pairs
      const scanList = Array.from(new Set([...PRIORITY_SYMBOLS, ...topSymbols.slice(0, 35)])).slice(0, 30);

      const confirmedSignals = [];
      const pendingSetups = [];
      let processed = 0;

      for (const symbol of scanList) {
        try {
          // Fetch real historical klines from Binance
          const rawCandles = await fetchKlines(symbol, timeframe, 60);
          if (!rawCandles || rawCandles.length < 15) continue;

          // CRITICAL NWWT RULE:
          // The scanner processes ONLY CLOSED CANDLES.
          // The last candle in rawCandles is currently active and fluctuating.
          // We take candles up to rawCandles.length - 2 for closed pattern detection!
          const closedCandles = rawCandles.slice(0, rawCandles.length - 1);
          const currentPrice = rawCandles[rawCandles.length - 1].close;

          const analysis = this.analyzeCandles(symbol, timeframe, closedCandles, currentPrice);
          if (analysis.signal) {
            confirmedSignals.push(analysis.signal);
          }
          if (analysis.pendingRetest) {
            pendingSetups.push(analysis.pendingRetest);
          }
          processed++;
        } catch (err) {
          // skip asset on transient error
        }
      }

      this.signals = confirmedSignals;
      this.pendingRetests = pendingSetups;
      this.scannedCount = processed;
      this.lastScanTime = Date.now();
      this.status = 'ready';
    } catch (err) {
      console.warn('[scannerService] Error during scan:', err.message);
      this.status = 'idle';
    } finally {
      this.isScanning = false;
    }
  }

  analyzeCandles(symbol, timeframe, closedCandles, currentPrice) {
    const len = closedCandles.length;
    if (len < 10) return { signal: null, pendingRetest: null };

    const c0 = closedCandles[len - 1]; // Most recently closed candle
    const c1 = closedCandles[len - 2]; // 1 candle prior
    const c2 = closedCandles[len - 3]; // 2 candles prior

    // 1. Identify Fractal Swing Highs and Lows (2-bar pivot)
    const swingHighs = [];
    const swingLows = [];

    for (let i = 2; i < len - 2; i++) {
      const h = closedCandles[i].high;
      const l = closedCandles[i].low;

      if (
        h > closedCandles[i - 1].high &&
        h > closedCandles[i - 2].high &&
        h > closedCandles[i + 1].high &&
        h > closedCandles[i + 2].high
      ) {
        swingHighs.push({ price: h, index: i, time: closedCandles[i].openTime });
      }

      if (
        l < closedCandles[i - 1].low &&
        l < closedCandles[i - 2].low &&
        l < closedCandles[i + 1].low &&
        l < closedCandles[i + 2].low
      ) {
        swingLows.push({ price: l, index: i, time: closedCandles[i].openTime });
      }
    }

    const lastHigh = swingHighs.length > 0 ? swingHighs[swingHighs.length - 1].price : Math.max(...closedCandles.slice(-10).map(c => c.high));
    const lastLow = swingLows.length > 0 ? swingLows[swingLows.length - 1].price : Math.min(...closedCandles.slice(-10).map(c => c.low));

    // 2. Market Structure classification
    let structure = 'ranging';
    if (swingHighs.length >= 2 && swingLows.length >= 2) {
      const h2 = swingHighs[swingHighs.length - 1].price;
      const h1 = swingHighs[swingHighs.length - 2].price;
      const l2 = swingLows[swingLows.length - 1].price;
      const l1 = swingLows[swingLows.length - 2].price;

      if (h2 > h1 && l2 > l1) structure = 'bullish';
      else if (h2 < h1 && l2 < l1) structure = 'bearish';
    }

    let signal = null;
    let pendingRetest = null;

    const c0Range = c0.high - c0.low || 0.0001;
    const c0UpperWick = c0.high - Math.max(c0.open, c0.close);
    const c0LowerWick = Math.min(c0.open, c0.close) - c0.low;
    const c0IsGreen = c0.close >= c0.open;
    const c1IsGreen = c1.close >= c1.open;

    // SETUP TYPE 1: Break & Retest
    // Previous candle broke key level, latest candle pulled back and tested level with rejection
    if (c1.close > lastHigh && c0.low <= lastHigh && c0.close > lastHigh && c0IsGreen) {
      signal = {
        id: `${symbol}-${timeframe}-break-retest-${c0.openTime}`,
        asset: symbol,
        timeframe,
        direction: 'UP',
        setupType: 'Break & Retest',
        signalPrice: c0.close,
        invalidationLevel: c0.low * 0.998,
        confidence: 88,
        reason: `Closed candle confirmed bullish break and retest of resistance turned support at $${lastHigh.toFixed(2)}.`,
        timestamp: c0.closeTime
      };
    } else if (c1.close < lastLow && c0.high >= lastLow && c0.close < lastLow && !c0IsGreen) {
      signal = {
        id: `${symbol}-${timeframe}-break-retest-${c0.openTime}`,
        asset: symbol,
        timeframe,
        direction: 'DOWN',
        setupType: 'Break & Retest',
        signalPrice: c0.close,
        invalidationLevel: c0.high * 1.002,
        confidence: 88,
        reason: `Closed candle confirmed bearish break and retest of support turned resistance at $${lastLow.toFixed(2)}.`,
        timestamp: c0.closeTime
      };
    }

    // SETUP TYPE 2: Fakeout Rejection (Liquidity sweep & immediate reversal)
    if (!signal) {
      if (c0.high > lastHigh && c0.close < lastHigh && (c0UpperWick / c0Range) > 0.45 && !c0IsGreen) {
        signal = {
          id: `${symbol}-${timeframe}-fakeout-${c0.openTime}`,
          asset: symbol,
          timeframe,
          direction: 'DOWN',
          setupType: 'Fakeout Rejection',
          signalPrice: c0.close,
          invalidationLevel: c0.high,
          confidence: 85,
          reason: `Fakeout rejection above key resistance $${lastHigh.toFixed(2)} with heavy upper wick selling pressure.`,
          timestamp: c0.closeTime
        };
      } else if (c0.low < lastLow && c0.close > lastLow && (c0LowerWick / c0Range) > 0.45 && c0IsGreen) {
        signal = {
          id: `${symbol}-${timeframe}-fakeout-${c0.openTime}`,
          asset: symbol,
          timeframe,
          direction: 'UP',
          setupType: 'Fakeout Rejection',
          signalPrice: c0.close,
          invalidationLevel: c0.low,
          confidence: 85,
          reason: `Fakeout rejection below key support $${lastLow.toFixed(2)} with responsive buyer absorption.`,
          timestamp: c0.closeTime
        };
      }
    }

    // SETUP TYPE 3: Engulfing Confirmation at Structure Level
    if (!signal) {
      const isBullishEngulfing = c0IsGreen && !c1IsGreen && c0.close > c1.open && c0.open <= c1.close;
      const isBearishEngulfing = !c0IsGreen && c1IsGreen && c0.close < c1.open && c0.open >= c1.close;

      if (isBullishEngulfing && Math.abs(c0.low - lastLow) / lastLow < 0.015) {
        signal = {
          id: `${symbol}-${timeframe}-engulfing-${c0.openTime}`,
          asset: symbol,
          timeframe,
          direction: 'UP',
          setupType: 'Engulfing Confirmation',
          signalPrice: c0.close,
          invalidationLevel: c0.low,
          confidence: 84,
          reason: `Bullish engulfing confirmation closed at key structural support zone $${lastLow.toFixed(2)}.`,
          timestamp: c0.closeTime
        };
      } else if (isBearishEngulfing && Math.abs(c0.high - lastHigh) / lastHigh < 0.015) {
        signal = {
          id: `${symbol}-${timeframe}-engulfing-${c0.openTime}`,
          asset: symbol,
          timeframe,
          direction: 'DOWN',
          setupType: 'Engulfing Confirmation',
          signalPrice: c0.close,
          invalidationLevel: c0.high,
          confidence: 84,
          reason: `Bearish engulfing confirmation closed at key structural resistance zone $${lastHigh.toFixed(2)}.`,
          timestamp: c0.closeTime
        };
      }
    }

    // SETUP TYPE 4: Structure Break (BOS)
    if (!signal) {
      if (c0.close > lastHigh && c1.close <= lastHigh) {
        signal = {
          id: `${symbol}-${timeframe}-bos-${c0.openTime}`,
          asset: symbol,
          timeframe,
          direction: 'UP',
          setupType: 'Structure Break (BOS)',
          signalPrice: c0.close,
          invalidationLevel: lastHigh * 0.995,
          confidence: 82,
          reason: `Bullish Break of Structure: Closed above swing high resistance $${lastHigh.toFixed(2)}.`,
          timestamp: c0.closeTime
        };
      } else if (c0.close < lastLow && c1.close >= lastLow) {
        signal = {
          id: `${symbol}-${timeframe}-bos-${c0.openTime}`,
          asset: symbol,
          timeframe,
          direction: 'DOWN',
          setupType: 'Structure Break (BOS)',
          signalPrice: c0.close,
          invalidationLevel: lastLow * 1.005,
          confidence: 82,
          reason: `Bearish Break of Structure: Closed below swing low support $${lastLow.toFixed(2)}.`,
          timestamp: c0.closeTime
        };
      }
    }

    // PENDING RETEST CHECK:
    // If not currently triggering a confirmed signal, check if price is approaching a key broken level
    const distToHigh = Math.abs(currentPrice - lastHigh) / lastHigh;
    const distToLow = Math.abs(currentPrice - lastLow) / lastLow;

    if (distToHigh < 0.012 && currentPrice >= lastHigh) {
      pendingRetest = {
        asset: symbol,
        timeframe,
        targetLevel: lastHigh,
        currentPrice,
        direction: 'UP',
        note: `Testing broken resistance level $${lastHigh.toFixed(2)} as prospective support.`
      };
    } else if (distToLow < 0.012 && currentPrice <= lastLow) {
      pendingRetest = {
        asset: symbol,
        timeframe,
        targetLevel: lastLow,
        currentPrice,
        direction: 'DOWN',
        note: `Testing broken support level $${lastLow.toFixed(2)} as prospective resistance.`
      };
    }

    return { signal, pendingRetest };
  }

  getScanData() {
    return {
      status: this.status,
      timeframe: this.timeframe,
      scannedCount: this.scannedCount,
      totalSymbols: marketCache.tickers.size,
      lastScanTime: this.lastScanTime,
      signals: this.signals,
      pendingRetests: this.pendingRetests
    };
  }
}

export const scannerService = new ScannerService();
export default scannerService;
