/**
 * NWWT V8 Signal Performance Engine
 *
 * Implements:
 * - Persistent storage in localStorage ('nwwt_v8_signal_performance')
 * - Active signal watching against real-time market data
 * - Win recording when Take Profit (TP) is reached
 * - Loss recording when Stop Loss (SL) is reached
 * - Expiration tracking when time exceeds expiry timestamp
 * - Conservative rule: If TP and SL are both touched in the same candle/period,
 *   record as LOSS (conservative SL result).
 * - Breakdown analytics by setup type, timeframe, asset, and direction
 * - Strict non-adaptive rule: Preserves technical rules without automated strategy perturbation
 */

import { ScannerSignalItem, SignalPerformanceStats, SetupPerformance, Timeframe } from '../types.ts';

const STORAGE_KEY = 'nwwt_v8_signal_performance';

export function loadStoredSignals(): ScannerSignalItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
  } catch (err) {
    console.warn('[PerformanceEngine] Error loading stored signals:', err);
  }
  return [];
}

export function saveStoredSignals(signals: ScannerSignalItem[]): void {
  try {
    // Keep max 400 most recent signals to prevent unbounded localStorage growth
    const trimmed = signals.slice(-400);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch (err) {
    console.warn('[PerformanceEngine] Error saving stored signals:', err);
  }
}

/**
 * Merge newly detected scanner signals into existing historical store
 */
export function mergeScannerSignals(
  existingSignals: ScannerSignalItem[],
  incomingSignals: ScannerSignalItem[]
): ScannerSignalItem[] {
  const signalMap = new Map<string, ScannerSignalItem>();

  for (const s of existingSignals) {
    signalMap.set(s.id, s);
  }

  for (const inc of incomingSignals) {
    const existing = signalMap.get(inc.id);
    if (!existing) {
      // New signal: ensure all V8 fields are initialized
      signalMap.set(inc.id, {
        ...inc,
        status: inc.status || 'ACTIVE',
        statusReason: inc.statusReason || 'Watching live prices against TP and SL',
        highestReached: inc.entryPrice,
        lowestReached: inc.entryPrice
      });
    } else if (existing.status === 'ACTIVE' && inc.status && inc.status !== 'ACTIVE') {
      // Update status if server settled it
      signalMap.set(inc.id, { ...existing, ...inc });
    }
  }

  return Array.from(signalMap.values()).sort((a, b) => b.timestamp - a.timestamp);
}

/**
 * Evaluates active signals against real-time market ticker updates
 */
export function evaluateSignalsWithTicker(
  signals: ScannerSignalItem[],
  symbol: string,
  lastPriceNum: number,
  highPriceNum?: number,
  lowPriceNum?: number
): { updatedSignals: ScannerSignalItem[]; changed: boolean } {
  if (isNaN(lastPriceNum) || lastPriceNum <= 0) {
    return { updatedSignals: signals, changed: false };
  }

  const now = Date.now();
  let changed = false;

  const updatedSignals = signals.map((s) => {
    if (s.asset !== symbol || s.status !== 'ACTIVE') {
      return s;
    }

    const currentPrice = lastPriceNum;
    const highest = Math.max(s.highestReached || currentPrice, currentPrice);
    const lowest = Math.min(s.lowestReached || currentPrice, currentPrice);

    const isUp = s.direction === 'UP';

    if (isUp) {
      const tpReached = currentPrice >= s.takeProfit;
      const slReached = currentPrice <= s.stopLoss;

      // CONSERVATIVE RULE: If both TP and SL touched in same period, use conservative SL result
      if (tpReached && slReached) {
        changed = true;
        return {
          ...s,
          status: 'LOSS' as const,
          statusReason: 'Conservative SL: Both TP and SL were touched in the same period.',
          completedAt: now,
          exitPrice: s.stopLoss,
          pnlPercent: -Math.abs(((s.entryPrice - s.stopLoss) / s.entryPrice) * 100),
          highestReached: highest,
          lowestReached: lowest
        };
      }

      if (tpReached) {
        changed = true;
        return {
          ...s,
          status: 'WIN' as const,
          statusReason: `Take profit reached at $${s.takeProfit.toFixed(4)}.`,
          completedAt: now,
          exitPrice: s.takeProfit,
          pnlPercent: Math.abs(((s.takeProfit - s.entryPrice) / s.entryPrice) * 100),
          highestReached: highest,
          lowestReached: lowest
        };
      }

      if (slReached) {
        changed = true;
        return {
          ...s,
          status: 'LOSS' as const,
          statusReason: `Stop loss touched at $${s.stopLoss.toFixed(4)}.`,
          completedAt: now,
          exitPrice: s.stopLoss,
          pnlPercent: -Math.abs(((s.entryPrice - s.stopLoss) / s.entryPrice) * 100),
          highestReached: highest,
          lowestReached: lowest
        };
      }

      if (now >= s.expiryTimestamp) {
        changed = true;
        return {
          ...s,
          status: 'EXPIRED' as const,
          statusReason: `Expired after ${s.expiryCandles} candle periods without reaching TP or SL.`,
          completedAt: now,
          exitPrice: currentPrice,
          pnlPercent: ((currentPrice - s.entryPrice) / s.entryPrice) * 100,
          highestReached: highest,
          lowestReached: lowest
        };
      }
    } else {
      // DOWN DIRECTION
      const tpReached = currentPrice <= s.takeProfit;
      const slReached = currentPrice >= s.stopLoss;

      // CONSERVATIVE RULE: If both touched, record as LOSS
      if (tpReached && slReached) {
        changed = true;
        return {
          ...s,
          status: 'LOSS' as const,
          statusReason: 'Conservative SL: Both TP and SL were touched in the same period.',
          completedAt: now,
          exitPrice: s.stopLoss,
          pnlPercent: -Math.abs(((s.stopLoss - s.entryPrice) / s.entryPrice) * 100),
          highestReached: highest,
          lowestReached: lowest
        };
      }

      if (tpReached) {
        changed = true;
        return {
          ...s,
          status: 'WIN' as const,
          statusReason: `Take profit reached at $${s.takeProfit.toFixed(4)}.`,
          completedAt: now,
          exitPrice: s.takeProfit,
          pnlPercent: Math.abs(((s.entryPrice - s.takeProfit) / s.entryPrice) * 100),
          highestReached: highest,
          lowestReached: lowest
        };
      }

      if (slReached) {
        changed = true;
        return {
          ...s,
          status: 'LOSS' as const,
          statusReason: `Stop loss touched at $${s.stopLoss.toFixed(4)}.`,
          completedAt: now,
          exitPrice: s.stopLoss,
          pnlPercent: -Math.abs(((s.stopLoss - s.entryPrice) / s.entryPrice) * 100),
          highestReached: highest,
          lowestReached: lowest
        };
      }

      if (now >= s.expiryTimestamp) {
        changed = true;
        return {
          ...s,
          status: 'EXPIRED' as const,
          statusReason: `Expired after ${s.expiryCandles} candle periods without reaching TP or SL.`,
          completedAt: now,
          exitPrice: currentPrice,
          pnlPercent: ((s.entryPrice - currentPrice) / s.entryPrice) * 100,
          highestReached: highest,
          lowestReached: lowest
        };
      }
    }

    if (highest !== s.highestReached || lowest !== s.lowestReached) {
      changed = true;
      return { ...s, highestReached: highest, lowestReached: lowest };
    }

    return s;
  });

  return { updatedSignals, changed };
}

/**
 * Calculates aggregated performance statistics
 */
export function calculatePerformanceStats(signals: ScannerSignalItem[]): SignalPerformanceStats {
  let activeCount = 0;
  let winsCount = 0;
  let lossesCount = 0;
  let expiredCount = 0;

  let winPnlSum = 0;
  let lossPnlSum = 0;

  const bySetupType: Record<string, SetupPerformance & { _pnlSum: number }> = {};
  const byTimeframe: Record<string, SetupPerformance & { _pnlSum: number }> = {};
  const byDirection: Record<'UP' | 'DOWN', SetupPerformance & { _pnlSum: number }> = {
    UP: { total: 0, wins: 0, losses: 0, expired: 0, active: 0, tpRate: 0, avgPnlPercent: 0, _pnlSum: 0 },
    DOWN: { total: 0, wins: 0, losses: 0, expired: 0, active: 0, tpRate: 0, avgPnlPercent: 0, _pnlSum: 0 }
  };
  const byAsset: Record<string, SetupPerformance & { _pnlSum: number }> = {};

  function updateGroup(group: Record<string, SetupPerformance & { _pnlSum: number }>, key: string, status: string, pnl: number) {
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

  // Clean helper properties from result
  const cleanRecord = (rec: Record<string, SetupPerformance & { _pnlSum: number }>): Record<string, SetupPerformance> => {
    const out: Record<string, SetupPerformance> = {};
    for (const [k, v] of Object.entries(rec)) {
      out[k] = {
        total: v.total,
        wins: v.wins,
        losses: v.losses,
        expired: v.expired,
        active: v.active,
        tpRate: v.tpRate,
        avgPnlPercent: v.avgPnlPercent
      };
    }
    return out;
  };

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
    bySetupType: cleanRecord(bySetupType),
    byTimeframe: cleanRecord(byTimeframe),
    byDirection: {
      UP: {
        total: byDirection.UP.total,
        wins: byDirection.UP.wins,
        losses: byDirection.UP.losses,
        expired: byDirection.UP.expired,
        active: byDirection.UP.active,
        tpRate: byDirection.UP.tpRate,
        avgPnlPercent: byDirection.UP.avgPnlPercent
      },
      DOWN: {
        total: byDirection.DOWN.total,
        wins: byDirection.DOWN.wins,
        losses: byDirection.DOWN.losses,
        expired: byDirection.DOWN.expired,
        active: byDirection.DOWN.active,
        tpRate: byDirection.DOWN.tpRate,
        avgPnlPercent: byDirection.DOWN.avgPnlPercent
      }
    },
    byAsset: cleanRecord(byAsset)
  };
}
