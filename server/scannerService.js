/**
 * NWWT Market Scanner Service - Intelligence & 4-Model Research Engine
 *
 * Scans the spot USDT watchlist using strictly REAL CLOSED CANDLES.
 * Evaluates pure NWWT technical structure:
 * - Market Structure (Bullish / Bearish / Range)
 * - Support & Resistance key levels
 * - Strong Confirmed Breaks (BOS / Breakout): Retest is OPTIONAL
 * - Break and Retest: Retest strengthens an existing setup (boosts confidence)
 * - Fakeout Rejection (Liquidity sweep & immediate reversal)
 * - Engulfing Confirmation at key structure levels
 *
 * AI MARKET STRUCTURE INTELLIGENCE LAYER:
 * - Detects Market Regime: trending_up, trending_down, ranging, high_volatility, low_volatility, transition
 * - Deep validation of trend strength, swing levels, S/R clearance, rejection/continuation wicks, R:R
 * - Strict decision output: 'allow' | 'reject' | 'wait'
 * - Adaptive performance filter with sample-size safeguards (minimum 4 samples required to adapt)
 *
 * 4 INDEPENDENT RESEARCH MODES:
 * 1. Original Strategy (baseline technical rules)
 * 2. Inverse Strategy (flipped direction, mirrored TP & SL)
 * 3. AI Filtered Strategy (only setups receiving 'allow' validation)
 * 4. AI Filtered Inverse Strategy (inverse setups passing structural validation)
 *
 * WALK-FORWARD VALIDATION:
 * - In-Sample (60%) vs Out-of-Sample (40%) split without future data leakage
 * - Educational market analysis only. Never provides automated trade execution.
 */

import { fetchKlines, normalizeSymbol } from './binanceRest.js';
import { marketCache } from './marketCache.js';
import { symbolManager } from './symbolManager.js';
import {
  detectMarketRegime,
  validateSetupWithStructureIntelligence,
  createInverseSignal,
  calculateWalkForwardValidation
} from './structureIntelligence.js';
import { calculateMarketStructureLevels } from './marketStructureLevels.js';
import {
  evaluateMarketStructureQuality,
  isPermanentlyExcludedSymbol,
  createPermanentlyExcludedResult,
  PERMANENT_EXCLUDED_SYMBOLS
} from './marketStructureQuality.js';

// Top liquid USDT pairs prioritized for scanner depth
const PRIORITY_SYMBOLS = [
  'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'DOGEUSDT',
  'XRPUSDT', 'ADAUSDT', 'AVAXUSDT', 'LINKUSDT', 'SUIUSDT',
  'NEARUSDT', 'APTUSDT', 'OPUSDT', 'ARBUSDT', 'DOTUSDT',
  'FETUSDT', 'PEPEUSDT', 'SHIBUSDT', 'LTCUSDT', 'MATICUSDT',
  'TIAUSDT', 'RENDERUSDT', 'INJUSDT', 'SEIUSDT', 'WLDUSDT'
];

