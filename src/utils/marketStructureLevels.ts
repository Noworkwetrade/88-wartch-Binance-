/**
 * NWWT Market Structure Level Engine
 *
 * Implements strictly structure-based trade level generation:
 * 1. Dynamic Stop Loss:
 *    - Long: Placed below the most relevant recent swing low and nearby support with a volatility-aware buffer.
 *    - Short: Placed above the most relevant recent swing high and nearby resistance with a volatility-aware buffer.
 *    - Prevents tight stops on obvious swing points that get easily tripped by normal tick noise.
 * 2. Dynamic Take Profit Targets:
 *    - Long: TP1 anchored to the next meaningful swing high / resistance target.
 *            TP2 anchored to the secondary structural target only when sufficient room exists.
 *    - Short: TP1 anchored to the next meaningful swing low / support target.
 *             TP2 anchored to the secondary structural target only when sufficient room exists.
 *    - Never forces TP2 if no valid second target exists.
 * 3. Risk-to-Reward as a RESULT, not the reason:
 *    - Never pushes TP or tightens SL to manufacture a predetermined R:R ratio.
 *    - If resulting structure does not offer acceptable R:R (e.g. < 1.0) or target is obstructed, setup is rejected.
 * 4. Pair and Timeframe Specific:
 *    - Every pair and timeframe generates unique levels based on its actual volatility (ATR) and chart structure.
 * 5. No Forced Trades:
 *    - Rejects setups with unreasonably wide stops or insufficient room to target.
 *
 * Strictly educational market analysis. Never provides financial advice.
 */

import { Candle } from '../types';

export interface StructurePoint {
  price: number;
  index: number;
  time: number;
  type: 'high' | 'low';
}

export interface StructureReference {
  swingLow: number;
  swingHigh: number;
  supportLevel: number;
  resistanceLevel: number;
  buffer: number;
  atr: number;
  invalidationType: string;
  tp1TargetType: string;
  tp2TargetType?: string;
  riskDistance: number;
  targetDistance: number;
  timeframe: string;
  pair: string;
}

export interface MarketStructureLevelOptions {
  symbol: string;
  timeframe: string;
  direction: 'UP' | 'DOWN';
  entryPrice: number;
  candles: Candle[];
  higherTfCandles?: Candle[];
  setupType?: string;
  minRiskRewardRatio?: number; // Minimum acceptable R:R (default: 1.0)
  maxRiskPercent?: number;     // Maximum acceptable risk % (default: 6.5%)
  minTargetAtrMultiple?: number; // Minimum target distance relative to ATR (default: 0.6)
}

export interface MarketStructureLevelResult {
  isValid: boolean;
  rejectReason?: string;
  pair: string;
  timeframe: string;
  entryPrice: number;
  stopLoss: number;
  takeProfit1: number;
  takeProfit: number;
  takeProfit2?: number;
  riskDistance: number;
  targetDistance: number;
  rewardRiskRatio: number;
  structureReference: StructureReference;
}

/**
 * Calculates Average True Range (ATR) from closed candles
 */
export function calculateATR(candles: Candle[], period: number = 14): number {
  if (!candles || candles.length < 2) return 0.001;
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const cur = candles[i];
    const prev = candles[i - 1];
    const tr = Math.max(
      cur.high - cur.low,
      Math.abs(cur.high - prev.close),
      Math.abs(cur.low - prev.close)
    );
    trs.push(tr);
  }
  const slice = trs.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / (slice.length || 1);
}

/**
 * Identifies fractal swing highs and swing lows from closed candles
 */
export function findFractalSwings(candles: Candle[], lookback: number = 2): { highs: StructurePoint[]; lows: StructurePoint[] } {
  const highs: StructurePoint[] = [];
  const lows: StructurePoint[] = [];
  const len = candles.length;
  if (len < lookback * 2 + 1) return { highs, lows };

  for (let i = lookback; i < len - lookback; i++) {
    const cur = candles[i];
    let isHigh = true;
    let isLow = true;

    for (let j = 1; j <= lookback; j++) {
      if (cur.high <= candles[i - j].high || cur.high <= candles[i + j].high) {
        isHigh = false;
      }
      if (cur.low >= candles[i - j].low || cur.low >= candles[i + j].low) {
        isLow = false;
      }
    }

    if (isHigh) {
      highs.push({ price: cur.high, index: i, time: cur.openTime, type: 'high' });
    }
    if (isLow) {
      lows.push({ price: cur.low, index: i, time: cur.openTime, type: 'low' });
    }
  }

  return { highs, lows };
}

