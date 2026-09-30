/**
 * NWWT Market Scanner Service - V8 Signal Performance Engine
 *
 * Scans the Binance Spot USDT watchlist using strictly REAL CLOSED CANDLES.
 * Evaluates pure NWWT technical structure:
 * - Market Structure (Bullish / Bearish / Range)
 * - Support & Resistance key levels
 * - Strong Confirmed Breaks (BOS / Breakout): Retest is OPTIONAL
 * - Break and Retest: Retest strengthens an existing setup (boosts confidence)
 * - Fakeout Rejection (Liquidity sweep & immediate reversal)
 * - Engulfing Confirmation at key structure levels
 * - Trendline Breaks
 * - Signals ranked highest probability to lowest probability
 *
 * V8 SIGNAL PERFORMANCE ENGINE:
 * - Every signal gets an entryPrice, takeProfit (TP), and stopLoss (SL)
 * - Watches active signals using live market data in real time
 * - Records signal as WIN when TP is reached
 * - Records signal as LOSS when SL is reached
 * - If neither is reached, keeps watching until the defined expiry period
 * - CONSERVATIVE RULE: If TP and SL are both touched in the same candle/period,
 *   record as LOSS (conservative SL result).
 * - Tracks results by setup type, timeframe, asset, and direction
 * - Computes TP rate and performance analytics without automated strategy perturbation
 *
 * Educational market analysis only. Never provides trading execution or financial advice.
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

function getTimeframeMinutes(tf) {
  switch (tf) {
    case '1m': return 1;
    case '5m': return 5;
    case '15m': return 15;
    case '30m': return 30;
    case '1h': return 60;
    case '2h': return 120;
    case '4h': return 240;
    case '6h': return 360;
    case '8h': return 480;
    case '12h': return 720;
    case '1d': return 1440;
    case '1w': return 10080;
    default: return 15;
  }
}

class ScannerService {
  constructor() {
    this.status = 'ready'; // 'ready' | 'scanning' | 'idle'
    this.timeframe = '15m';
    this.signals = []; // Active/recent signals from current scan
    this.pendingRetests = [];
    this.scannedCount = 0;
    this.lastScanTime = 0;
    this.scanInterval = null;
    this.watchInterval = null;
    this.isScanning = false;

    // V8 In-Memory Performance History
    // Map of id -> ScannerSignalItem
    this.performanceSignals = new Map();
  }

  start() {
    // Initial scan after symbols load
    setTimeout(() => {
      this.runScan('15m');
    }, 3500);

    // Periodic scanner every 45 seconds for closed candles
    if (!this.scanInterval) {
      this.scanInterval = setInterval(() => {
        this.runScan(this.timeframe);
      }, 45000);
    }

    // High-frequency active signal watcher (checks live ticker prices every 2 seconds)
    if (!this.watchInterval) {
      this.watchInterval = setInterval(() => {
        this.watchActiveSignals();
      }, 2000);
    }
  }

  /**
   * Helper to construct a V8 Signal with exact entry, TP, and SL
   */
  createSignalItem({
    symbol,
    timeframe,
    direction,
    setupType,
    closePrice,
    invalidationLevel,
    confidence,
    reason,
    timestamp
  }) {
    const entryPrice = closePrice;
    let stopLoss = invalidationLevel;
    let takeProfit = entryPrice;

    const tfMins = getTimeframeMinutes(timeframe);
    const expiryCandles = 24;
    const expiryTimestamp = timestamp + expiryCandles * tfMins * 60 * 1000;

    if (direction === 'UP') {
      // Ensure stopLoss is below entry with sensible floor
      if (!stopLoss || stopLoss >= entryPrice || (entryPrice - stopLoss) / entryPrice < 0.004) {
        stopLoss = entryPrice * 0.985; // 1.5% stop
      }
      const risk = entryPrice - stopLoss;
      // 1.5x Risk-to-Reward ratio
      takeProfit = entryPrice + risk * 1.5;
    } else {
      // Ensure stopLoss is above entry with sensible ceiling
      if (!stopLoss || stopLoss <= entryPrice || (stopLoss - entryPrice) / entryPrice < 0.004) {
        stopLoss = entryPrice * 1.015; // 1.5% stop
      }
      const risk = stopLoss - entryPrice;
      // 1.5x Risk-to-Reward ratio
      takeProfit = entryPrice - risk * 1.5;
    }

    const id = `${symbol}-${timeframe}-${setupType.toLowerCase().replace(/[^a-z0-9]/g, '')}-${direction.toLowerCase()}-${timestamp}`;

    return {
      id,
      asset: symbol,
      timeframe,
      direction,
      setupType,
      signalPrice: entryPrice,
      entryPrice,
      takeProfit,
      stopLoss,
      invalidationLevel: stopLoss,
      confidence,
      reason,
      timestamp,
      status: 'ACTIVE',
      statusReason: 'Watching live prices against TP and SL',
      expiryCandles,
      expiryTimestamp,
      highestReached: entryPrice,
      lowestReached: entryPrice
    };
  }

  /**
   * Live Market Data Watcher for Active Signals
   */
  watchActiveSignals() {
    const now = Date.now();
    let hasChanges = false;

    for (const [id, signal] of this.performanceSignals.entries()) {
      if (signal.status !== 'ACTIVE') continue;

      const ticker = marketCache.getTicker(signal.asset);
      if (!ticker || ticker.lastPrice === '--') continue;

      const currentPrice = parseFloat(ticker.lastPrice);
      if (isNaN(currentPrice)) continue;

      signal.highestReached = Math.max(signal.highestReached || currentPrice, currentPrice);
      signal.lowestReached = Math.min(signal.lowestReached || currentPrice, currentPrice);

      const isUp = signal.direction === 'UP';

      if (isUp) {
        // V8 CONSERVATIVE RULE: If both TP and SL touched in same period/candle, use conservative SL result
        const tpReached = currentPrice >= signal.takeProfit;
        const slReached = currentPrice <= signal.stopLoss;

        if (tpReached && slReached) {
          signal.status = 'LOSS';
          signal.statusReason = `Conservative SL: Both TP and SL were breached in same period.`;
          signal.completedAt = now;
          signal.exitPrice = signal.stopLoss;
          signal.pnlPercent = -Math.abs(((signal.entryPrice - signal.stopLoss) / signal.entryPrice) * 100);
          hasChanges = true;
        } else if (tpReached) {
          signal.status = 'WIN';
          signal.statusReason = `Take profit target ($${signal.takeProfit.toFixed(4)}) reached.`;
          signal.completedAt = now;
          signal.exitPrice = signal.takeProfit;
          signal.pnlPercent = Math.abs(((signal.takeProfit - signal.entryPrice) / signal.entryPrice) * 100);
          hasChanges = true;
        } else if (slReached) {
          signal.status = 'LOSS';
          signal.statusReason = `Stop loss level ($${signal.stopLoss.toFixed(4)}) reached.`;
          signal.completedAt = now;
          signal.exitPrice = signal.stopLoss;
          signal.pnlPercent = -Math.abs(((signal.entryPrice - signal.stopLoss) / signal.entryPrice) * 100);
          hasChanges = true;
        } else if (now >= signal.expiryTimestamp) {
          signal.status = 'EXPIRED';
          signal.statusReason = `Expired after ${signal.expiryCandles} candle periods without reaching TP or SL.`;
          signal.completedAt = now;
          signal.exitPrice = currentPrice;
          signal.pnlPercent = ((currentPrice - signal.entryPrice) / signal.entryPrice) * 100;
          hasChanges = true;
        }
      } else {
        // DOWN Direction
        const tpReached = currentPrice <= signal.takeProfit;
        const slReached = currentPrice >= signal.stopLoss;

        if (tpReached && slReached) {
          signal.status = 'LOSS';
          signal.statusReason = `Conservative SL: Both TP and SL were breached in same period.`;
          signal.completedAt = now;
          signal.exitPrice = signal.stopLoss;
          signal.pnlPercent = -Math.abs(((signal.stopLoss - signal.entryPrice) / signal.entryPrice) * 100);
          hasChanges = true;
        } else if (tpReached) {
          signal.status = 'WIN';
          signal.statusReason = `Take profit target ($${signal.takeProfit.toFixed(4)}) reached.`;
          signal.completedAt = now;
          signal.exitPrice = signal.takeProfit;
          signal.pnlPercent = Math.abs(((signal.entryPrice - signal.takeProfit) / signal.entryPrice) * 100);
          hasChanges = true;
        } else if (slReached) {
          signal.status = 'LOSS';
          signal.statusReason = `Stop loss level ($${signal.stopLoss.toFixed(4)}) reached.`;
          signal.completedAt = now;
          signal.exitPrice = signal.stopLoss;
          signal.pnlPercent = -Math.abs(((signal.stopLoss - signal.entryPrice) / signal.entryPrice) * 100);
          hasChanges = true;
        } else if (now >= signal.expiryTimestamp) {
          signal.status = 'EXPIRED';
          signal.statusReason = `Expired after ${signal.expiryCandles} candle periods without reaching TP or SL.`;
          signal.completedAt = now;
          signal.exitPrice = currentPrice;
          signal.pnlPercent = ((signal.entryPrice - currentPrice) / signal.entryPrice) * 100;
          hasChanges = true;
        }
      }
    }

    if (hasChanges) {
      // Keep signals array in sync
      this.syncActiveSignalsArray();
    }
  }

  syncActiveSignalsArray() {
    // Current signals shown in main view are active signals plus recent completed
    const all = Array.from(this.performanceSignals.values());
    all.sort((a, b) => (b.confidence || 0) - (a.confidence || 0));
    this.signals = all;
  }

  async runScan(timeframe = '15m') {
    if (this.isScanning) return;
    this.isScanning = true;
    this.status = 'scanning';
    this.timeframe = timeframe;

    try {
      const allTickers = marketCache.getAllTickers();
      const topSymbols = allTickers
        .filter((t) => t.lastPrice !== '--')
        .sort((a, b) => (parseFloat(b.quoteVolume) || 0) - (parseFloat(a.quoteVolume) || 0))
        .map((t) => t.symbol);

      const scanList = Array.from(new Set([...PRIORITY_SYMBOLS, ...topSymbols.slice(0, 35)])).slice(0, 30);

      const pendingSetups = [];
      let processed = 0;

      for (const symbol of scanList) {
        try {
          const rawCandles = await fetchKlines(symbol, timeframe, 60);
          if (!rawCandles || rawCandles.length < 15) continue;

          // Process only closed candles (last candle is fluctuating)
          const closedCandles = rawCandles.slice(0, rawCandles.length - 1);
          const currentPrice = rawCandles[rawCandles.length - 1].close;

          const analysis = this.analyzeCandles(symbol, timeframe, closedCandles, currentPrice);
          if (analysis.signal) {
            // Check if we already have this signal
            const existing = this.performanceSignals.get(analysis.signal.id);
            if (!existing) {
              this.performanceSignals.set(analysis.signal.id, analysis.signal);
            }
          }
          if (analysis.pendingRetest) {
            pendingSetups.push(analysis.pendingRetest);
          }
          processed++;
        } catch (err) {
          // continue
        }
      }

      this.pendingRetests = pendingSetups;
      this.scannedCount = processed;
      this.lastScanTime = Date.now();
      this.status = 'ready';

      // Update signal list and watch immediately
      this.syncActiveSignalsArray();
      this.watchActiveSignals();
    } catch (err) {
      console.warn('[scannerService] Error during scan:', err.message);
      this.status = 'idle';
    } finally {
      this.isScanning = false;
    }
  }

  /**
   * Scans specifically the asset selected on the active chart.
   * Does NOT scan a random asset.
   * Does NOT switch the selected asset.
   * Uses real closed candles and live market data.
   */
  async scanSingleAsset(symbol, timeframe = '15m') {
    if (!symbol) return null;
    try {
      const rawCandles = await fetchKlines(symbol, timeframe, 60);
      if (!rawCandles || rawCandles.length < 15) {
        return {
          asset: symbol,
          timeframe,
          signal: null,
          pendingRetest: null,
          message: 'Insufficient historical candle data.'
        };
      }

      const closedCandles = rawCandles.slice(0, rawCandles.length - 1);
      const currentPrice = rawCandles[rawCandles.length - 1].close;

      const analysis = this.analyzeCandles(symbol, timeframe, closedCandles, currentPrice);
      if (analysis.signal) {
        this.performanceSignals.set(analysis.signal.id, analysis.signal);
        this.syncActiveSignalsArray();
        this.watchActiveSignals();
      }
      if (analysis.pendingRetest) {
        this.pendingRetests = [
          analysis.pendingRetest,
          ...this.pendingRetests.filter((p) => p.asset !== symbol)
        ];
      }

      return {
        asset: symbol,
        timeframe,
        currentPrice,
        signal: analysis.signal,
        pendingRetest: analysis.pendingRetest,
        scannedAt: Date.now()
      };
    } catch (err) {
      console.warn(`[scannerService] Error scanning single asset ${symbol}:`, err.message);
      return {
        asset: symbol,
        timeframe,
        signal: null,
        pendingRetest: null,
        error: err.message
      };
    }
  }

  analyzeCandles(symbol, timeframe, closedCandles, currentPrice) {
    const len = closedCandles.length;
    if (len < 10) return { signal: null, pendingRetest: null };

    const c0 = closedCandles[len - 1]; // Most recently closed candle
    const c1 = closedCandles[len - 2];
    const c2 = closedCandles[len - 3];

    // Volume comparison
    const volLookback = Math.min(20, len);
    let volSum = 0;
    for (let i = len - volLookback; i < len; i++) {
      volSum += closedCandles[i].volume || 0;
    }
    const avgVol = volSum / volLookback || 1;
    const isVolExpanding = (c0.volume || 0) > avgVol * 1.15;

    // 1. Identify Fractal Swing Highs and Lows (2-bar pivot)
    const swingHighs = [];
    const swingLows = [];

    for (let i = 2; i < len - 2; i++) {
      const cur = closedCandles[i];
      const prev1 = closedCandles[i - 1];
      const prev2 = closedCandles[i - 2];
      const next1 = closedCandles[i + 1];
      const next2 = closedCandles[i + 2];

      if (cur.high > prev1.high && cur.high > prev2.high && cur.high > next1.high && cur.high > next2.high) {
        swingHighs.push({ price: cur.high, index: i, time: cur.openTime });
      }
      if (cur.low < prev1.low && cur.low < prev2.low && cur.low < next1.low && cur.low < next2.low) {
        swingLows.push({ price: cur.low, index: i, time: cur.openTime });
      }
    }

    const lastHigh = swingHighs.length > 0 ? swingHighs[swingHighs.length - 1].price : Math.max(...closedCandles.slice(-15).map((c) => c.high));
    const lastLow = swingLows.length > 0 ? swingLows[swingLows.length - 1].price : Math.min(...closedCandles.slice(-15).map((c) => c.low));

    const c0Range = c0.high - c0.low || 0.0001;
    const c0UpperWick = c0.high - Math.max(c0.open, c0.close);
    const c0LowerWick = Math.min(c0.open, c0.close) - c0.low;
    const c0Body = Math.abs(c0.close - c0.open);
    const c0IsGreen = c0.close >= c0.open;
    const c1IsGreen = c1.close >= c1.open;

    const isDecisiveBody = c0Body / c0Range > 0.48;

    let signal = null;
    let pendingRetest = null;

    // =========================================================================
    // TIER 1: BREAK & RETEST (Reinforced Setup)
    // =========================================================================
    if (c1.close > lastHigh && c0.low <= lastHigh && c0.close > lastHigh && c0IsGreen) {
      signal = this.createSignalItem({
        symbol,
        timeframe,
        direction: 'UP',
        setupType: 'Break & Retest (Reinforced)',
        closePrice: c0.close,
        invalidationLevel: Math.min(c0.low, lastHigh * 0.994),
        confidence: 96,
        reason: `Break & Retest Confirmed: Previous resistance ($${lastHigh.toFixed(2)}) defended as new support with lower wick rejection and green continuation close.`,
        timestamp: c0.closeTime
      });
    } else if (c1.close < lastLow && c0.high >= lastLow && c0.close < lastLow && !c0IsGreen) {
      signal = this.createSignalItem({
        symbol,
        timeframe,
        direction: 'DOWN',
        setupType: 'Break & Retest (Reinforced)',
        closePrice: c0.close,
        invalidationLevel: Math.max(c0.high, lastLow * 1.006),
        confidence: 96,
        reason: `Break & Retest Confirmed: Previous support ($${lastLow.toFixed(2)}) rejected as new resistance with upper wick rejection and red continuation close.`,
        timestamp: c0.closeTime
      });
    }

    // =========================================================================
    // TIER 2: STRONG CONFIRMED BREAK (BOS) - RETEST OPTIONAL
    // =========================================================================
    if (!signal) {
      const isStrongBullishBreak =
        c0.close > lastHigh &&
        (c1.close <= lastHigh || c2.close <= lastHigh) &&
        c0IsGreen &&
        isDecisiveBody;

      const isStrongBearishBreak =
        c0.close < lastLow &&
        (c1.close >= lastLow || c2.close >= lastLow) &&
        !c0IsGreen &&
        isDecisiveBody;

      if (isStrongBullishBreak) {
        signal = this.createSignalItem({
          symbol,
          timeframe,
          direction: 'UP',
          setupType: 'Strong Confirmed Break (BOS)',
          closePrice: c0.close,
          invalidationLevel: Math.max(lastHigh * 0.993, c0.low),
          confidence: isVolExpanding ? 93 : 90,
          reason: `Strong Confirmed Break: Candle closed firmly above swing resistance $${lastHigh.toFixed(2)} with decisive bullish momentum${isVolExpanding ? ' and expanding volume' : ''}. Retest not required.`,
          timestamp: c0.closeTime
        });
      } else if (isStrongBearishBreak) {
        signal = this.createSignalItem({
          symbol,
          timeframe,
          direction: 'DOWN',
          setupType: 'Strong Confirmed Break (BOS)',
          closePrice: c0.close,
          invalidationLevel: Math.min(lastLow * 1.007, c0.high),
          confidence: isVolExpanding ? 93 : 90,
          reason: `Strong Confirmed Breakdown: Candle closed firmly below swing support $${lastLow.toFixed(2)} with decisive bearish momentum${isVolExpanding ? ' and expanding volume' : ''}. Retest not required.`,
          timestamp: c0.closeTime
        });
      }
    }

    // =========================================================================
    // TIER 3: FAKEOUT REJECTION
    // =========================================================================
    if (!signal) {
      if (c0.high > lastHigh && c0.close < lastHigh && (c0UpperWick / c0Range) > 0.45 && !c0IsGreen) {
        signal = this.createSignalItem({
          symbol,
          timeframe,
          direction: 'DOWN',
          setupType: 'Fakeout Rejection',
          closePrice: c0.close,
          invalidationLevel: c0.high,
          confidence: 89,
          reason: `Fakeout Rejection: Liquidity sweep above resistance $${lastHigh.toFixed(2)} met with aggressive seller absorption and heavy upper wick rejection.`,
          timestamp: c0.closeTime
        });
      } else if (c0.low < lastLow && c0.close > lastLow && (c0LowerWick / c0Range) > 0.45 && c0IsGreen) {
        signal = this.createSignalItem({
          symbol,
          timeframe,
          direction: 'UP',
          setupType: 'Fakeout Rejection',
          closePrice: c0.close,
          invalidationLevel: c0.low,
          confidence: 89,
          reason: `Fakeout Rejection: Liquidity sweep below support $${lastLow.toFixed(2)} met with aggressive buyer absorption and strong lower wick defense.`,
          timestamp: c0.closeTime
        });
      }
    }

    // =========================================================================
    // TIER 4: ENGULFING CONFIRMATION
    // =========================================================================
    if (!signal) {
      const isBullishEngulfing = c0IsGreen && !c1IsGreen && c0.close > c1.open && c0.open <= c1.close;
      const isBearishEngulfing = !c0IsGreen && c1IsGreen && c0.close < c1.open && c0.open >= c1.close;

      if (isBullishEngulfing && Math.abs(c0.low - lastLow) / lastLow < 0.018) {
        signal = this.createSignalItem({
          symbol,
          timeframe,
          direction: 'UP',
          setupType: 'Engulfing Confirmation',
          closePrice: c0.close,
          invalidationLevel: c0.low,
          confidence: 86,
          reason: `Bullish Engulfing Confirmation: Closed at key structural support zone $${lastLow.toFixed(2)} engulfing previous candle body.`,
          timestamp: c0.closeTime
        });
      } else if (isBearishEngulfing && Math.abs(c0.high - lastHigh) / lastHigh < 0.018) {
        signal = this.createSignalItem({
          symbol,
          timeframe,
          direction: 'DOWN',
          setupType: 'Engulfing Confirmation',
          closePrice: c0.close,
          invalidationLevel: c0.high,
          confidence: 86,
          reason: `Bearish Engulfing Confirmation: Closed at key structural resistance zone $${lastHigh.toFixed(2)} engulfing previous candle body.`,
          timestamp: c0.closeTime
        });
      }
    }

    // =========================================================================
    // PENDING RETEST TRACKING
    // =========================================================================
    const distToHigh = Math.abs(currentPrice - lastHigh) / lastHigh;
    const distToLow = Math.abs(currentPrice - lastLow) / lastLow;

    if (distToHigh < 0.014 && currentPrice >= lastHigh) {
      pendingRetest = {
        asset: symbol,
        timeframe,
        targetLevel: lastHigh,
        currentPrice,
        direction: 'UP',
        note: `Pulling back to test broken resistance ($${lastHigh.toFixed(2)}) as prospective support.`
      };
    } else if (distToLow < 0.014 && currentPrice <= lastLow) {
      pendingRetest = {
        asset: symbol,
        timeframe,
        targetLevel: lastLow,
        currentPrice,
        direction: 'DOWN',
        note: `Pulling back to test broken support ($${lastLow.toFixed(2)}) as prospective resistance.`
      };
    }

    return { signal, pendingRetest };
  }

  /**
   * Computes comprehensive performance stats by setup, timeframe, asset, and direction
   */
  computePerformanceStats() {
    const signals = Array.from(this.performanceSignals.values());

    let activeCount = 0;
    let winsCount = 0;
    let lossesCount = 0;
    let expiredCount = 0;

    let winPnlSum = 0;
    let lossPnlSum = 0;

    const bySetupType = {};
    const byTimeframe = {};
    const byDirection = {
      UP: { total: 0, wins: 0, losses: 0, expired: 0, active: 0, tpRate: 0, avgPnlPercent: 0 },
      DOWN: { total: 0, wins: 0, losses: 0, expired: 0, active: 0, tpRate: 0, avgPnlPercent: 0 }
    };
    const byAsset = {};

    function updateGroup(group, key, status, pnl = 0) {
      if (!group[key]) {
        group[key] = { total: 0, wins: 0, losses: 0, expired: 0, active: 0, tpRate: 0, avgPnlPercent: 0, _pnlSum: 0 };
      }
      const item = group[key];
      item.total++;
      if (status === 'ACTIVE') item.active++;
      else if (status === 'WIN') {
        item.wins++;
        item._pnlSum += pnl;
      } else if (status === 'LOSS') {
        item.losses++;
        item._pnlSum += pnl;
      } else if (status === 'EXPIRED') {
        item.expired++;
      }
      const settled = item.wins + item.losses;
      item.tpRate = settled > 0 ? parseFloat(((item.wins / settled) * 100).toFixed(1)) : 0;
      item.avgPnlPercent = settled > 0 ? parseFloat((item._pnlSum / settled).toFixed(2)) : 0;
    }

    for (const s of signals) {
      const pnl = s.pnlPercent || 0;
      if (s.status === 'ACTIVE') activeCount++;
      else if (s.status === 'WIN') {
        winsCount++;
        winPnlSum += pnl;
      } else if (s.status === 'LOSS') {
        lossesCount++;
        lossPnlSum += Math.abs(pnl);
      } else if (s.status === 'EXPIRED') {
        expiredCount++;
      }

      updateGroup(bySetupType, s.setupType, s.status, pnl);
      updateGroup(byTimeframe, s.timeframe, s.status, pnl);
      if (s.direction === 'UP' || s.direction === 'DOWN') {
        updateGroup(byDirection, s.direction, s.status, pnl);
      }
      updateGroup(byAsset, s.asset, s.status, pnl);
    }

    const settledTotal = winsCount + lossesCount;
    const tpRate = settledTotal > 0 ? parseFloat(((winsCount / settledTotal) * 100).toFixed(1)) : 0;
    const avgWinPercent = winsCount > 0 ? parseFloat((winPnlSum / winsCount).toFixed(2)) : 0;
    const avgLossPercent = lossesCount > 0 ? parseFloat((lossPnlSum / lossesCount).toFixed(2)) : 0;
    const profitFactor = lossPnlSum > 0 ? parseFloat((winPnlSum / lossPnlSum).toFixed(2)) : winsCount > 0 ? 9.99 : 0;

    return {
      totalSignals: signals.length,
      activeCount,
      completedCount: settledTotal + expiredCount,
      winsCount,
      lossesCount,
      expiredCount,
      tpRate,
      avgWinPercent,
      avgLossPercent,
      profitFactor,
      bySetupType,
      byTimeframe,
      byDirection,
      byAsset
    };
  }

  getScanData() {
    return {
      status: this.status,
      timeframe: this.timeframe,
      scannedCount: this.scannedCount,
      totalSymbols: marketCache.tickers.size,
      lastScanTime: this.lastScanTime,
      signals: this.signals,
      pendingRetests: this.pendingRetests,
      performance: this.computePerformanceStats()
    };
  }
}

export const scannerService = new ScannerService();
export default scannerService;
