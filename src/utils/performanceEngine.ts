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

import {
  ScannerSignalItem,
  SignalPerformanceStats,
  SetupPerformance,
  Timeframe,
  Candle,
  LivePerformanceSummary,
  BacktestPerformanceSummary
} from '../types.ts';
import { checkSignalTouch, addClearedSignalId, loadClearedSignalIds } from './signalTouchEngine.ts';
import { isPermanentlyExcludedSymbol } from './marketStructureQuality.ts';

const STORAGE_KEY = 'nwwt_v8_signal_performance';

export function loadStoredSignals(): ScannerSignalItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter(
        (s) =>
          s &&
          s.asset &&
          !isPermanentlyExcludedSymbol(s.asset) &&
          s.modelType !== 'inverse' &&
          s.modelType !== 'ai_filtered_inverse'
      );
    }
  } catch (err) {
    console.warn('[PerformanceEngine] Error loading stored signals:', err);
  }
  return [];
}

export function saveStoredSignals(signals: ScannerSignalItem[]): void {
  try {
    // Keep max 400 most recent signals, permanently excluding USDCUSDT & USD1USDT
    const sanitized = signals.filter((s) => s && s.asset && !isPermanentlyExcludedSymbol(s.asset));
    const trimmed = sanitized.slice(-400);
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
    if (!s || !s.id || isPermanentlyExcludedSymbol(s.asset)) continue;
    // If the signal was previously cleared via TP/SL touch, ensure it is not kept as ACTIVE
    if (clearedSet.has(s.id) && s.status === 'ACTIVE') {
      signalMap.set(s.id, { ...s, status: 'EXPIRED' });
    } else {
      signalMap.set(s.id, s);
    }
  }

  for (const inc of incomingSignals) {
    if (!inc || !inc.id || isPermanentlyExcludedSymbol(inc.asset)) continue;
    if (inc.modelType === 'inverse' || inc.modelType === 'ai_filtered_inverse') continue;
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
    } else if (existing) {
      // If incoming has newer completion state or tp1/tp2 hits, merge them cleanly
      if (inc.status && inc.status !== 'ACTIVE') {
        signalMap.set(inc.id, {
          ...existing,
          ...inc,
          // If already marked as WIN from TP1, never let a subsequent SL turn it into LOSS
          status: (existing.tp1Hit || existing.status === 'WIN') ? 'WIN' : inc.status,
          tp1Hit: existing.tp1Hit || inc.tp1Hit,
          tp2Hit: existing.tp2Hit || inc.tp2Hit,
          isTradeComplete: existing.isTradeComplete || inc.isTradeComplete
        });
      } else if (inc.tp1Hit || inc.tp2Hit) {
        signalMap.set(inc.id, {
          ...existing,
          ...inc,
          status: 'WIN',
          tp1Hit: existing.tp1Hit || inc.tp1Hit,
          tp2Hit: existing.tp2Hit || inc.tp2Hit,
          isTradeComplete: existing.isTradeComplete || inc.isTradeComplete
        });
      }
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
  if (isNaN(lastPriceNum) || lastPriceNum <= 0 || isPermanentlyExcludedSymbol(symbol)) {
    return { updatedSignals: signals, changed: false };
  }

  const now = Date.now();
  let changed = false;

  const updatedSignals = signals.map((s) => {
    // Continue evaluating if ACTIVE or if trade reached TP #1 but has not finished tracking for TP #2
    const isMonitoring = s.status === 'ACTIVE' || (s.status === 'WIN' && s.tp1Hit && !s.isTradeComplete);
    if (s.asset !== symbol || !isMonitoring) {
      return s;
    }

    const currentPrice = lastPriceNum;
    const highest = Math.max(s.highestReached || currentPrice, currentPrice);
    const lowest = Math.min(s.lowestReached || currentPrice, currentPrice);

    // 1. Evaluate touch on TP #1, TP #2, or SL using the accurate touch engine
    const touch = checkSignalTouch(s, currentPrice, candles);

    if (touch.isTouched && touch.touchedLevel) {
      changed = true;
      const isUp = s.direction === 'UP';
      const exitPrice = touch.touchPrice;
      const pnlRaw = isUp
        ? ((exitPrice - s.entryPrice) / s.entryPrice) * 100
        : ((s.entryPrice - exitPrice) / s.entryPrice) * 100;

      // Case A: TP #2 reached (trade complete)
      if (touch.touchedLevel === 'TP2') {
        addClearedSignalId(s.id); // Permanently remove trade lines
        return {
          ...s,
          tp1Hit: true,
          tp2Hit: true,
          tp2HitTimestamp: touch.touchTimestamp || now,
          tp2Price: exitPrice,
          isTradeComplete: true,
          status: 'WIN' as const,
          displayMessage: 'tp #2 hit | trade complete',
          statusReason: 'tp #2 hit | trade complete',
          completedAt: touch.touchTimestamp || now,
          exitPrice,
          pnlPercent: Math.abs(pnlRaw),
          highestReached: highest,
          lowestReached: lowest
        };
      }

      // Case B: TP #1 reached (immediately counts as WIN, trade continues tracking TP2)
      if (touch.touchedLevel === 'TP1' || touch.touchedLevel === 'TP') {
        const rr = s.rewardRiskRatio || (Math.abs(exitPrice - s.entryPrice) / (Math.abs(s.entryPrice - s.stopLoss) || 1));
        const rrStr = rr.toFixed(2);
        const msg = `tp #1 hit | r:r ${rrStr} | win`;

        if (touch.isTradeComplete) {
          addClearedSignalId(s.id);
        }

        return {
          ...s,
          tp1Hit: true,
          tp1HitTimestamp: touch.touchTimestamp || now,
          tp1Price: exitPrice,
          status: 'WIN' as const,
          displayMessage: msg,
          statusReason: msg,
          exitPrice,
          pnlPercent: Math.abs(pnlRaw),
          isTradeComplete: !!touch.isTradeComplete,
          highestReached: highest,
          lowestReached: lowest
        };
      }

      // Case C: SL touched
      if (touch.touchedLevel === 'SL') {
        addClearedSignalId(s.id);
        // If TP #1 was already secured, trade REMAINS A WIN!
        if (s.tp1Hit) {
          const rr = s.rewardRiskRatio || (Math.abs((s.tp1Price || s.takeProfit) - s.entryPrice) / (Math.abs(s.entryPrice - s.stopLoss) || 1));
          const rrStr = rr.toFixed(2);
          return {
            ...s,
            isTradeComplete: true,
            status: 'WIN' as const,
            displayMessage: `tp #1 hit | r:r ${rrStr} | win`,
            statusReason: `tp #1 hit | r:r ${rrStr} | win (reversal to SL)`,
            completedAt: touch.touchTimestamp || now,
            exitPrice,
            highestReached: highest,
            lowestReached: lowest
          };
        }

        // SL hit before TP1 -> LOSS
        return {
          ...s,
          isTradeComplete: true,
          status: 'LOSS' as const,
          statusReason: touch.reason,
          completedAt: touch.touchTimestamp || now,
          exitPrice,
          pnlPercent: -Math.abs(pnlRaw),
          highestReached: highest,
          lowestReached: lowest
        };
      }

      // Case D: BOTH touched simultaneously in same period -> conservative LOSS
      if (touch.touchedLevel === 'BOTH') {
        addClearedSignalId(s.id);
        return {
          ...s,
          isTradeComplete: true,
          status: 'LOSS' as const,
          statusReason: touch.reason,
          completedAt: touch.touchTimestamp || now,
          exitPrice,
          pnlPercent: -Math.abs(pnlRaw),
          highestReached: highest,
          lowestReached: lowest
        };
      }
    }

    // 2. Check Expiry
    if (now >= s.expiryTimestamp) {
      changed = true;
      addClearedSignalId(s.id); // Remove lines upon expiry
      // If TP1 was already hit, keep as WIN upon expiry!
      if (s.tp1Hit) {
        return {
          ...s,
          isTradeComplete: true,
          status: 'WIN' as const,
          statusReason: `Trade completed: Expired after TP #1 secured`,
          completedAt: now,
          exitPrice: currentPrice,
          highestReached: highest,
          lowestReached: lowest
        };
      }

      return {
        ...s,
        isTradeComplete: true,
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
      if (s.id === signalId && (s.status === 'ACTIVE' || (s.status === 'WIN' && !s.isTradeComplete))) {
        changed = true;
        // If TP #1 was already secured, trade permanently REMAINS A WIN even if price hits SL later!
        const finalStatus: 'WIN' | 'LOSS' | 'EXPIRED' = (s.tp1Hit || s.status === 'WIN') ? 'WIN' : outcome;
        const isWin = finalStatus === 'WIN';
        const pnl = s.direction === 'UP'
          ? ((exitPrice - s.entryPrice) / s.entryPrice) * 100
          : ((s.entryPrice - exitPrice) / s.entryPrice) * 100;

        const isTp1 = outcome === 'WIN' && !s.tp1Hit && !reason.includes('tp #2');
        const isTp2 = outcome === 'WIN' && (reason.includes('tp #2') || s.tp1Hit);
        const isTradeComplete = isTp2 || outcome === 'LOSS' || outcome === 'EXPIRED' || (s.tp1Hit && reason.includes('reversal'));

        return {
          ...s,
          status: finalStatus,
          statusReason: reason,
          displayMessage: reason,
          tp1Hit: s.tp1Hit || isTp1 || isTp2,
          tp1HitTimestamp: s.tp1HitTimestamp || (isTp1 ? now : undefined),
          tp1Price: s.tp1Price || (isTp1 ? exitPrice : undefined),
          tp2Hit: s.tp2Hit || isTp2,
          tp2HitTimestamp: s.tp2HitTimestamp || (isTp2 ? now : undefined),
          tp2Price: s.tp2Price || (isTp2 ? exitPrice : undefined),
          isTradeComplete: s.isTradeComplete || isTradeComplete,
          completedAt: isTradeComplete ? (s.completedAt || now) : s.completedAt,
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
      if (updated.some((s) => s.id === signalId && s.isTradeComplete)) {
        addClearedSignalId(signalId);
      }
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
  const sanitizedSignals = signals.filter((s) => s && s.asset && !isPermanentlyExcludedSymbol(s.asset));
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

  for (const s of sanitizedSignals) {
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

  // Calculate separated Live Performance (STRICT: only verified live signals, never backtest)
  const liveSignals = signals.filter((s) => !s.isBacktest);
  const liveSettled = liveSignals.filter((s) => s.status === 'WIN' || s.status === 'LOSS');
  let liveWins = 0;
  let liveLosses = 0;
  let liveWinPnl = 0;
  let liveLossPnl = 0;
  let livePeak = 0;
  let liveEquity = 0;
  let liveMaxDrawdown = 0;

  for (const s of [...liveSettled].reverse()) {
    const pnl = s.pnlPercent || 0;
    if (s.status === 'WIN') {
      liveWins++;
      liveWinPnl += pnl;
    } else if (s.status === 'LOSS') {
      liveLosses++;
      liveLossPnl += Math.abs(pnl);
    }
    liveEquity += pnl;
    if (liveEquity > livePeak) livePeak = liveEquity;
    const dd = livePeak - liveEquity;
    if (dd > liveMaxDrawdown) liveMaxDrawdown = dd;
  }
  const liveTradesTotal = liveWins + liveLosses;
  const liveWinRate = liveTradesTotal > 0 ? parseFloat(((liveWins / liveTradesTotal) * 100).toFixed(1)) : 0;
  const livePF = liveLossPnl > 0 ? parseFloat((liveWinPnl / liveLossPnl).toFixed(2)) : liveWins > 0 ? 9.99 : 0;
  const liveAvgW = liveWins > 0 ? liveWinPnl / liveWins : 0;
  const liveAvgL = liveLosses > 0 ? liveLossPnl / liveLosses : 0;
  const liveExp = liveTradesTotal > 0 ? parseFloat(((liveWins / liveTradesTotal) * liveAvgW - (liveLosses / liveTradesTotal) * liveAvgL).toFixed(2)) : 0;

  const liveStats: LivePerformanceSummary = {
    trades: liveTradesTotal,
    wins: liveWins,
    losses: liveLosses,
    winRate: liveWinRate,
    profitFactor: livePF,
    expectancy: liveExp,
    drawdown: parseFloat(liveMaxDrawdown.toFixed(2)),
    sampleSize: liveSignals.length
  };

  // Calculate separated Backtest Performance (STRICT: quarantined from live stats)
  const backtestSignals = signals.filter((s) => s.isBacktest === true);
  let backtestTradesTotal = 0;
  let backtestWinRate = 0;
  let backtestProfitFactor = 0;
  let backtestDrawdown = 0;
  let backtestSampleSize = 0;

  if (backtestSignals.length > 0) {
    let btWins = 0;
    let btLosses = 0;
    let btWinPnl = 0;
    let btLossPnl = 0;
    let btPeak = 0;
    let btEquity = 0;
    let btMaxDd = 0;
    for (const s of [...backtestSignals].reverse()) {
      const pnl = s.pnlPercent || 0;
      if (s.status === 'WIN') {
        btWins++;
        btWinPnl += pnl;
      } else if (s.status === 'LOSS') {
        btLosses++;
        btLossPnl += Math.abs(pnl);
      }
      btEquity += pnl;
      if (btEquity > btPeak) btPeak = btEquity;
      const dd = btPeak - btEquity;
      if (dd > btMaxDd) btMaxDd = dd;
    }
    backtestTradesTotal = btWins + btLosses;
    backtestWinRate = backtestTradesTotal > 0 ? parseFloat(((btWins / backtestTradesTotal) * 100).toFixed(1)) : 0;
    backtestProfitFactor = btLossPnl > 0 ? parseFloat((btWinPnl / btLossPnl).toFixed(2)) : btWins > 0 ? 9.99 : 0;
    backtestDrawdown = parseFloat(btMaxDd.toFixed(2));
    backtestSampleSize = backtestSignals.length;
  } else if (walkForward && walkForward.inSample) {
    // If no explicit backtest items, baseline in-sample training performance represents backtest benchmark
    backtestTradesTotal = walkForward.inSample.settled;
    backtestWinRate = walkForward.inSample.winRate;
    backtestProfitFactor = walkForward.inSample.profitFactor;
    backtestDrawdown = parseFloat(maxDrawdown.toFixed(2));
    backtestSampleSize = walkForward.inSample.count;
  }

  const backtestStats: BacktestPerformanceSummary = {
    trades: backtestTradesTotal,
    winRate: backtestWinRate,
    profitFactor: backtestProfitFactor,
    drawdown: backtestDrawdown,
    sampleSize: backtestSampleSize
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
    expectancy,
    maxLosingStreak,
    drawdown: parseFloat(maxDrawdown.toFixed(2)),
    sampleSize: settledTotal,
    hasSufficientSample: settledTotal >= 10,
    liveStats,
    backtestStats,
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