/**
 * Clusters nearby price levels into meaningful Support and Resistance zones
 */
export function clusterSupportResistance(candles: Candle[]): { supports: number[]; resistances: number[] } {
  const { highs, lows } = findFractalSwings(candles, 2);
  const highPrices = highs.map((h) => h.price);
  const lowPrices = lows.map((l) => l.price);

  function cluster(prices: number[], tolerancePct: number = 0.004): number[] {
    if (prices.length === 0) return [];
    const sorted = [...prices].sort((a, b) => a - b);
    const clusters: number[] = [];
    let curGroup: number[] = [sorted[0]];

    for (let i = 1; i < sorted.length; i++) {
      const avg = curGroup.reduce((a, b) => a + b, 0) / curGroup.length;
      if (Math.abs(sorted[i] - avg) / avg <= tolerancePct) {
        curGroup.push(sorted[i]);
      } else {
        clusters.push(avg);
        curGroup = [sorted[i]];
      }
    }
    if (curGroup.length > 0) {
      clusters.push(curGroup.reduce((a, b) => a + b, 0) / curGroup.length);
    }
    return clusters;
  }

  return {
    supports: cluster(lowPrices),
    resistances: cluster(highPrices)
  };
}

/**
 * Core engine calculating trade levels purely from market structure
 */
