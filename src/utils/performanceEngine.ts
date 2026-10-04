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

import { ScannerSignalItem, SignalPerformanceStats, SetupPerformance, Timeframe, Candle } from '../types.ts';
import { checkSignalTouch, addClearedSignalId, loadClearedSignalIds } from './signalTouchEngine.ts';

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
 * STRICT REQUIREMENTS:
 * - Never resurrect a completed or cleared signal as ACTIVE
 * - Prevent duplicate signals generated from the same closed candle
 * - Record settled status WIN or LOSS once and preserve it permanently
 */
export function mergeScannerSignals(
  existingSignals: ScannerSignalItem[],
  incomingSignals: ScannerSignalItem[]
): ScannerSignalItem[] {
  const signalMap = new Map<string, ScannerSignalItem>();
  const clearedSet = loadClearedSignalIds();

  for (const s of existingSignals) {
    // If the signal was previously cleared via TP/SL touch, ensure it is not kept as ACTIVE
    if (clearedSet.has(s.id) && s.status === 'ACTIVE') {
      signalMap.set(s.id, { ...s, status: 'EXPIRED' });
    } else {
      signalMap.set(s.id, s);
    }
  }

  for (const inc of incomingSignals) {
    if (!inc || !inc.id) continue;
    const existing = signalMap.get(inc.id);

    // If signal ID has already been cleared, it must NEVER reappear as ACTIVE
    if (clearedSet.has(inc.id)) {
      if (existing) {
        if (inc.status && inc.status !== 'ACTIVE') {
          signalMap.set(inc.id, { ...existing, ...inc });
        }
      } else if (inc.status && inc.status !== 'ACTIVE') {
        signalMap.set(inc.id, inc);
      }
      continue;
    }

    if (!existing) {
      // Prevent duplicate signals from the same closed candle across identical asset/timeframe/model
      const isDuplicateCandle = Array.from(signalMap.values()).some((s) =>
        s.asset === inc.asset &&
        s.timeframe === inc.timeframe &&
        (s.modelType || 'original') === (inc.modelType || 'original') &&
        (s.confirmedCandleCloseTime === inc.confirmedCandleCloseTime || s.timestamp === inc.timestamp)
      );

      if (isDuplicateCandle) {
        continue;
      }

      // New signal: ensure all V8 fields are initialized
      signalMap.set(inc.id, {
        ...inc,
        status: inc.status || 'ACTIVE',
        statusReason: inc.statusReason || 'Watching live prices against TP and SL',
        highestReached: inc.entryPrice,
        lowestReached: inc.entryPrice
      });
    } else if (existing.status === 'ACTIVE' && inc.status && inc.status !== 'ACTIVE') {
      // Update status if server or ticker settled it to WIN / LOSS / EXPIRED
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
  lowPriceNum?: number,
  candles?: Candle[]
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

    // 1. Evaluate touch on TP or SL using the accurate touch engine
    const touch = checkSignalTouch(s, currentPrice, candles);

    if (touch.isTouched && touch.touchedLevel) {
      changed = true;
      addClearedSignalId(s.id); // Permanently remove both TP and SL lines

      const isWin = touch.touchedLevel === 'TP';
      const exitPrice = touch.touchPrice;
      const isUp = s.direction === 'UP';
      const pnlRaw = isUp
        ? ((exitPrice - s.entryPrice) / s.entryPrice) * 100
        : ((s.entryPrice - exitPrice) / s.entryPrice) * 100;

      return {
        ...s,
        status: isWin ? ('WIN' as const) : ('LOSS' as const),
        statusReason: touch.reason,
        completedAt: touch.touchTimestamp || now,
        exitPrice,
        pnlPercent: isWin ? Math.abs(pnlRaw) : -Math.abs(pnlRaw),
        highestReached: highest,
        lowestReached: lowest
      };
    }

    // 2. Check Expiry
    if (now >= s.expiryTimestamp) {
      changed = true;
      addClearedSignalId(s.id); // Remove lines upon expiry
      return {
        ...s,
        status: 'EXPIRED' as const,
        statusReason: `Expired after ${s.expiryCandles} candle periods without reaching TP or SL.`,
        completedAt: now,
        exitPrice: currentPrice,
        pnlPercent: s.direction === 'UP'
          ? ((currentPrice - s.entryPrice) / s.entryPrice) * 100
          : ((s.entryPrice - currentPrice) / s.entryPrice) * 100,
        highestReached: highest,
        lowestReached: lowest
      };
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
 * Manually or programmatically settles an individual signal outcome,
 * permanently removing its TP and SL lines from all charts.
 */
export function settleSignalOutcome(
  signalId: string,
  outcome: 'WIN' | 'LOSS' | 'EXPIRED',
  exitPrice: number,
  reason: string
): void {
  try {
    const signals = loadStoredSignals();
    let changed = false;
    const now = Date.now();

    const updated = signals.map((s) => {
      if (s.id === signalId && s.status === 'ACTIVE') {
        changed = true;
        const isWin = outcome === 'WIN';
        const pnl = s.direction === 'UP'
          ? ((exitPrice - s.entryPrice) / s.entryPrice) * 100
          : ((s.entryPrice - exitPrice) / s.entryPrice) * 100;

        return {
          ...s,
          status: outcome,
          statusReason: reason,
          completedAt: now,
          exitPrice,
          pnlPercent: isWin ? Math.abs(pnl) : -Math.abs(pnl),
          highestReached: Math.max(s.highestReached || exitPrice, exitPrice),
          lowestReached: Math.min(s.lowestReached || exitPrice, exitPrice)
        };
      }
      return s;
    });

    if (changed) {
      saveStoredSignals(updated);
      addClearedSignalId(signalId);
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('nwwt_signal_settled', { detail: { signalId, outcome } }));
      }
    }
  } catch (err) {
    console.warn('[PerformanceEngine] Error settling signal outcome:', err);
  }
}

/**
 * Calculates aggregated performance statistics
 */
export function calculatePerformanceStats(signals: ScannerSignalItem[], isSubModel = false): SignalPerformanceStats {
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
  const byRegime: Record<string, SetupPerformance & { _pnlSum: number }> = {};

  function updateGroup(group: Record<string, SetupPerformance & { _pnlSum: number }>, key: string, status: string, pnl: number) {
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
    const winFrac = settled > 0 ? item.wins / settled : 0;
    const lossFrac = settled > 0 ? item.losses / settled : 0;
    const avgW = item.wins > 0 ? winPnlSum / (winsCount || 1) : 0;
    const avgL = item.losses > 0 ? lossPnlSum / (lossesCount || 1) : 0;
    item.expectancy = parseFloat((winFrac * avgW - lossFrac * avgL).toFixed(2));
  }

  let maxLosingStreak = 0;
  let curStreak = 0;

  for (const s of signals) {
    const pnl = s.pnlPercent || 0;
    if (s.status === 'ACTIVE') activeCount++;
    else if (s.status === 'WIN') {
      winsCount++;
      winPnlSum += pnl;
      curStreak = 0;
    } else if (s.status === 'LOSS') {
      lossesCount++;
      lossPnlSum += Math.abs(pnl);
      curStreak++;
      if (curStreak > maxLosingStreak) maxLosingStreak = curStreak;
    } else if (s.status === 'EXPIRED') {
      expiredCount++;
    }

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

  // Compute drawdown across chronological settled trades
  let peak = 0;
  let equity = 0;
  let maxDrawdown = 0;
  for (const s of [...signals].reverse()) {
    if (s.status === 'WIN' || s.status === 'LOSS') {
      const pnl = s.pnlPercent || 0;
      equity += pnl;
      if (equity > peak) peak = equity;
      const dd = peak - equity;
      if (dd > maxDrawdown) maxDrawdown = dd;
    }
  }

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
        avgPnlPercent: v.avgPnlPercent,
        expectancy: v.expectancy
      };
    }
    return out;
  };

  // Walk-forward validation calculation across settled trades
  const settledSignals = signals.filter((s) => s.status === 'WIN' || s.status === 'LOSS');
  let walkForward = undefined;
  if (settledSignals.length >= 8) {
    const sorted = [...settledSignals].sort((a, b) => a.timestamp - b.timestamp);
    const splitIdx = Math.floor(sorted.length * 0.6);
    const inSamp = sorted.slice(0, splitIdx);
    const outSamp = sorted.slice(splitIdx);

    const calcSub = (trades: ScannerSignalItem[]) => {
      let w = 0, l = 0, wPnl = 0, lPnl = 0, maxLs = 0, cs = 0;
      for (const t of trades) {
        const p = t.pnlPercent || 0;
        if (t.status === 'WIN') {
          w++;
          wPnl += p;
          cs = 0;
        } else if (t.status === 'LOSS') {
          l++;
          lPnl += Math.abs(p);
          cs++;
          if (cs > maxLs) maxLs = cs;
        }
      }
      const st = w + l;
      const wr = st > 0 ? (w / st) * 100 : 0;
      const aw = w > 0 ? wPnl / w : 0;
      const al = l > 0 ? lPnl / l : 0;
      const pf = lPnl > 0 ? wPnl / lPnl : w > 0 ? 9.99 : 0;
      const exp = st > 0 ? (w / st) * aw - (l / st) * al : 0;
      return {
        count: trades.length,
        settled: st,
        wins: w,
        losses: l,
        winRate: parseFloat(wr.toFixed(1)),
        profitFactor: parseFloat(pf.toFixed(2)),
        expectancy: parseFloat(exp.toFixed(2)),
        avgWinPercent: parseFloat(aw.toFixed(2)),
        avgLossPercent: parseFloat(al.toFixed(2)),
        maxLosingStreak: maxLs
      };
    };

    const inMetrics = calcSub(inSamp);
    const outMetrics = calcSub(outSamp);
    const efficiency = inMetrics.winRate > 0 ? (outMetrics.winRate / inMetrics.winRate) * 100 : 0;

    walkForward = {
      isValid: true,
      sampleSize: sorted.length,
      minRequired: 8,
      inSample: inMetrics,
      outOfSample: outMetrics,
      winRateEfficiency: parseFloat(efficiency.toFixed(1)),
      message:
        efficiency >= 80
          ? 'Robust: Out-of-sample forward validation matches baseline.'
          : 'Warning: Out-of-sample forward divergence detected.'
    };
  } else {
    walkForward = {
      isValid: false,
      sampleSize: settledSignals.length,
      minRequired: 8,
      inSample: null,
      outOfSample: null,
      message: 'Need >= 8 completed trades for walk-forward validation.'
    };
  }

  // Model-specific sub-stats (only computed at root level to prevent recursion)
  const byModel = !isSubModel
    ? {
        original: calculatePerformanceStats(signals.filter((s) => (s.modelType || 'original') === 'original'), true),
        inverse: calculatePerformanceStats(signals.filter((s) => s.modelType === 'inverse'), true),
        ai_filtered: calculatePerformanceStats(signals.filter((s) => s.modelType === 'ai_filtered'), true),
        ai_filtered_inverse: calculatePerformanceStats(signals.filter((s) => s.modelType === 'ai_filtered_inverse'), true)
      }
    : undefined;

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
    byAsset: cleanRecord(byAsset),
    byRegime: cleanRecord(byRegime),
    byModel,
    walkForward
  };
}