export function getTimeframeMinutes(tf) {
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

/**
 * Returns the logical higher timeframe for a given entry timeframe
 */
export function getLogicalHigherTimeframe(entryTf) {
  switch (entryTf) {
    case '1m': return '5m';
    case '5m': return '15m';
    case '15m': return '1h';
    case '30m': return '2h';
    case '1h': return '4h';
    case '2h': return '6h';
    case '4h': return '1d';
    case '6h': return '1d';
    case '8h': return '1d';
    case '12h': return '1d';
    case '1d': return '1w';
    case '1w': return '1M';
    default: return '1h';
  }
}

/**
 * Evaluates Higher Timeframe (HTF) trend & regime confirmation
 * Rule modes:
 * - lenient: Not hard opposed (e.g. neutral, ranging, low_volatility allowed)
 * - aligned: Trend direction must directly match setup direction
 * - strict: Aligned trend AND regime is not in conflicting transition/reversal
 */
export function evaluateHtfConfirmation({ setupDirection, entryTimeframe, htfTimeframe, htfClosedCandles, ruleMode = 'lenient' }) {
  if (!htfClosedCandles || htfClosedCandles.length < 10) {
    return {
      status: 'rejected',
      reason: `Insufficient higher timeframe (${htfTimeframe}) candle history for confirmation.`,
      metrics: { entryTimeframe, higherTfTimeframe: htfTimeframe }
    };
  }

  const htfRegimeData = detectMarketRegime(htfClosedCandles);
  const trendDir = htfRegimeData.trendDirection || 'neutral';
  const regime = htfRegimeData.regime || 'ranging';

  const isBullish = trendDir === 'bullish';
  const isBearish = trendDir === 'bearish';
  const isNeutral = trendDir === 'neutral';

  const wantsUp = setupDirection === 'UP';
  const wantsDown = setupDirection === 'DOWN';

  if (ruleMode === 'strict') {
    if (wantsUp && isBullish && regime !== 'transition') {
      return {
        status: 'confirmed',
        htfTimeframe,
        htfRegime: regime,
        htfTrendDirection: trendDir,
        reason: `Strict HTF Confluence: ${htfTimeframe} trend is bullish with aligned regime (${regime}).`,
        metrics: { entryTimeframe, higherTfRegime: regime, higherTfTrend: trendDir }
      };
    }
    if (wantsDown && isBearish && regime !== 'transition') {
      return {
        status: 'confirmed',
        htfTimeframe,
        htfRegime: regime,
        htfTrendDirection: trendDir,
        reason: `Strict HTF Confluence: ${htfTimeframe} trend is bearish with aligned regime (${regime}).`,
        metrics: { entryTimeframe, higherTfRegime: regime, higherTfTrend: trendDir }
      };
    }
    return {
      status: 'rejected',
      htfTimeframe,
      htfRegime: regime,
      htfTrendDirection: trendDir,
      reason: `Strict HTF Filter: ${htfTimeframe} trend (${trendDir}) or regime (${regime}) does not strictly match ${setupDirection} setup.`,
      metrics: { entryTimeframe, higherTfRegime: regime, higherTfTrend: trendDir }
    };
  }

  if (ruleMode === 'aligned') {
    if (wantsUp && isBullish) {
      return {
        status: 'confirmed',
        htfTimeframe,
        htfRegime: regime,
        htfTrendDirection: trendDir,
        reason: `Aligned HTF Confluence: ${htfTimeframe} trend direction is bullish.`,
        metrics: { entryTimeframe, higherTfRegime: regime, higherTfTrend: trendDir }
      };
    }
    if (wantsDown && isBearish) {
      return {
        status: 'confirmed',
        htfTimeframe,
        htfRegime: regime,
        htfTrendDirection: trendDir,
        reason: `Aligned HTF Confluence: ${htfTimeframe} trend direction is bearish.`,
        metrics: { entryTimeframe, higherTfRegime: regime, higherTfTrend: trendDir }
      };
    }
    return {
      status: 'rejected',
      htfTimeframe,
      htfRegime: regime,
      htfTrendDirection: trendDir,
      reason: `Aligned HTF Filter: ${htfTimeframe} trend is ${trendDir}, not aligned with ${setupDirection} setup.`,
      metrics: { entryTimeframe, higherTfRegime: regime, higherTfTrend: trendDir }
    };
  }

  // 'lenient' mode: setup is approved unless HTF is directly opposed
  if (wantsUp && isBearish) {
    return {
      status: 'rejected',
      htfTimeframe,
      htfRegime: regime,
      htfTrendDirection: trendDir,
      reason: `HTF Filter Rejection: ${htfTimeframe} trend is directly bearish opposing UP setup.`,
      metrics: { entryTimeframe, higherTfRegime: regime, higherTfTrend: trendDir }
    };
  }
  if (wantsDown && isBullish) {
    return {
      status: 'rejected',
      htfTimeframe,
      htfRegime: regime,
      htfTrendDirection: trendDir,
      reason: `HTF Filter Rejection: ${htfTimeframe} trend is directly bullish opposing DOWN setup.`,
      metrics: { entryTimeframe, higherTfRegime: regime, higherTfTrend: trendDir }
    };
  }

  return {
    status: 'confirmed',
    htfTimeframe,
    htfRegime: regime,
    htfTrendDirection: trendDir,
    reason: `Lenient HTF Confluence: ${htfTimeframe} trend (${trendDir}) is not opposed to ${setupDirection}.`,
    metrics: { entryTimeframe, higherTfRegime: regime, higherTfTrend: trendDir }
  };
}

class ScannerService {
  constructor() {
    this.status = 'ready'; // 'ready' | 'scanning' | 'idle'
    this.timeframe = '15m'; // Entry timeframe
    this.signals = []; // Active/recent signals from current scan
    this.pendingRetests = [];
    this.scannedCount = 0;
    this.lastScanTime = 0;
    this.scanInterval = null;
    this.watchInterval = null;
    this.isScanning = false;
    this.onUpdate = null;

    // Multi-Timeframe Confirmation Settings
    this.htfConfirmationEnabled = false;
    this.htfTimeframe = '1h';
    this.htfRuleMode = 'lenient'; // 'lenient' | 'aligned' | 'strict'

    // Fair Rotation Scanner State
    this.currentBatchCursor = 0;
    this.batchSize = 25; // Evaluates 25 pairs per cycle to respect Binance REST limit
    this.coverageStats = {
      totalEligibleSymbols: 0,
      batchSize: 25,
      batchIndex: 0,
      totalBatches: 1,
      cycleDurationMs: 0,
      estFullRotationSeconds: 0,
      coveragePercent: 0,
      lastBatchCompletedAt: 0
    };

    // In-Memory Performance History: Map of id -> ScannerSignalItem
    this.performanceSignals = new Map();

    // In-Memory Quality Diagnostics Map: Key = `${symbol}-${timeframe}` -> MarketStructureQualityResult
    this.qualityDiagnostics = new Map();
  }

  /**
   * Checks whether a signal has already been generated or recorded for a specific closed candle
   * Prevents duplicate signals from being generated from the same closed candle.
   */
  hasSignalForCandle(symbol, timeframe, closeTime) {
    if (!closeTime) return false;
    for (const s of this.performanceSignals.values()) {
      if (
        s.asset === symbol &&
        s.timeframe === timeframe &&
        (s.confirmedCandleCloseTime === closeTime || s.timestamp === closeTime)
      ) {
        return true;
      }
    }
    return false;
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
   * Generates a fully validated trade signal anchored strictly to chart structure
   * Rejects trade if no logical structural stop loss exists or if R:R is unfavorable.
   */
  generateStructuralSignal({
    symbol,
    timeframe,
    direction,
    setupType,
    closePrice,
    confidence,
    reason,
    timestamp,
    confirmedCandleCloseTime,
    closedCandles,
    fiveMinCandles,
    regimeData,
    marketStructureQuality,
    htfConfirmation = null
  }) {
    const structureLevels = calculateMarketStructureLevels({
      symbol,
      timeframe,
      direction,
      entryPrice: closePrice,
      candles: closedCandles,
      fiveMinCandles,
      setupType
    });

    if (!structureLevels || !structureLevels.isValid) {
      // Rule 7: No Forced Trades - reject trade if logical stop cannot be identified or R:R is unfavorable
      return null;
    }

    return this.createSignalItem({
      symbol,
      timeframe,
      direction,
      setupType,
      closePrice,
      invalidationLevel: structureLevels.stopLoss,
      stopLoss: structureLevels.stopLoss,
      takeProfit1: structureLevels.takeProfit1,
      takeProfit2: structureLevels.takeProfit2,
      rewardRiskRatio: structureLevels.rewardRiskRatio,
      riskDistance: structureLevels.riskDistance,
      targetDistance: structureLevels.targetDistance,
      structureReference: structureLevels.structureReference,
      confidence,
      reason,
      timestamp,
      confirmedCandleCloseTime,
      modelType: 'original',
      marketRegime: regimeData.regime,
      marketStructureQuality,
      htfConfirmation
    });
  }

  /**
   * Helper to construct a Signal Item with exact entry, TP, and SL
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
    timestamp,
    confirmedCandleCloseTime,
    modelType = 'original',
    marketRegime = 'ranging',
    aiValidation = null,
    signalConditions = null,
    marketStructureQuality = null,
    htfConfirmation = null,
    // Structure-based levels
    stopLoss: customStopLoss,
    takeProfit1: customTakeProfit1,
    takeProfit2: customTakeProfit2,
    rewardRiskRatio: customRR,
    riskDistance: customRiskDist,
    targetDistance: customTargetDist,
    structureReference: customStructureRef
  }) {
    const entryPrice = closePrice;
    let stopLoss = customStopLoss !== undefined ? customStopLoss : invalidationLevel;
    let takeProfit1 = customTakeProfit1;
    let takeProfit2 = customTakeProfit2;
    let rewardRiskRatio = customRR;

    const tfMins = getTimeframeMinutes(timeframe);
    const expiryCandles = 24;
    const expiryTimestamp = timestamp + expiryCandles * tfMins * 60 * 1000;

    if (direction === 'UP') {
      if (stopLoss === undefined || stopLoss >= entryPrice) {
        stopLoss = invalidationLevel && invalidationLevel < entryPrice ? invalidationLevel : entryPrice * 0.985;
      }
      const risk = entryPrice - stopLoss;
      if (takeProfit1 === undefined) {
        takeProfit1 = entryPrice + risk * 1.5;
      }
      if (rewardRiskRatio === undefined) {
        rewardRiskRatio = parseFloat((risk > 0 ? (takeProfit1 - entryPrice) / risk : 1.0).toFixed(2));
      }
    } else {
      if (stopLoss === undefined || stopLoss <= entryPrice) {
        stopLoss = invalidationLevel && invalidationLevel > entryPrice ? invalidationLevel : entryPrice * 1.015;
      }
      const risk = stopLoss - entryPrice;
      if (takeProfit1 === undefined) {
        takeProfit1 = entryPrice - risk * 1.5;
      }
      if (rewardRiskRatio === undefined) {
        rewardRiskRatio = parseFloat((risk > 0 ? (entryPrice - takeProfit1) / risk : 1.0).toFixed(2));
      }
    }
    const takeProfit = takeProfit1; // Preserves exact existing take profit calculation
    const riskDistance = customRiskDist !== undefined ? customRiskDist : Math.abs(entryPrice - stopLoss);
    const targetDistance = customTargetDist !== undefined ? customTargetDist : Math.abs(takeProfit1 - entryPrice);

    const typePrefix = modelType === 'original' ? '' : `-${modelType}`;
    const confirmedTime = confirmedCandleCloseTime || timestamp;
    const id = `${symbol}-${timeframe}-${setupType.toLowerCase().replace(/[^a-z0-9]/g, '')}-${direction.toLowerCase()}-${confirmedTime}${typePrefix}`;

    return {
      id,
      asset: symbol,
      timeframe,
      direction,
      setupType,
      signalPrice: entryPrice,
      entryPrice,
      takeProfit,
      takeProfit1,
      takeProfit2,
      stopLoss,
      invalidationLevel: stopLoss,
      rewardRiskRatio,
      riskDistance,
      targetDistance,
      structureReference: customStructureRef,
      confidence,
      reason,
      timestamp,
      confirmedCandleCloseTime: confirmedTime,
      tp1Hit: false,
      tp2Hit: false,
      isTradeComplete: false,
      status: 'ACTIVE',
      statusReason: 'Watching live prices against TP and SL',
      displayMessage: '',
      expiryCandles,
      expiryTimestamp,
      highestReached: entryPrice,
      lowestReached: entryPrice,
      modelType,
      marketRegime,
      aiValidation,
      signalConditions,
      marketStructureQuality,
      htfConfirmation
    };
  }

  /**
   * Live Market Data Watcher for Active Signals across all 4 research models
   * Automatically monitors TP #1, TP #2, and SL in real-time background
   */
  watchActiveSignals() {
    const now = Date.now();
    let hasChanges = false;

    for (const [id, signal] of this.performanceSignals.entries()) {
      if (isPermanentlyExcludedSymbol(signal.asset)) {
        this.performanceSignals.delete(id);
        hasChanges = true;
        continue;
      }

      if (signal.isTradeComplete || signal.status === 'LOSS' || signal.status === 'EXPIRED') continue;

      const ticker = marketCache.getTicker(signal.asset);
      if (!ticker || ticker.lastPrice === '--') continue;

      const currentPrice = parseFloat(ticker.lastPrice);
      if (isNaN(currentPrice)) continue;

      signal.highestReached = Math.max(signal.highestReached || currentPrice, currentPrice);
      signal.lowestReached = Math.min(signal.lowestReached || currentPrice, currentPrice);

      const isUp = signal.direction === 'UP';
      const tp1 = signal.takeProfit1 || signal.takeProfit;
      const risk = Math.abs(signal.entryPrice - signal.stopLoss);
      const tp2 = signal.takeProfit2 || (isUp ? signal.entryPrice + risk * 2.5 : signal.entryPrice - risk * 2.5);
      const sl = signal.stopLoss;
      const rrStr = (signal.rewardRiskRatio || 1.50).toFixed(2);

      if (isUp) {
        if (signal.tp1Hit) {
          // TP1 already hit: monitoring for TP2 or reversal
          const tp2Reached = currentPrice >= tp2;
          const slReached = currentPrice <= sl;

          if (tp2Reached) {
            signal.tp2Hit = true;
            signal.tp2HitTimestamp = now;
            signal.tp2Price = tp2;
            signal.isTradeComplete = true;
            signal.status = 'WIN';
            signal.displayMessage = 'tp #2 hit | trade complete';
            signal.statusReason = 'tp #2 hit | trade complete';
            signal.completedAt = now;
            signal.durationMs = now - signal.timestamp;
            signal.exitPrice = tp2;
            signal.pnlPercent = Math.abs(((tp2 - signal.entryPrice) / signal.entryPrice) * 100);
            hasChanges = true;
          } else if (slReached) {
            // Reversal after TP1 secured: permanently remains a WIN!
            signal.isTradeComplete = true;
            signal.status = 'WIN';
            signal.displayMessage = `tp #1 hit | r:r ${rrStr} | win`;
            signal.statusReason = `tp #1 hit | r:r ${rrStr} | win (reversal to SL)`;
            signal.completedAt = now;
            signal.durationMs = now - signal.timestamp;
            signal.exitPrice = sl;
            hasChanges = true;
          }
        } else {
          // TP1 has not yet been hit
          const tp2Reached = currentPrice >= tp2;
          const tp1Reached = currentPrice >= tp1;
          const slReached = currentPrice <= sl;

          if (tp1Reached && slReached) {
            signal.status = 'LOSS';
            signal.isTradeComplete = true;
            signal.statusReason = `Conservative SL: Both TP and SL were breached in same period.`;
            signal.completedAt = now;
            signal.durationMs = now - signal.timestamp;
            signal.exitPrice = sl;
            signal.pnlPercent = -Math.abs(((signal.entryPrice - sl) / signal.entryPrice) * 100);
            hasChanges = true;
          } else if (tp2Reached) {
            signal.tp1Hit = true;
            signal.tp1HitTimestamp = now;
            signal.tp1Price = tp1;
            signal.tp2Hit = true;
            signal.tp2HitTimestamp = now;
            signal.tp2Price = tp2;
            signal.isTradeComplete = true;
            signal.status = 'WIN';
            signal.displayMessage = 'tp #2 hit | trade complete';
            signal.statusReason = 'tp #2 hit | trade complete';
            signal.completedAt = now;
            signal.durationMs = now - signal.timestamp;
            signal.exitPrice = tp2;
            signal.pnlPercent = Math.abs(((tp2 - signal.entryPrice) / signal.entryPrice) * 100);
            hasChanges = true;
          } else if (tp1Reached) {
            signal.tp1Hit = true;
            signal.tp1HitTimestamp = now;
            signal.tp1Price = tp1;
            signal.isTradeComplete = true;
            signal.status = 'WIN';
            signal.displayMessage = `tp hit | r:r ${rrStr} | win`;
            signal.statusReason = `tp hit | r:r ${rrStr} | win`;
            signal.completedAt = now;
            signal.durationMs = now - signal.timestamp;
            signal.exitPrice = tp1;
            signal.pnlPercent = Math.abs(((tp1 - signal.entryPrice) / signal.entryPrice) * 100);
            hasChanges = true;
          } else if (slReached) {
            signal.status = 'LOSS';
            signal.isTradeComplete = true;
            signal.statusReason = `Stop loss level ($${sl.toFixed(4)}) reached.`;
            signal.completedAt = now;
            signal.durationMs = now - signal.timestamp;
            signal.exitPrice = sl;
            signal.pnlPercent = -Math.abs(((signal.entryPrice - sl) / signal.entryPrice) * 100);
            hasChanges = true;
          } else if (now >= signal.expiryTimestamp) {
            signal.status = 'EXPIRED';
            signal.isTradeComplete = true;
            signal.statusReason = `Expired after ${signal.expiryCandles} candle periods without reaching TP or SL.`;
            signal.completedAt = now;
            signal.durationMs = now - signal.timestamp;
            signal.exitPrice = currentPrice;
            signal.pnlPercent = ((currentPrice - signal.entryPrice) / signal.entryPrice) * 100;
            hasChanges = true;
          }
        }
      } else {
        // DOWN Direction
        if (signal.tp1Hit) {
          const tp2Reached = currentPrice <= tp2;
          const slReached = currentPrice >= sl;

          if (tp2Reached) {
            signal.tp2Hit = true;
            signal.tp2HitTimestamp = now;
            signal.tp2Price = tp2;
            signal.isTradeComplete = true;
            signal.status = 'WIN';
            signal.displayMessage = 'tp #2 hit | trade complete';
            signal.statusReason = 'tp #2 hit | trade complete';
            signal.completedAt = now;
            signal.durationMs = now - signal.timestamp;
            signal.exitPrice = tp2;
            signal.pnlPercent = Math.abs(((signal.entryPrice - tp2) / signal.entryPrice) * 100);
            hasChanges = true;
          } else if (slReached) {
            signal.isTradeComplete = true;
            signal.status = 'WIN';
            signal.displayMessage = `tp #1 hit | r:r ${rrStr} | win`;
            signal.statusReason = `tp #1 hit | r:r ${rrStr} | win (reversal to SL)`;
            signal.completedAt = now;
            signal.durationMs = now - signal.timestamp;
            signal.exitPrice = sl;
            hasChanges = true;
          }
        } else {
          const tp2Reached = currentPrice <= tp2;
          const tp1Reached = currentPrice <= tp1;
          const slReached = currentPrice >= sl;

          if (tp1Reached && slReached) {
            signal.status = 'LOSS';
            signal.isTradeComplete = true;
            signal.statusReason = `Conservative SL: Both TP and SL were breached in same period.`;
            signal.completedAt = now;
            signal.durationMs = now - signal.timestamp;
            signal.exitPrice = sl;
            signal.pnlPercent = -Math.abs(((sl - signal.entryPrice) / signal.entryPrice) * 100);
            hasChanges = true;
          } else if (tp2Reached) {
            signal.tp1Hit = true;
            signal.tp1HitTimestamp = now;
            signal.tp1Price = tp1;
            signal.tp2Hit = true;
            signal.tp2HitTimestamp = now;
            signal.tp2Price = tp2;
            signal.isTradeComplete = true;
            signal.status = 'WIN';
            signal.displayMessage = 'tp #2 hit | trade complete';
            signal.statusReason = 'tp #2 hit | trade complete';
            signal.completedAt = now;
            signal.durationMs = now - signal.timestamp;
            signal.exitPrice = tp2;
            signal.pnlPercent = Math.abs(((signal.entryPrice - tp2) / signal.entryPrice) * 100);
            hasChanges = true;
          } else if (tp1Reached) {
            signal.tp1Hit = true;
            signal.tp1HitTimestamp = now;
            signal.tp1Price = tp1;
            signal.isTradeComplete = true;
            signal.status = 'WIN';
            signal.displayMessage = `tp hit | r:r ${rrStr} | win`;
            signal.statusReason = `tp hit | r:r ${rrStr} | win`;
            signal.completedAt = now;
            signal.durationMs = now - signal.timestamp;
            signal.exitPrice = tp1;
            signal.pnlPercent = Math.abs(((signal.entryPrice - tp1) / signal.entryPrice) * 100);
            hasChanges = true;
          } else if (slReached) {
            signal.status = 'LOSS';
            signal.isTradeComplete = true;
            signal.statusReason = `Stop loss level ($${sl.toFixed(4)}) reached.`;
            signal.completedAt = now;
            signal.durationMs = now - signal.timestamp;
            signal.exitPrice = sl;
            signal.pnlPercent = -Math.abs(((sl - signal.entryPrice) / signal.entryPrice) * 100);
            hasChanges = true;
          } else if (now >= signal.expiryTimestamp) {
            signal.status = 'EXPIRED';
            signal.isTradeComplete = true;
            signal.statusReason = `Expired after ${signal.expiryCandles} candle periods without reaching TP or SL.`;
            signal.completedAt = now;
            signal.durationMs = now - signal.timestamp;
            signal.exitPrice = currentPrice;
            signal.pnlPercent = ((signal.entryPrice - currentPrice) / signal.entryPrice) * 100;
            hasChanges = true;
          }
        }
      }
    }

    if (hasChanges) {
      this.syncActiveSignalsArray();
      if (typeof this.onUpdate === 'function') {
        this.onUpdate(this.getScanData());
      }
    }
  }

  syncActiveSignalsArray() {
    const all = Array.from(this.performanceSignals.values()).filter(
      (s) => !isPermanentlyExcludedSymbol(s.asset)
    );
    // STRICT ACTIVE SIGNALS ONLY for the scanner live stream!
    // Completed signals (WIN / LOSS / EXPIRED) are removed from active scanner immediately.
    const activeOnly = all.filter((s) => s.status === 'ACTIVE');
    activeOnly.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    this.signals = activeOnly;
  }

  async runScan(timeframe = '15m') {
    if (this.isScanning) return;
    this.isScanning = true;
    this.status = 'scanning';
    this.timeframe = timeframe;
    const scanStartTime = Date.now();

    try {
      // 1. Gather all eligible Binance Spot USDT pairs
      if (!symbolManager.symbolNames || symbolManager.symbolNames.length === 0) {
        try {
          await symbolManager.loadSymbols();
        } catch (err) {
          console.warn('[scannerService] Symbol load error during runScan, using cached tickers:', err.message);
        }
      }

      const allLoaded = symbolManager.symbolNames && symbolManager.symbolNames.length > 0
        ? symbolManager.symbolNames
        : marketCache.getAllTickers().map((t) => t.symbol);

      const eligibleList = allLoaded.filter(
        (s) => s && s.endsWith('USDT') && !isPermanentlyExcludedSymbol(s)
      );

      const totalEligible = eligibleList.length || 1;
      const batchSize = this.batchSize || 25;
      const totalBatches = Math.ceil(totalEligible / batchSize);

      // Rotate fair round-robin cursor across full universe
      if (this.currentBatchCursor >= totalEligible) {
        this.currentBatchCursor = 0;
      }

      const startIndex = this.currentBatchCursor;
      const endIndex = Math.min(startIndex + batchSize, totalEligible);
      const rotatingBatch = eligibleList.slice(startIndex, endIndex);

      // Always include top 2 reference anchors (BTCUSDT, ETHUSDT) if not already in batch
      // so benchmark market leadership is consistently monitored without starving alts
      const scanList = Array.from(new Set(['BTCUSDT', 'ETHUSDT', ...rotatingBatch]));

      // Advance cursor for next scheduled cycle
      this.currentBatchCursor = endIndex >= totalEligible ? 0 : endIndex;

      const pendingSetups = [];
      let processed = 0;
      const now = Date.now();

      // Determine Higher Timeframe if confirmation is enabled
      const htfTf = this.htfTimeframe || getLogicalHigherTimeframe(timeframe);

      for (const symbol of scanList) {
        if (isPermanentlyExcludedSymbol(symbol)) continue;
        try {
          const rawCandles = await fetchKlines(symbol, timeframe, 60);
          if (!rawCandles || rawCandles.length < 15) continue;

          // STRICT REQUIREMENT: Only evaluate completed candles whose close event has confirmed.
          // Never generate or display a signal while the current candlestick is still forming.
          const tfDuration = (getTimeframeMinutes(timeframe) || 15) * 60 * 1000;
          const closedCandles = (rawCandles || []).filter((c) => {
            if (!c || isNaN(c.close) || c.close <= 0) return false;
            if (c.isClosed === false) return false;
            if (c.isEstimated || c.estimated) return false;
            if (c.openTime > now) return false;
            const effectiveCloseTime = c.closeTime || (c.openTime + tfDuration - 1);
            if (effectiveCloseTime > now) return false;
            if (c.openTime + tfDuration > now) return false;
            return true;
          });
          if (closedCandles.length < 10) continue;

          const lastClosedCandle = closedCandles[closedCandles.length - 1];
          const confirmedCandleCloseTime = lastClosedCandle.closeTime;
          const currentPrice = lastClosedCandle.close;

          // 1. EVALUATE MARKET STRUCTURE QUALITY LAYER BEFORE STRATEGY ANALYSIS
          const qualityResult = evaluateMarketStructureQuality(symbol, timeframe, closedCandles, currentPrice);
          this.qualityDiagnostics.set(`${symbol}-${timeframe}`, qualityResult);

          if (!qualityResult.isTradable) {
            processed++;
            continue;
          }

          // STRICT REQUIREMENT 1 & 4: Prevent duplicate signals from same closed candle
          if (this.hasSignalForCandle(symbol, timeframe, confirmedCandleCloseTime)) {
            processed++;
            continue;
          }

          let fiveMinCandles = null;
          if (timeframe === '5m') {
            fiveMinCandles = closedCandles;
          } else {
            try {
              const raw5m = await fetchKlines(symbol, '5m', 50);
              if (Array.isArray(raw5m) && raw5m.length >= 5) {
                fiveMinCandles = raw5m.filter((c) => {
                  if (!c || isNaN(c.close) || c.close <= 0) return false;
                  const effClose = c.closeTime || (c.openTime + 5 * 60 * 1000 - 1);
                  return effClose <= now && (c.openTime + 5 * 60 * 1000) <= now;
                });
              }
            } catch (e) {
              // fallback
            }
          }

          // Optional Higher Timeframe Confirmation Retrieval
          let htfConfirmation = null;
          if (this.htfConfirmationEnabled) {
            try {
              const rawHtf = await fetchKlines(symbol, htfTf, 50);
              const htfDurationMs = (getTimeframeMinutes(htfTf) || 60) * 60 * 1000;
              const htfClosed = (rawHtf || []).filter((c) => {
                if (!c || isNaN(c.close) || c.close <= 0) return false;
                const eff = c.closeTime || (c.openTime + htfDurationMs - 1);
                return eff <= now && (c.openTime + htfDurationMs) <= now;
              });

              if (htfClosed.length >= 10) {
                htfConfirmation = evaluateHtfConfirmation({
                  setupDirection: 'UP', // dynamic check updated below per candidate direction
                  entryTimeframe: timeframe,
                  htfTimeframe: htfTf,
                  htfClosedCandles: htfClosed,
                  ruleMode: this.htfRuleMode || 'lenient'
                });
              }
            } catch (htfErr) {
              // fallback if HTF data fetch fails
            }
          }

          const analysis = this.analyzeCandles(symbol, timeframe, closedCandles, currentPrice, fiveMinCandles, htfConfirmation);

          // If HTF confirmation is active, verify candidate signal passes HTF rule
          let signalToRegister = analysis.aiFilteredSignal || analysis.originalSignal;
          if (signalToRegister && this.htfConfirmationEnabled) {
            // Re-evaluate HTF confirmation against actual candidate setup direction
            try {
              const rawHtf = await fetchKlines(symbol, htfTf, 50);
              const htfDurationMs = (getTimeframeMinutes(htfTf) || 60) * 60 * 1000;
              const htfClosed = (rawHtf || []).filter((c) => {
                if (!c || isNaN(c.close) || c.close <= 0) return false;
                const eff = c.closeTime || (c.openTime + htfDurationMs - 1);
                return eff <= now && (c.openTime + htfDurationMs) <= now;
              });

              if (htfClosed.length >= 10) {
                const specificHtfCheck = evaluateHtfConfirmation({
                  setupDirection: signalToRegister.direction,
                  entryTimeframe: timeframe,
                  htfTimeframe: htfTf,
                  htfClosedCandles: htfClosed,
                  ruleMode: this.htfRuleMode || 'lenient'
                });
                signalToRegister.htfConfirmation = specificHtfCheck;
                if (specificHtfCheck.status === 'rejected') {
                  signalToRegister = null; // Filtered out by higher timeframe disagreement
                }
              }
            } catch (e) {
              // keep existing
            }
          }

          if (signalToRegister) {
            this.registerSignalSafely(signalToRegister);
          }

          if (analysis.pendingRetest) {
            pendingSetups.push(analysis.pendingRetest);
          }
          processed++;
        } catch (err) {
          // continue next symbol
        }
      }

      this.pendingRetests = pendingSetups;
      this.scannedCount = processed;
      this.lastScanTime = Date.now();
      this.status = 'ready';

      // Update fair coverage statistics
      const cycleDurationMs = Date.now() - scanStartTime;
      const currentBatchNum = Math.floor(startIndex / batchSize) + 1;
      const estFullRotationSeconds = Math.round(totalBatches * 45);
      const coveragePercent = Math.min(100, Math.round((endIndex / totalEligible) * 100));

      this.coverageStats = {
        totalEligibleSymbols: totalEligible,
        batchSize,
        batchIndex: currentBatchNum,
        totalBatches,
        cycleDurationMs,
        estFullRotationSeconds,
        coveragePercent,
        lastBatchCompletedAt: Date.now()
      };

      this.syncActiveSignalsArray();
      this.watchActiveSignals();

      if (typeof this.onUpdate === 'function') {
        this.onUpdate(this.getScanData());
      }
    } catch (err) {
      console.warn('[scannerService] Error during scan:', err.message);
      this.status = 'idle';
    } finally {
      this.isScanning = false;
    }
  }

  registerSignalSafely(signal) {
    if (!signal || !signal.id) return;
    const existing = this.performanceSignals.get(signal.id);
    if (!existing) {
      // Prevent duplicate or stale signals from the same closed candle across identical asset/timeframe
      const hasExistingCandle = Array.from(this.performanceSignals.values()).some((s) =>
        s.asset === signal.asset &&
        s.timeframe === signal.timeframe &&
        (s.confirmedCandleCloseTime === signal.confirmedCandleCloseTime || s.timestamp === signal.timestamp)
      );
      if (!hasExistingCandle) {
        this.performanceSignals.set(signal.id, signal);
      }
    }
  }

  sanitizeSignalForPublic(s) {
    if (!s) return null;
    return {
      id: s.id,
      asset: s.asset,
      timeframe: s.timeframe,
      direction: s.direction,
      setupType: s.setupType || (s.direction === 'UP' ? 'Long Setup' : 'Short Setup'),
      entryPrice: s.entryPrice || s.signalPrice,
      signalPrice: s.signalPrice || s.entryPrice,
      stopLoss: s.stopLoss,
      takeProfit: s.takeProfit || s.takeProfit1,
      takeProfit1: s.takeProfit1 || s.takeProfit,
      takeProfit2: s.takeProfit2,
      rewardRiskRatio: s.rewardRiskRatio,
      timestamp: s.timestamp,
      confirmedCandleCloseTime: s.confirmedCandleCloseTime || s.timestamp,
      status: s.status,
      tp1Hit: s.tp1Hit,
      tp2Hit: s.tp2Hit,
      isTradeComplete: s.isTradeComplete,
      completedAt: s.completedAt,
      exitPrice: s.exitPrice,
      pnlPercent: s.pnlPercent
    };
  }

  /**
   * Scans specifically the asset selected on the active chart.
   * Does NOT scan a random asset. Does NOT switch the selected asset.
   * Uses strictly real closed candles and live market data.
   */
  async scanSingleAsset(rawSymbol, timeframe = '15m') {
    if (!rawSymbol) return null;
    const symbol = normalizeSymbol(rawSymbol);

    // Permanently excluded assets must never receive strategy analysis
    if (isPermanentlyExcludedSymbol(symbol)) {
      return {
        asset: symbol,
        timeframe,
        hasSetup: false,
        action: 'NO SETUP',
        message: 'no valid setup found'
      };
    }

    try {
      const rawCandles = await fetchKlines(symbol, timeframe, 60);
      if (!rawCandles || rawCandles.length < 15) {
        return {
          asset: symbol,
          timeframe,
          hasSetup: false,
          action: 'NO SETUP',
          message: 'no valid setup found'
        };
      }

      const now = Date.now();
      // STRICT REQUIREMENT: Only evaluate completed candles whose close event has confirmed
      const tfDuration = (getTimeframeMinutes(timeframe) || 15) * 60 * 1000;
      const closedCandles = (rawCandles || []).filter((c) => {
        if (!c || isNaN(c.close) || c.close <= 0) return false;
        const effectiveCloseTime = c.closeTime || (c.openTime + tfDuration - 1);
        if (effectiveCloseTime > now) return false;
        if (c.openTime + tfDuration > now) return false;
        return true;
      });
      if (closedCandles.length < 10) {
        return {
          asset: symbol,
          timeframe,
          hasSetup: false,
          action: 'NO SETUP',
          message: 'no valid setup found'
        };
      }

      const lastClosedCandle = closedCandles[closedCandles.length - 1];
      const confirmedCandleCloseTime = lastClosedCandle.closeTime;
      const currentPrice = lastClosedCandle.close;

      let fiveMinCandles = null;
      if (timeframe === '5m') {
        fiveMinCandles = closedCandles;
      } else {
        try {
          const raw5m = await fetchKlines(symbol, '5m', 50);
          if (Array.isArray(raw5m) && raw5m.length >= 5) {
            fiveMinCandles = raw5m.filter((c) => {
              if (!c || isNaN(c.close) || c.close <= 0) return false;
              const effClose = c.closeTime || (c.openTime + 5 * 60 * 1000 - 1);
              return effClose <= now && (c.openTime + 5 * 60 * 1000) <= now;
            });
          }
        } catch (e) {
          // fallback
        }
      }

      // Higher timeframe analysis context
      const htfTf = this.htfTimeframe || getLogicalHigherTimeframe(timeframe);
      let htfClosedCandles = null;
      let htfEvaluation = null;
      try {
        const rawHtf = await fetchKlines(symbol, htfTf, 50);
        const htfDurationMs = (getTimeframeMinutes(htfTf) || 60) * 60 * 1000;
        htfClosedCandles = (rawHtf || []).filter((c) => {
          if (!c || isNaN(c.close) || c.close <= 0) return false;
          const eff = c.closeTime || (c.openTime + htfDurationMs - 1);
          return eff <= now && (c.openTime + htfDurationMs) <= now;
        });
      } catch (e) {
        // fallback
      }

      const analysis = this.analyzeCandles(symbol, timeframe, closedCandles, currentPrice, fiveMinCandles);

      if (analysis.qualityResult && !analysis.qualityResult.isTradable) {
        return {
          asset: symbol,
          timeframe,
          hasSetup: false,
          action: 'NO SETUP',
          message: 'no valid setup found'
        };
      }

      // Check candidate signal with HTF if enabled
      let confirmedSignal = analysis.aiFilteredSignal || analysis.originalSignal;
      let htfStatusReason = '';
      if (confirmedSignal && this.htfConfirmationEnabled && htfClosedCandles) {
        htfEvaluation = evaluateHtfConfirmation({
          setupDirection: confirmedSignal.direction,
          entryTimeframe: timeframe,
          htfTimeframe: htfTf,
          htfClosedCandles,
          ruleMode: this.htfRuleMode || 'lenient'
        });
        confirmedSignal.htfConfirmation = htfEvaluation;

        if (htfEvaluation.status === 'rejected') {
          htfStatusReason = `Higher Timeframe Filter Rejected: ${htfEvaluation.reason}`;
          confirmedSignal = null; // Rejected by higher timeframe confirmation
        }
      }

      // Register ONE legitimate buy or sell signal based on existing strategy
      if (confirmedSignal && !this.hasSignalForCandle(symbol, timeframe, confirmedCandleCloseTime)) {
        this.registerSignalSafely(confirmedSignal);
      }

      this.syncActiveSignalsArray();
      this.watchActiveSignals();

      if (typeof this.onUpdate === 'function') {
        this.onUpdate(this.getScanData());
      }

      if (analysis.pendingRetest) {
        this.pendingRetests = [
          analysis.pendingRetest,
          ...this.pendingRetests.filter((p) => p.asset !== symbol)
        ];
      } else {
        this.pendingRetests = this.pendingRetests.filter((p) => p.asset !== symbol);
      }

      // Extract key structural swings and S/R clusters from closed candles
      const swingHighs = [];
      const swingLows = [];
      for (let i = 2; i < closedCandles.length - 2; i++) {
        const cur = closedCandles[i];
        const p1 = closedCandles[i - 1];
        const p2 = closedCandles[i - 2];
        const n1 = closedCandles[i + 1];
        const n2 = closedCandles[i + 2];
        if (cur.high > p1.high && cur.high > p2.high && cur.high > n1.high && cur.high > n2.high) {
          swingHighs.push({ price: cur.high, time: cur.openTime });
        }
        if (cur.low < p1.low && cur.low < p2.low && cur.low < n1.low && cur.low < n2.low) {
          swingLows.push({ price: cur.low, time: cur.openTime });
        }
      }

      const confirmedSwingHigh = swingHighs.length > 0
        ? swingHighs[swingHighs.length - 1].price
        : Math.max(...closedCandles.slice(-15).map((c) => c.high));
      const confirmedSwingLow = swingLows.length > 0
        ? swingLows[swingLows.length - 1].price
        : Math.min(...closedCandles.slice(-15).map((c) => c.low));

      // Key structural support is strictly at or below currentPrice
      const validSupports = swingLows
        .map((s) => s.price)
        .filter((p) => p <= currentPrice);
      const structuralSupport = validSupports.length > 0
        ? Math.max(...validSupports)
        : Math.min(...closedCandles.slice(-25).map((c) => c.low));

      // Key structural resistance is strictly at or above currentPrice
      const validResistances = swingHighs
        .map((s) => s.price)
        .filter((p) => p >= currentPrice);
      const structuralResistance = validResistances.length > 0
        ? Math.min(...validResistances)
        : Math.max(...closedCandles.slice(-25).map((c) => c.high));

      if (confirmedSignal) {
        const sanitizedSignal = this.sanitizeSignalForPublic(confirmedSignal);
        return {
          asset: symbol,
          timeframe,
          hasSetup: true,
          action: confirmedSignal.direction === 'UP' ? 'BUY' : 'SELL',
          direction: confirmedSignal.direction,
          signal: sanitizedSignal,
          tradeLevels: {
            entryPrice: confirmedSignal.entryPrice,
            stopLoss: confirmedSignal.stopLoss,
            takeProfit1: confirmedSignal.takeProfit1,
            takeProfit2: confirmedSignal.takeProfit2,
            rewardRiskRatio: confirmedSignal.rewardRiskRatio
          }
        };
      }

      return {
        asset: symbol,
        timeframe,
        hasSetup: false,
        action: 'NO SETUP',
        message: 'no valid setup found'
      };
    } catch (err) {
      console.warn(`[scannerService] Error scanning single asset ${symbol}:`, err.message);
      return {
        asset: symbol,
        timeframe,
        hasSetup: false,
        action: 'NO SETUP',
        message: 'no valid setup found'
      };
    }
  }

  /**
   * Evaluates candles, detects market regime, applies NWWT setup rules,
   * runs AI structure validation, and generates 4 research model representations.
   */
  analyzeCandles(symbol, timeframe, rawCandles, currentPrice, fiveMinCandles = null, htfConfirmation = null) {
    const now = Date.now();
    // STRICT REQUIREMENT: Only evaluate completed candles whose close event has confirmed.
    // Discard any forming candle whose closeTime > now or openTime + duration > now,
    // as well as future candles, estimated prices, or unclosed flags.
    const tfDuration = (getTimeframeMinutes(timeframe) || 15) * 60 * 1000;
    const closedCandles = (rawCandles || []).filter((c) => {
      if (!c || isNaN(c.close) || c.close <= 0) return false;
      if (c.isClosed === false) return false;
      if (c.isEstimated || c.estimated) return false;
      if (c.openTime > now) return false;
      const effectiveCloseTime = c.closeTime || (c.openTime + tfDuration - 1);
      if (effectiveCloseTime > now) return false;
      if (c.openTime + tfDuration > now) return false;
      return true;
    });
    const len = closedCandles.length;
    if (len < 10) return { originalSignal: null, pendingRetest: null };

    const c0 = closedCandles[len - 1]; // Most recently closed candle
    const c1 = closedCandles[len - 2];
    const c2 = closedCandles[len - 3];

    // 1. EVALUATE MARKET STRUCTURE QUALITY LAYER BEFORE ANY STRATEGY EXECUTION
    const qualityResult = evaluateMarketStructureQuality(symbol, timeframe, closedCandles, currentPrice);
    if (!qualityResult.isTradable) {
      return {
        originalSignal: null,
        inverseSignal: null,
        aiFilteredSignal: null,
        aiFilteredInverseSignal: null,
        pendingRetest: null,
        regimeData: null,
        qualityResult
      };
    }

    // Detect Market Regime from closed candle series
    const regimeData = detectMarketRegime(closedCandles);

    // Volume comparison
    const volLookback = Math.min(20, len);
    let volSum = 0;
    for (let i = len - volLookback; i < len; i++) {
      volSum += closedCandles[i].volume || 0;
    }
    const avgVol = volSum / volLookback || 1;
    const isVolExpanding = (c0.volume || 0) > avgVol * 1.15;

    // Identify Fractal Swing Highs and Lows (2-bar pivot)
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

    const isDecisiveBody = c0Body / c0Range > 0.48;

    let baseSignal = null;
    let pendingRetest = null;

    // =========================================================================
    // TIER 1: BREAK & RETEST (Reinforced Setup)
    // =========================================================================
    if (c1.close > lastHigh && c0.low <= lastHigh && c0.close > lastHigh && c0IsGreen) {
      baseSignal = this.generateStructuralSignal({
        symbol,
        timeframe,
        direction: 'UP',
        setupType: 'Break & Retest (Reinforced)',
        closePrice: c0.close,
        confidence: 96,
        reason: `Break & Retest Confirmed: Previous resistance ($${lastHigh.toFixed(2)}) defended as new support with lower wick rejection and green continuation close.`,
        timestamp: c0.closeTime,
        confirmedCandleCloseTime: c0.closeTime,
        closedCandles,
        fiveMinCandles,
        regimeData,
        marketStructureQuality: qualityResult,
        htfConfirmation
      });
    } else if (c1.close < lastLow && c0.high >= lastLow && c0.close < lastLow && !c0IsGreen) {
      baseSignal = this.generateStructuralSignal({
        symbol,
        timeframe,
        direction: 'DOWN',
        setupType: 'Break & Retest (Reinforced)',
        closePrice: c0.close,
        confidence: 96,
        reason: `Break & Retest Confirmed: Previous support ($${lastLow.toFixed(2)}) rejected as new resistance with upper wick rejection and red continuation close.`,
        timestamp: c0.closeTime,
        confirmedCandleCloseTime: c0.closeTime,
        closedCandles,
        fiveMinCandles,
        regimeData,
        marketStructureQuality: qualityResult,
        htfConfirmation
      });
    }

    // =========================================================================
    // TIER 2: STRONG CONFIRMED BREAK (BOS) - RETEST OPTIONAL
    // =========================================================================
    if (!baseSignal) {
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
        baseSignal = this.generateStructuralSignal({
          symbol,
          timeframe,
          direction: 'UP',
          setupType: 'Strong Confirmed Break (BOS)',
          closePrice: c0.close,
          confidence: isVolExpanding ? 93 : 90,
          reason: `Strong Confirmed Break: Candle closed firmly above swing resistance $${lastHigh.toFixed(2)} with decisive bullish momentum${isVolExpanding ? ' and expanding volume' : ''}. Retest not required.`,
          timestamp: c0.closeTime,
          confirmedCandleCloseTime: c0.closeTime,
          closedCandles,
          fiveMinCandles,
          regimeData,
          marketStructureQuality: qualityResult,
          htfConfirmation
        });
      } else if (isStrongBearishBreak) {
        baseSignal = this.generateStructuralSignal({
          symbol,
          timeframe,
          direction: 'DOWN',
          setupType: 'Strong Confirmed Break (BOS)',
          closePrice: c0.close,
          confidence: isVolExpanding ? 93 : 90,
          reason: `Strong Confirmed Breakdown: Candle closed firmly below swing support $${lastLow.toFixed(2)} with decisive bearish momentum${isVolExpanding ? ' and expanding volume' : ''}. Retest not required.`,
          timestamp: c0.closeTime,
          confirmedCandleCloseTime: c0.closeTime,
          closedCandles,
          fiveMinCandles,
          regimeData,
          marketStructureQuality: qualityResult,
          htfConfirmation
        });
      }
    }

    // =========================================================================
    // TIER 3: FAKEOUT REJECTION
    // =========================================================================
    if (!baseSignal) {
      if (c0.high > lastHigh && c0.close < lastHigh && (c0UpperWick / c0Range) > 0.45 && !c0IsGreen) {
        baseSignal = this.generateStructuralSignal({
          symbol,
          timeframe,
          direction: 'DOWN',
          setupType: 'Fakeout Rejection',
          closePrice: c0.close,
          confidence: 89,
          reason: `Fakeout Rejection: Liquidity sweep above resistance $${lastHigh.toFixed(2)} met with aggressive seller absorption and heavy upper wick rejection.`,
          timestamp: c0.closeTime,
          confirmedCandleCloseTime: c0.closeTime,
          closedCandles,
          fiveMinCandles,
          regimeData,
          marketStructureQuality: qualityResult,
          htfConfirmation
        });
      } else if (c0.low < lastLow && c0.close > lastLow && (c0LowerWick / c0Range) > 0.45 && c0IsGreen) {
        baseSignal = this.generateStructuralSignal({
          symbol,
          timeframe,
          direction: 'UP',
          setupType: 'Fakeout Rejection',
          closePrice: c0.close,
          confidence: 89,
          reason: `Fakeout Rejection: Liquidity sweep below support $${lastLow.toFixed(2)} met with aggressive buyer absorption and strong lower wick defense.`,
          timestamp: c0.closeTime,
          confirmedCandleCloseTime: c0.closeTime,
          closedCandles,
          fiveMinCandles,
          regimeData,
          marketStructureQuality: qualityResult,
          htfConfirmation
        });
      }
    }

    // =========================================================================
    // TIER 4: ENGULFING CONFIRMATION
    // =========================================================================
    if (!baseSignal) {
      const isBullishEngulfing = c0IsGreen && !c1.isGreen && c0.close > c1.open && c0.open <= c1.close;
      const isBearishEngulfing = !c0IsGreen && c1.isGreen && c0.close < c1.open && c0.open >= c1.close;

      if (isBullishEngulfing && Math.abs(c0.low - lastLow) / lastLow < 0.018) {
        baseSignal = this.generateStructuralSignal({
          symbol,
          timeframe,
          direction: 'UP',
          setupType: 'Engulfing Confirmation',
          closePrice: c0.close,
          confidence: 86,
          reason: `Bullish Engulfing Confirmation: Closed at key structural support zone $${lastLow.toFixed(2)} engulfing previous candle body.`,
          timestamp: c0.closeTime,
          confirmedCandleCloseTime: c0.closeTime,
          closedCandles,
          fiveMinCandles,
          regimeData,
          marketStructureQuality: qualityResult,
          htfConfirmation
        });
      } else if (isBearishEngulfing && Math.abs(c0.high - lastHigh) / lastHigh < 0.018) {
        baseSignal = this.generateStructuralSignal({
          symbol,
          timeframe,
          direction: 'DOWN',
          setupType: 'Engulfing Confirmation',
          closePrice: c0.close,
          confidence: 86,
          reason: `Bearish Engulfing Confirmation: Closed at key structural resistance zone $${lastHigh.toFixed(2)} engulfing previous candle body.`,
          timestamp: c0.closeTime,
          confirmedCandleCloseTime: c0.closeTime,
          closedCandles,
          fiveMinCandles,
          regimeData,
          marketStructureQuality: qualityResult,
          htfConfirmation
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

    let originalSignal = null;
    let inverseSignal = null;
    let aiFilteredSignal = null;
    let aiFilteredInverseSignal = null;

    if (baseSignal) {
      // Run AI Market Structure Intelligence on original signal
      const aiValidation = validateSetupWithStructureIntelligence(
        baseSignal,
        closedCandles,
        regimeData,
        this.computeSingleModelStats('original')
      );

      originalSignal = {
        ...baseSignal,
        marketRegime: regimeData.regime,
        aiValidation,
        modelType: 'original',
        signalConditions: aiValidation.conditions
      };

      // Create Inverse Signal representation
      const rawInverse = createInverseSignal(originalSignal);
      const inverseAiValidation = validateSetupWithStructureIntelligence(
        rawInverse,
        closedCandles,
        regimeData,
        this.computeSingleModelStats('inverse')
      );
      inverseSignal = {
        ...rawInverse,
        marketRegime: regimeData.regime,
        aiValidation: inverseAiValidation,
        modelType: 'inverse',
        signalConditions: inverseAiValidation.conditions
      };

      // Filtered Models: Only allowed when aiValidation.status === 'allow'
      if (aiValidation.status === 'allow') {
        aiFilteredSignal = {
          ...originalSignal,
          id: `${originalSignal.id}-aifiltered`,
          modelType: 'ai_filtered',
          confidence: Math.max(originalSignal.confidence, aiValidation.confidence)
        };
      }

      if (inverseAiValidation.status === 'allow') {
        aiFilteredInverseSignal = {
          ...inverseSignal,
          id: `${inverseSignal.id}-aifiltered`,
          modelType: 'ai_filtered_inverse',
          confidence: Math.max(inverseSignal.confidence, inverseAiValidation.confidence)
        };
      }
    }

    return {
      originalSignal,
      inverseSignal,
      aiFilteredSignal,
      aiFilteredInverseSignal,
      regimeData,
      pendingRetest,
      qualityResult
    };
  }

  /**
   * Helper to compute single model statistics for adaptive feedback
   */
  computeSingleModelStats(modelType) {
    const signals = Array.from(this.performanceSignals.values()).filter(
      (s) => (s.modelType || 'original') === modelType
    );
    const bySetupType = {};
    for (const s of signals) {
      if (!bySetupType[s.setupType]) {
        bySetupType[s.setupType] = { wins: 0, losses: 0, total: 0 };
      }
      const st = bySetupType[s.setupType];
      st.total++;
      if (s.status === 'WIN') st.wins++;
      else if (s.status === 'LOSS') st.losses++;
    }
    return { bySetupType };
  }

  /**
   * Computes comprehensive performance stats across all 4 research models:
   * 1. original
   * 2. inverse
   * 3. ai_filtered
   * 4. ai_filtered_inverse
   * Plus walk-forward validation and breakdowns.
   */
  computePerformanceStats() {
    const allSignals = Array.from(this.performanceSignals.values()).filter(
      (s) => !isPermanentlyExcludedSymbol(s.asset)
    );

    const computeForList = (signals) => {
      let activeCount = 0;
      let winsCount = 0;
      let lossesCount = 0;
      let expiredCount = 0;
      let winPnlSum = 0;
      let lossPnlSum = 0;
      let maxLosingStreak = 0;
      let currentStreak = 0;

      const bySetupType = {};
      const byTimeframe = {};
      const byDirection = {
        UP: { total: 0, wins: 0, losses: 0, expired: 0, active: 0, tpRate: 0, avgPnlPercent: 0, _pnlSum: 0 },
        DOWN: { total: 0, wins: 0, losses: 0, expired: 0, active: 0, tpRate: 0, avgPnlPercent: 0, _pnlSum: 0 }
      };
      const byAsset = {};
      const byRegime = {};

      function updateGroup(group, key, status, pnl = 0) {
        if (!key) return;
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

      // Chronological walk for streak and drawdown
      const sorted = [...signals].sort((a, b) => a.timestamp - b.timestamp);
      let peak = 0;
      let equity = 0;
      let maxDrawdown = 0;

      for (const s of sorted) {
        const pnl = s.pnlPercent || 0;
        if (s.status === 'ACTIVE') activeCount++;
        else if (s.status === 'WIN') {
          winsCount++;
          winPnlSum += pnl;
          equity += pnl;
          currentStreak = 0;
        } else if (s.status === 'LOSS') {
          lossesCount++;
          lossPnlSum += Math.abs(pnl);
          equity += pnl;
          currentStreak++;
          if (currentStreak > maxLosingStreak) maxLosingStreak = currentStreak;
        } else if (s.status === 'EXPIRED') {
          expiredCount++;
        }

        if (equity > peak) peak = equity;
        const dd = peak - equity;
        if (dd > maxDrawdown) maxDrawdown = dd;

        updateGroup(bySetupType, s.setupType, s.status, pnl);
        updateGroup(byTimeframe, s.timeframe, s.status, pnl);
        if (s.direction === 'UP' || s.direction === 'DOWN') {
          updateGroup(byDirection, s.direction, s.status, pnl);
        }
        updateGroup(byAsset, s.asset, s.status, pnl);
        if (s.marketRegime) {
          updateGroup(byRegime, s.marketRegime, s.status, pnl);
        }
      }

      const settledTotal = winsCount + lossesCount;
      const tpRate = settledTotal > 0 ? parseFloat(((winsCount / settledTotal) * 100).toFixed(1)) : 0;
      const avgWinPercent = winsCount > 0 ? parseFloat((winPnlSum / winsCount).toFixed(2)) : 0;
      const avgLossPercent = lossesCount > 0 ? parseFloat((lossPnlSum / lossesCount).toFixed(2)) : 0;
      const profitFactor = lossPnlSum > 0 ? parseFloat((winPnlSum / lossPnlSum).toFixed(2)) : winsCount > 0 ? 9.99 : 0;

      const winRateFrac = settledTotal > 0 ? winsCount / settledTotal : 0;
      const lossRateFrac = settledTotal > 0 ? lossesCount / settledTotal : 0;
      const expectancy = parseFloat((winRateFrac * avgWinPercent - lossRateFrac * avgLossPercent).toFixed(2));

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
        expectancy,
        maxLosingStreak,
        drawdown: parseFloat(maxDrawdown.toFixed(2)),
        sampleSize: settledTotal,
        hasSufficientSample: settledTotal >= 10,
        bySetupType,
        byTimeframe,
        byDirection,
        byAsset,
        byRegime
      };
    };

    // Filter signals by model
    const originalSignals = allSignals.filter((s) => (s.modelType || 'original') === 'original');
    const inverseSignals = allSignals.filter((s) => s.modelType === 'inverse');
    const aiFilteredSignals = allSignals.filter((s) => s.modelType === 'ai_filtered');
    const aiFilteredInverseSignals = allSignals.filter((s) => s.modelType === 'ai_filtered_inverse');

    const originalStats = computeForList(originalSignals);
    const inverseStats = computeForList(inverseSignals);
    const aiFilteredStats = computeForList(aiFilteredSignals);
    const aiFilteredInverseStats = computeForList(aiFilteredInverseSignals);

    // Completed trades for walk-forward validation (AI Filtered or Original)
    const completedForWalkForward = allSignals.filter(
      (s) => s.status === 'WIN' || s.status === 'LOSS'
    );
    const walkForward = calculateWalkForwardValidation(completedForWalkForward);

    return {
      // Top-level stats (defaults to original for backward compatibility)
      ...originalStats,
      // 4-Model Comparison Suite
      byModel: {
        original: originalStats,
        inverse: inverseStats,
        ai_filtered: aiFilteredStats,
        ai_filtered_inverse: aiFilteredInverseStats
      },
      walkForward
    };
  }

  getScanData() {
    const all = Array.from(this.performanceSignals.values()).filter(
      (s) => !isPermanentlyExcludedSymbol(s.asset) && s.modelType !== 'inverse' && s.modelType !== 'ai_filtered_inverse'
    );
    const activeSignals = all
      .filter((s) => s.status === 'ACTIVE' && !s.isTradeComplete && !s.tp1Hit && !s.tp2Hit)
      .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
      .map((s) => this.sanitizeSignalForPublic(s));

    const completedSignals = all
      .filter((s) => s.status !== 'ACTIVE' || s.isTradeComplete || s.tp1Hit || s.tp2Hit)
      .sort((a, b) => (b.completedAt || b.timestamp || 0) - (a.completedAt || a.timestamp || 0))
      .slice(0, 500)
      .map((s) => this.sanitizeSignalForPublic(s));

    return {
      status: this.status,
      timeframe: this.timeframe,
      scannedCount: this.scannedCount,
      totalSymbols: marketCache.tickers.size,
      lastScanTime: this.lastScanTime,
      signals: activeSignals,
      completedSignals,
      activeCount: activeSignals.length,
      completedCount: completedSignals.length
    };
  }

  setScannerConfig({ timeframe, htfConfirmationEnabled, htfTimeframe, htfRuleMode }) {
    if (timeframe && typeof timeframe === 'string') {
      this.timeframe = timeframe;
    }
    if (htfConfirmationEnabled !== undefined) {
      this.htfConfirmationEnabled = Boolean(htfConfirmationEnabled);
    }
    if (htfTimeframe && typeof htfTimeframe === 'string') {
      this.htfTimeframe = htfTimeframe;
    }
    if (htfRuleMode && ['lenient', 'aligned', 'strict'].includes(htfRuleMode)) {
      this.htfRuleMode = htfRuleMode;
    }
  }

  getQualityDiagnostics() {
    return Array.from(this.qualityDiagnostics.values()).filter(
      (d) => !isPermanentlyExcludedSymbol(d.symbol)
    );
  }
}

export const scannerService = new ScannerService();
export default scannerService;