export function calculateMarketStructureLevels(options: MarketStructureLevelOptions): MarketStructureLevelResult {
  const {
    symbol,
    timeframe,
    direction,
    entryPrice,
    candles,
    higherTfCandles,
    setupType = 'Market Structure Setup',
    minRiskRewardRatio = 0.80,
    maxRiskPercent = 6.5,
    minTargetAtrMultiple = 0.55
  } = options;

  const len = candles ? candles.length : 0;
  if (len < 10 || !entryPrice || entryPrice <= 0) {
    return {
      isValid: false,
      rejectReason: 'Insufficient candle history to construct market structure levels.',
      pair: symbol,
      timeframe,
      entryPrice,
      stopLoss: entryPrice,
      takeProfit1: entryPrice,
      takeProfit: entryPrice,
      riskDistance: 0,
      targetDistance: 0,
      rewardRiskRatio: 0,
      structureReference: {
        swingLow: entryPrice,
        swingHigh: entryPrice,
        supportLevel: entryPrice,
        resistanceLevel: entryPrice,
        buffer: 0,
        atr: 0,
        invalidationType: 'none',
        tp1TargetType: 'none',
        riskDistance: 0,
        targetDistance: 0,
        timeframe,
        pair: symbol
      }
    };
  }

  // 1. Calculate Volatility & Dynamic Buffer for this specific pair & timeframe
  const atr = calculateATR(candles, 14);
  // Dynamic buffer: small structure-based buffer (12-15% of ATR or at least 0.05% of price)
  const minBuffer = entryPrice * 0.0005;
  const buffer = Math.max(minBuffer, Math.min(entryPrice * 0.0025, atr * 0.12));

  // 2. Identify Fractal Swings and S/R clusters
  const { highs, lows } = findFractalSwings(candles, 2);
  const { supports, resistances } = clusterSupportResistance(candles);

  // Higher timeframe context if available
  let htfHighs: StructurePoint[] = [];
  let htfLows: StructurePoint[] = [];
  if (higherTfCandles && higherTfCandles.length >= 8) {
    const htfSwings = findFractalSwings(higherTfCandles, 2);
    htfHighs = htfSwings.highs;
    htfLows = htfSwings.lows;
  }

  // 3. Fallback recent extreme swings in the last 20 candles
  const recentWindow = candles.slice(-25);
  const recentLowestLow = Math.min(...recentWindow.map((c) => c.low));
  const recentHighestHigh = Math.max(...recentWindow.map((c) => c.high));

  if (direction === 'UP') {
    // =========================================================================
    // LONG SETUP: Structure-Based Stop Loss and Take Profit
    // =========================================================================

    // A. Identify the most relevant recent swing low before entry
    // Filter swing lows strictly below entry price
    const validLowsBelow = lows
      .filter((l) => l.price < entryPrice)
      .sort((a, b) => b.time - a.time); // Most recent first

    let candidateLow = validLowsBelow.length > 0 ? validLowsBelow[0].price : recentLowestLow;

    // Check nearby support shelf
    const nearbySupports = supports.filter((s) => s < entryPrice && s >= candidateLow * 0.985);
    let chosenSupport = candidateLow;
    if (nearbySupports.length > 0) {
      // Pick the support floor that anchors the swing
      chosenSupport = Math.min(...nearbySupports);
    }

    // HTF Context: Do not allow a small timeframe swing to override a major nearby HTF support floor
    if (htfLows.length > 0) {
      const nearbyHtfSupport = htfLows
        .map((l) => l.price)
        .filter((p) => p < entryPrice && Math.abs(entryPrice - p) / entryPrice < 0.035);
      if (nearbyHtfSupport.length > 0) {
        const majorFloor = Math.max(...nearbyHtfSupport);
        if (majorFloor < candidateLow && (candidateLow - majorFloor) / entryPrice < 0.008) {
          chosenSupport = majorFloor;
        }
      }
    }

    const structuralLow = Math.min(candidateLow, chosenSupport);

    // Place stop loss beyond the logical invalidation area with structure-based buffer
    const stopLoss = parseFloat((structuralLow - buffer).toFixed(6));
    const riskDistance = parseFloat((entryPrice - stopLoss).toFixed(6));
    const riskPercent = (riskDistance / entryPrice) * 100;

    // Rule 7: No Forced Trades - Stop Loss Validation
    if (stopLoss >= entryPrice) {
      return rejectResult(symbol, timeframe, entryPrice, 'No logical structural invalidation swing low below entry.');
    }
    if (riskPercent > maxRiskPercent || riskDistance > atr * 4.5) {
      return rejectResult(symbol, timeframe, entryPrice, `Structural stop loss is unreasonably wide (${riskPercent.toFixed(2)}% | >4.5x ATR). Setup rejected.`);
    }
    if (riskDistance < buffer * 0.8) {
      return rejectResult(symbol, timeframe, entryPrice, 'Stop loss is too close to entry (structural compression noise). Setup rejected.');
    }

    // B. Identify Take Profit Targets based on actual chart structure
    // Find meaningful swing highs and resistance levels ABOVE entry price
    const validHighsAbove = highs
      .filter((h) => h.price > entryPrice + buffer)
      .sort((a, b) => a.price - b.price); // Ascending order

    const validResistancesAbove = resistances
      .filter((r) => r > entryPrice + buffer)
      .sort((a, b) => a - b);

    // Merge structural targets above entry
    const candidateTargets = Array.from(new Set([
      ...validHighsAbove.map((h) => h.price),
      ...validResistancesAbove
    ])).sort((a, b) => a - b);

    // If no candidate target exists above entry (e.g. fresh high discovery), look at recent highest high
    let tp1 = 0;
    let tp1Type = 'Recent Swing High';
    if (candidateTargets.length > 0) {
      tp1 = candidateTargets[0];
      tp1Type = 'Structural Resistance / Swing High';
    } else if (recentHighestHigh > entryPrice + buffer) {
      tp1 = recentHighestHigh;
      tp1Type = 'Recent 20-Bar High';
    } else {
      // No meaningful target before major structure
      return rejectResult(symbol, timeframe, entryPrice, 'No meaningful structural resistance target identified above entry. Setup rejected.');
    }

    const targetDistance = parseFloat((tp1 - entryPrice).toFixed(6));

    // Rule 7: TP1 too close to entry
    if (targetDistance < atr * minTargetAtrMultiple || (targetDistance / entryPrice) < 0.002) {
      return rejectResult(symbol, timeframe, entryPrice, `Take Profit #1 is too close to entry (${targetDistance.toFixed(2)} | <0.6x ATR) to provide a meaningful opportunity.`);
    }

    // Rule 4: Risk to reward becomes a result, not the reason for the level!
    // Do not move SL or TP simply to manufacture a desired RR!
    const rewardRiskRatio = parseFloat((targetDistance / riskDistance).toFixed(2));

    if (rewardRiskRatio < minRiskRewardRatio) {
      return rejectResult(
        symbol,
        timeframe,
        entryPrice,
        `Resulting structural risk-to-reward ratio (1:${rewardRiskRatio}) is unfavorable (<1:${minRiskRewardRatio}). Structure does not justify trade without moving levels.`
      );
    }

    // C. TP2: Next meaningful structure target when enough room exists
    let tp2: number | undefined = undefined;
    let tp2Type: string | undefined = undefined;

    // Look for a secondary target at least 0.75x ATR above TP1
    const secondaryCandidates = candidateTargets.filter((t) => t >= tp1 + atr * 0.75);
    if (secondaryCandidates.length > 0) {
      tp2 = parseFloat(secondaryCandidates[0].toFixed(6));
      tp2Type = 'Secondary Structural Resistance';
    } else if (htfHighs.length > 0) {
      const htfTargets = htfHighs.map((h) => h.price).filter((p) => p >= tp1 + atr * 0.75).sort((a, b) => a - b);
      if (htfTargets.length > 0) {
        tp2 = parseFloat(htfTargets[0].toFixed(6));
        tp2Type = 'Higher Timeframe Major Resistance';
      }
    }
    // Do NOT force TP2 if chart does not provide a valid second target!

    return {
      isValid: true,
      pair: symbol,
      timeframe,
      entryPrice,
      stopLoss,
      takeProfit1: tp1,
      takeProfit: tp1,
      takeProfit2: tp2,
      riskDistance,
      targetDistance,
      rewardRiskRatio,
      structureReference: {
        swingLow: structuralLow,
        swingHigh: tp1,
        supportLevel: chosenSupport,
        resistanceLevel: tp1,
        buffer,
        atr,
        invalidationType: `Below Swing Low ($${structuralLow.toFixed(2)}) + Volatility Buffer ($${buffer.toFixed(2)})`,
        tp1TargetType: tp1Type,
        tp2TargetType: tp2Type,
        riskDistance,
        targetDistance,
        timeframe,
        pair: symbol
      }
    };
  } else {
    // =========================================================================
    // SHORT SETUP: Structure-Based Stop Loss and Take Profit
    // =========================================================================

    // A. Identify the most relevant recent swing high before entry
    const validHighsAbove = highs
      .filter((h) => h.price > entryPrice)
      .sort((a, b) => b.time - a.time); // Most recent first

    let candidateHigh = validHighsAbove.length > 0 ? validHighsAbove[0].price : recentHighestHigh;

    // Check nearby resistance ceiling
    const nearbyResistances = resistances.filter((r) => r > entryPrice && r <= candidateHigh * 1.015);
    let chosenResistance = candidateHigh;
    if (nearbyResistances.length > 0) {
      chosenResistance = Math.max(...nearbyResistances);
    }

    // HTF Context: Check major HTF resistance ceiling
    if (htfHighs.length > 0) {
      const nearbyHtfRes = htfHighs
        .map((h) => h.price)
        .filter((p) => p > entryPrice && Math.abs(p - entryPrice) / entryPrice < 0.035);
      if (nearbyHtfRes.length > 0) {
        const majorCeiling = Math.min(...nearbyHtfRes);
        if (majorCeiling > candidateHigh && (majorCeiling - candidateHigh) / entryPrice < 0.008) {
          chosenResistance = majorCeiling;
        }
      }
    }

    const structuralHigh = Math.max(candidateHigh, chosenResistance);

    // Place stop loss beyond the logical invalidation area with structure-based buffer
    const stopLoss = parseFloat((structuralHigh + buffer).toFixed(6));
    const riskDistance = parseFloat((stopLoss - entryPrice).toFixed(6));
    const riskPercent = (riskDistance / entryPrice) * 100;

    // Rule 7: No Forced Trades - Stop Loss Validation
    if (stopLoss <= entryPrice) {
      return rejectResult(symbol, timeframe, entryPrice, 'No logical structural invalidation swing high above entry.');
    }
    if (riskPercent > maxRiskPercent || riskDistance > atr * 4.5) {
      return rejectResult(symbol, timeframe, entryPrice, `Structural stop loss is unreasonably wide (${riskPercent.toFixed(2)}% | >4.5x ATR). Setup rejected.`);
    }
    if (riskDistance < buffer * 0.8) {
      return rejectResult(symbol, timeframe, entryPrice, 'Stop loss is too close to entry (structural compression noise). Setup rejected.');
    }

    // B. Identify Take Profit Targets based on actual chart structure
    // Find meaningful swing lows and support levels BELOW entry price
    const validLowsBelow = lows
      .filter((l) => l.price < entryPrice - buffer)
      .sort((a, b) => b.price - a.price); // Descending order (highest floor first)

    const validSupportsBelow = supports
      .filter((s) => s < entryPrice - buffer)
      .sort((a, b) => b - a);

    // Merge structural targets below entry
    const candidateTargets = Array.from(new Set([
      ...validLowsBelow.map((l) => l.price),
      ...validSupportsBelow
    ])).sort((a, b) => b - a); // Descending order

    let tp1 = 0;
    let tp1Type = 'Recent Swing Low';
    if (candidateTargets.length > 0) {
      tp1 = candidateTargets[0];
      tp1Type = 'Structural Support / Swing Low';
    } else if (recentLowestLow < entryPrice - buffer) {
      tp1 = recentLowestLow;
      tp1Type = 'Recent 20-Bar Low';
    } else {
      return rejectResult(symbol, timeframe, entryPrice, 'No meaningful structural support target identified below entry. Setup rejected.');
    }

    const targetDistance = parseFloat((entryPrice - tp1).toFixed(6));

    // Rule 7: TP1 too close to entry
    if (targetDistance < atr * minTargetAtrMultiple || (targetDistance / entryPrice) < 0.002) {
      return rejectResult(symbol, timeframe, entryPrice, `Take Profit #1 is too close to entry (${targetDistance.toFixed(2)} | <0.6x ATR) to provide a meaningful opportunity.`);
    }

    // Rule 4: Risk to reward becomes a result, not the reason for the level!
    const rewardRiskRatio = parseFloat((targetDistance / riskDistance).toFixed(2));

    if (rewardRiskRatio < minRiskRewardRatio) {
      return rejectResult(
        symbol,
        timeframe,
        entryPrice,
        `Resulting structural risk-to-reward ratio (1:${rewardRiskRatio}) is unfavorable (<1:${minRiskRewardRatio}). Structure does not justify trade without moving levels.`
      );
    }

    // C. TP2: Next meaningful structure target when enough room exists
    let tp2: number | undefined = undefined;
    let tp2Type: string | undefined = undefined;

    const secondaryCandidates = candidateTargets.filter((t) => t <= tp1 - atr * 0.75);
    if (secondaryCandidates.length > 0) {
      tp2 = parseFloat(secondaryCandidates[0].toFixed(6));
      tp2Type = 'Secondary Structural Support';
    } else if (htfLows.length > 0) {
      const htfTargets = htfLows.map((l) => l.price).filter((p) => p <= tp1 - atr * 0.75).sort((a, b) => b - a);
      if (htfTargets.length > 0) {
        tp2 = parseFloat(htfTargets[0].toFixed(6));
        tp2Type = 'Higher Timeframe Major Support';
      }
    }

    return {
      isValid: true,
      pair: symbol,
      timeframe,
      entryPrice,
      stopLoss,
      takeProfit1: tp1,
      takeProfit: tp1,
      takeProfit2: tp2,
      riskDistance,
      targetDistance,
      rewardRiskRatio,
      structureReference: {
        swingLow: tp1,
        swingHigh: structuralHigh,
        supportLevel: tp1,
        resistanceLevel: chosenResistance,
        buffer,
        atr,
        invalidationType: `Above Swing High ($${structuralHigh.toFixed(2)}) + Volatility Buffer ($${buffer.toFixed(2)})`,
        tp1TargetType: tp1Type,
        tp2TargetType: tp2Type,
        riskDistance,
        targetDistance,
        timeframe,
        pair: symbol
      }
    };
  }
}

function rejectResult(
  symbol: string,
  timeframe: string,
  entryPrice: number,
  rejectReason: string
): MarketStructureLevelResult {
  return {
    isValid: false,
    rejectReason,
    pair: symbol,
    timeframe,
    entryPrice,
    stopLoss: entryPrice,
    takeProfit1: entryPrice,
    takeProfit: entryPrice,
    riskDistance: 0,
    targetDistance: 0,
    rewardRiskRatio: 0,
    structureReference: {
      swingLow: entryPrice,
      swingHigh: entryPrice,
      supportLevel: entryPrice,
      resistanceLevel: entryPrice,
      buffer: 0,
      atr: 0,
      invalidationType: 'rejected',
      tp1TargetType: 'rejected',
      riskDistance: 0,
      targetDistance: 0,
      timeframe,
      pair: symbol
    }
  };
}
