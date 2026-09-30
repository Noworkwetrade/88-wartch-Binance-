/**
 * AI Chart Scanner Engine - Market Reading & Decision Engine
 *
 * Reads real market conditions from connected chart data without assuming
 * any single fixed trading strategy.
 *
 * STRICT BEHAVIORS:
 * - Reads only real candles, volume, current price, timeframe, fractal swings,
 *   market structure, and structure breaks.
 * - Identifies Market Condition: 'trending bullish' | 'trending bearish' | 'ranging or neutral'.
 * - Adapts expectations to market regime (trending continuation/retest vs range boundary rejections).
 * - Weighs multiple conditions together without arbitrary checklist rigidity.
 * - NO SETUP is always allowed and is the default for weak, mixed, or conflicting evidence.
 * - Never guarantees outcomes, predicts absolute price, or claims best trades.
 */

import { Candle, Timeframe, MarketStructureResult, SwingPoint, StructureBreak } from '../../types.ts';
import {
  ScannerPattern,
  ScannerAnalysisResult,
  ScannerVolumeData,
  ScannerDecision,
  ScannerSignal,
  SetupQuality,
  MarketCondition
} from './types.ts';

export function runChartScan(
  asset: string,
  timeframe: Timeframe,
  candles: Candle[],
  volume: ScannerVolumeData,
  marketStructure: MarketStructureResult,
  currentPrice: number
): ScannerAnalysisResult {
  const len = candles.length;
  const now = Date.now();

  if (len < 5) {
    const defaultDecision: ScannerDecision = {
      signal: 'NO SETUP',
      setupQuality: 'NONE',
      marketCondition: 'ranging or neutral',
      marketStructure: 'Insufficient candle data',
      trendCondition: 'Unknown',
      volumeCondition: 'Awaiting data',
      keyPriceArea: `Current: $${currentPrice.toFixed(2)}`,
      reason: `Insufficient candle history on ${asset} (${timeframe}) to evaluate technical confluence.`,
      invalidationLevel: currentPrice
    };

    return {
      asset,
      timeframe,
      currentPrice,
      decision: defaultDecision,
      patterns: [],
      primaryPattern: null,
      overallConfidence: 0,
      trendConfluence: 'neutral',
      supportLevel: currentPrice * 0.98,
      resistanceLevel: currentPrice * 1.02,
      volumeStatus: 'average',
      educationalSummary: `Awaiting sufficient candle history on ${asset} (${timeframe}) to evaluate technical patterns.`,
      scannedAt: now
    };
  }

  // ==========================================
  // 1. VOLUME & PRICE-VOLUME RELATIONSHIP
  // ==========================================
  const volLookback = Math.min(20, len);
  let volSum = 0;
  for (let i = len - volLookback; i < len; i++) {
    volSum += candles[i].volume || 0;
  }
  const avgVolume = volSum / volLookback || 1;
  const latestVol = candles[len - 1].volume || 0;
  const volRatio = latestVol / avgVolume;

  const c0 = candles[len - 1]; // Current active candle
  const c1 = candles[len - 2]; // 1 candle ago
  const c2 = candles[len - 3]; // 2 candles ago
  const c3 = len >= 4 ? candles[len - 4] : null;

  const c0Body = Math.abs(c0.close - c0.open);
  const c0Range = c0.high - c0.low || 0.0001;
  const c0UpperWick = c0.high - Math.max(c0.open, c0.close);
  const c0LowerWick = Math.min(c0.open, c0.close) - c0.low;
  const c0IsGreen = c0.close >= c0.open;

  const c1Body = Math.abs(c1.close - c1.open);
  const c1Range = c1.high - c1.low || 0.0001;
  const c1UpperWick = c1.high - Math.max(c1.open, c1.close);
  const c1LowerWick = Math.min(c1.open, c1.close) - c1.low;
  const c1IsGreen = c1.close >= c1.open;

  // Price-Volume Relationship Assessment
  let volumeCondition = 'Average Volume';
  let volumeStatus: 'expanding' | 'average' | 'contracting' = 'average';
  let isVolumeExpansion = false;
  let isVolumeContraction = false;
  let isVolumeDisagreement = false; // e.g. High volume with tiny body, or breakout with dry volume

  if (volRatio >= 1.25) {
    isVolumeExpansion = true;
    volumeStatus = 'expanding';
    if (c0Body < c0Range * 0.25) {
      // High volume but very small body = Absorption / churning / exhaustion
      isVolumeDisagreement = true;
      volumeCondition = `High Volume Absorption (${(volRatio * 100).toFixed(0)}% of 20MA with compressed candle body)`;
    } else {
      volumeCondition = `Expanding Volume (${(volRatio * 100).toFixed(0)}% of 20MA supporting price move)`;
    }
  } else if (volRatio <= 0.7) {
    isVolumeContraction = true;
    volumeStatus = 'contracting';
    volumeCondition = `Contracting Volume (${(volRatio * 100).toFixed(0)}% of 20MA, light participation)`;
  } else {
    volumeCondition = `Normal Volume (${(volRatio * 100).toFixed(0)}% of 20MA baseline)`;
  }

  // ==========================================
  // 2. SUPPORT & RESISTANCE / KEY PRICE AREAS
  // ==========================================
  const recentHighs = marketStructure.swingPoints
    .filter((sp) => sp.isHigh && sp.price > currentPrice)
    .map((sp) => sp.price);
  const recentLows = marketStructure.swingPoints
    .filter((sp) => !sp.isHigh && sp.price < currentPrice)
    .map((sp) => sp.price);

  const resistanceLevel = recentHighs.length > 0
    ? Math.min(...recentHighs)
    : Math.max(...candles.slice(-15).map((c) => c.high));
  const supportLevel = recentLows.length > 0
    ? Math.max(...recentLows)
    : Math.min(...candles.slice(-15).map((c) => c.low));

  const distToSupportPct = Math.abs(currentPrice - supportLevel) / (supportLevel || 1);
  const distToResistancePct = Math.abs(resistanceLevel - currentPrice) / (resistanceLevel || 1);
  const isAtSupport = distToSupportPct <= 0.012;
  const isAtResistance = distToResistancePct <= 0.012;
  const isMidRange = !isAtSupport && !isAtResistance && distToSupportPct > 0.018 && distToResistancePct > 0.018;

  // ==========================================
  // 3. CANDLESTICK FORMATION RECOGNITION
  // ==========================================
  const patterns: ScannerPattern[] = [];

  // Bullish Engulfing
  if (!c1IsGreen && c0IsGreen && c0.close >= c1.open && c0.open <= c1.close && c0Body > c1Body * 1.05) {
    patterns.push({
      id: 'bullish-engulfing',
      name: 'Bullish Engulfing',
      bias: 'bullish',
      timeframe,
      confidence: isVolumeExpansion ? 88 : 80,
      candleIndex: len - 1,
      priceLevel: c0.close,
      invalidationPrice: Math.min(c0.low, c1.low),
      targetPrice: c0.close + Math.abs(c0.close - Math.min(c0.low, c1.low)) * 1.8,
      volumeConfirmation: isVolumeExpansion,
      structureConfluence: isAtSupport ? `Rejection at key support ($${supportLevel.toFixed(2)})` : `${timeframe} Bullish Momentum Shift`,
      description: `Green body completely engulfs prior red body, demonstrating buyer dominance.`
    });
  }

  // Bearish Engulfing
  if (c1IsGreen && !c0IsGreen && c0.close <= c1.open && c0.open >= c1.close && c0Body > c1Body * 1.05) {
    patterns.push({
      id: 'bearish-engulfing',
      name: 'Bearish Engulfing',
      bias: 'bearish',
      timeframe,
      confidence: isVolumeExpansion ? 88 : 80,
      candleIndex: len - 1,
      priceLevel: c0.close,
      invalidationPrice: Math.max(c0.high, c1.high),
      targetPrice: c0.close - Math.abs(Math.max(c0.high, c1.high) - c0.close) * 1.8,
      volumeConfirmation: isVolumeExpansion,
      structureConfluence: isAtResistance ? `Rejection at resistance ($${resistanceLevel.toFixed(2)})` : `${timeframe} Bearish Distribution`,
      description: `Red body completely engulfs prior green body, demonstrating seller dominance.`
    });
  }

  // Hammer (Bullish Pin Bar)
  if (c0LowerWick >= c0Body * 2.0 && c0UpperWick <= c0Body * 0.35) {
    patterns.push({
      id: 'hammer',
      name: 'Hammer (Bullish Pin Bar)',
      bias: 'bullish',
      timeframe,
      confidence: isVolumeExpansion ? 86 : 78,
      candleIndex: len - 1,
      priceLevel: c0.close,
      invalidationPrice: c0.low,
      targetPrice: c0.close + (c0.close - c0.low) * 1.6,
      volumeConfirmation: isVolumeExpansion,
      structureConfluence: isAtSupport ? `Demand rejection at support ($${supportLevel.toFixed(2)})` : `Lower wick price rejection`,
      description: `Long lower wick rejected lower prices at $${c0.low.toFixed(2)}, showing buyer absorption.`
    });
  }

  // Shooting Star (Bearish Pin Bar)
  if (c0UpperWick >= c0Body * 2.0 && c0LowerWick <= c0Body * 0.35) {
    patterns.push({
      id: 'shooting-star',
      name: 'Shooting Star (Bearish Pin Bar)',
      bias: 'bearish',
      timeframe,
      confidence: isVolumeExpansion ? 86 : 78,
      candleIndex: len - 1,
      priceLevel: c0.close,
      invalidationPrice: c0.high,
      targetPrice: c0.close - (c0.high - c0.close) * 1.6,
      volumeConfirmation: isVolumeExpansion,
      structureConfluence: isAtResistance ? `Supply rejection at resistance ($${resistanceLevel.toFixed(2)})` : `Upper wick price rejection`,
      description: `Extended upper shadow at $${c0.high.toFixed(2)} repelled by aggressive selling.`
    });
  }

  // Morning Star (3-Candle Reversal)
  if (c2 && c2.close < c2.open && c1Body <= c0Body * 0.5 && c0IsGreen && c0.close >= (c2.open + c2.close) / 2) {
    patterns.push({
      id: 'morning-star',
      name: 'Morning Star',
      bias: 'bullish',
      timeframe,
      confidence: 88,
      candleIndex: len - 1,
      priceLevel: c0.close,
      invalidationPrice: Math.min(c2.low, c1.low, c0.low),
      targetPrice: c0.close + Math.abs(c0.close - Math.min(c2.low, c1.low)) * 1.7,
      volumeConfirmation: isVolumeExpansion,
      structureConfluence: `Bottom exhaustion pivot with confirmed reversal`,
      description: `3-candle reversal: Impulsive drop followed by indecision star, confirmed by bullish recovery candle.`
    });
  }

  // Evening Star (3-Candle Bearish Reversal)
  if (c2 && c2.close > c2.open && c1Body <= c0Body * 0.5 && !c0IsGreen && c0.close <= (c2.open + c2.close) / 2) {
    patterns.push({
      id: 'evening-star',
      name: 'Evening Star',
      bias: 'bearish',
      timeframe,
      confidence: 88,
      candleIndex: len - 1,
      priceLevel: c0.close,
      invalidationPrice: Math.max(c2.high, c1.high, c0.high),
      targetPrice: c0.close - Math.abs(Math.max(c2.high, c1.high) - c0.close) * 1.7,
      volumeConfirmation: isVolumeExpansion,
      structureConfluence: `Top exhaustion pivot with confirmed breakdown`,
      description: `3-candle reversal: Impulsive rally followed by star, confirmed by bearish breakdown candle.`
    });
  }

  // Doji
  if (c0Body <= c0Range * 0.12 && c0Range > 0) {
    const isDragonfly = c0LowerWick >= c0Range * 0.65;
    const isGravestone = c0UpperWick >= c0Range * 0.65;
    const dojiName = isDragonfly ? 'Dragonfly Doji' : isGravestone ? 'Gravestone Doji' : 'Doji';
    const dojiBias = isDragonfly ? 'bullish' : isGravestone ? 'bearish' : 'neutral';

    patterns.push({
      id: 'doji',
      name: dojiName,
      bias: dojiBias,
      timeframe,
      confidence: isDragonfly || isGravestone ? 80 : 70,
      candleIndex: len - 1,
      priceLevel: c0.close,
      invalidationPrice: isDragonfly ? c0.low : isGravestone ? c0.high : c0.low,
      targetPrice: isDragonfly ? c0.close * 1.015 : isGravestone ? c0.close * 0.985 : c0.close,
      volumeConfirmation: !isVolumeExpansion,
      structureConfluence: `Equilibrium at $${c0.close.toFixed(2)}`,
      description: `Open and close virtually equal, indicating balance between buying and selling pressure.`
    });
  }

  // Three White Soldiers
  if (c2 && c1 && c3 && c0IsGreen && c1IsGreen && c2.close > c2.open && c0.close > c1.close && c1.close > c2.close) {
    patterns.push({
      id: 'three-white-soldiers',
      name: 'Three White Soldiers',
      bias: 'bullish',
      timeframe,
      confidence: 88,
      candleIndex: len - 1,
      priceLevel: c0.close,
      invalidationPrice: c2.open,
      targetPrice: c0.close + (c0.close - c2.open) * 0.8,
      volumeConfirmation: isVolumeExpansion,
      structureConfluence: `Consecutive bullish expansion`,
      description: `Three consecutive green candles closing near highs demonstrate persistent demand.`
    });
  }

  // Three Black Crows
  if (c2 && c1 && !c0IsGreen && !c1IsGreen && c2.close < c2.open && c0.close < c1.close && c1.close < c2.close) {
    patterns.push({
      id: 'three-black-crows',
      name: 'Three Black Crows',
      bias: 'bearish',
      timeframe,
      confidence: 88,
      candleIndex: len - 1,
      priceLevel: c0.close,
      invalidationPrice: c2.open,
      targetPrice: c0.close - (c2.open - c0.close) * 0.8,
      volumeConfirmation: isVolumeExpansion,
      structureConfluence: `Consecutive bearish breakdown`,
      description: `Three consecutive red candles closing near lows demonstrate persistent supply.`
    });
  }

  const primaryPattern = [...patterns].sort((a, b) => b.confidence - a.confidence)[0] || null;

  // ==========================================
  // 4. IDENTIFY CURRENT MARKET CONDITION
  // ==========================================
  const swings = marketStructure.swingPoints;
  const recentSwings = swings.slice(-8);
  const recentHighSwings = recentSwings.filter((s) => s.isHigh);
  const recentLowSwings = recentSwings.filter((s) => !s.isHigh);

  let higherHighCount = 0;
  let higherLowCount = 0;
  let lowerHighCount = 0;
  let lowerLowCount = 0;

  for (let i = 1; i < recentHighSwings.length; i++) {
    if (recentHighSwings[i].price > recentHighSwings[i - 1].price) higherHighCount++;
    if (recentHighSwings[i].price < recentHighSwings[i - 1].price) lowerHighCount++;
  }
  for (let i = 1; i < recentLowSwings.length; i++) {
    if (recentLowSwings[i].price > recentLowSwings[i - 1].price) higherLowCount++;
    if (recentLowSwings[i].price < recentLowSwings[i - 1].price) lowerLowCount++;
  }

  const isNetHHHL = higherHighCount >= lowerHighCount && higherLowCount >= lowerLowCount && (higherHighCount > 0 || higherLowCount > 0);
  const isNetLHLL = lowerHighCount >= higherHighCount && lowerLowCount >= higherLowCount && (lowerHighCount > 0 || lowerLowCount > 0);

  // Check Structure Breaks
  const lastBreak: StructureBreak | null = marketStructure.structureBreaks.length > 0
    ? marketStructure.structureBreaks[marketStructure.structureBreaks.length - 1]
    : null;
  const isRecentBOS = lastBreak && lastBreak.type === 'BOS' && lastBreak.breakIndex >= len - 8;
  const isRecentCHoCH = lastBreak && lastBreak.type === 'CHoCH' && lastBreak.breakIndex >= len - 8;

  let marketCondition: MarketCondition = 'ranging or neutral';
  if (marketStructure.currentTrend === 'bullish' && (isNetHHHL || (isRecentBOS && lastBreak?.direction === 'bullish'))) {
    marketCondition = 'trending bullish';
  } else if (marketStructure.currentTrend === 'bearish' && (isNetLHLL || (isRecentBOS && lastBreak?.direction === 'bearish'))) {
    marketCondition = 'trending bearish';
  } else {
    marketCondition = 'ranging or neutral';
  }

  // ==========================================
  // 5. EVALUATE BREAKOUTS & BREAK-AND-RETEST
  // ==========================================
  let isBullishBreakAndRetest = false;
  let isBearishBreakAndRetest = false;
  let breakRetestLevel = 0;

  const brokenHighs = marketStructure.swingPoints
    .filter((sp) => sp.isHigh && currentPrice >= sp.price && sp.index >= len - 14 && sp.index <= len - 2);
  if (brokenHighs.length > 0) {
    const brokenHigh = brokenHighs[brokenHighs.length - 1];
    const lowestSince = Math.min(...candles.slice(brokenHigh.index).map((c) => c.low));
    // Pullback tested broken high within 0.8% and current price remains above it
    if (Math.abs(lowestSince - brokenHigh.price) / brokenHigh.price <= 0.008 && currentPrice >= brokenHigh.price) {
      isBullishBreakAndRetest = true;
      breakRetestLevel = brokenHigh.price;
    }
  }

  const brokenLows = marketStructure.swingPoints
    .filter((sp) => !sp.isHigh && currentPrice <= sp.price && sp.index >= len - 14 && sp.index <= len - 2);
  if (brokenLows.length > 0) {
    const brokenLow = brokenLows[brokenLows.length - 1];
    const highestSince = Math.max(...candles.slice(brokenLow.index).map((c) => c.high));
    // Pullback tested broken low within 0.8% and current price remains below it
    if (Math.abs(highestSince - brokenLow.price) / brokenLow.price <= 0.008 && currentPrice <= brokenLow.price) {
      isBearishBreakAndRetest = true;
      breakRetestLevel = brokenLow.price;
    }
  }

  // Fresh Breakout validation (did candle close beyond recent high/low?)
  const isFreshBullishBreakout = c0.close > resistanceLevel && c1.close <= resistanceLevel;
  const isFreshBearishBreakout = c0.close < supportLevel && c1.close >= supportLevel;

  // Unconfirmed Breakout flag: breakout with contracting volume or upper wick rejection
  const isUnconfirmedBullishBreakout = isFreshBullishBreakout && (isVolumeContraction || c0UpperWick > c0Body);
  const isUnconfirmedBearishBreakout = isFreshBearishBreakout && (isVolumeContraction || c0LowerWick > c0Body);

  // Continuation candle: solid body closing near high/low with minimal counter wick
  const isBullishContinuationCandle = c0IsGreen && c0Body >= c0Range * 0.65 && c0UpperWick <= c0Range * 0.15;
  const isBearishContinuationCandle = !c0IsGreen && c0Body >= c0Range * 0.65 && c0LowerWick <= c0Range * 0.15;

  // Rejection wicks at key areas
  const hasSupportRejectionWick = c0LowerWick >= c0Range * 0.5 && isAtSupport;
  const hasResistanceRejectionWick = c0UpperWick >= c0Range * 0.5 && isAtResistance;

  // ==========================================
  // 6. MULTI-CONDITION CONFLUENCE DECISION
  // ==========================================
  let signal: ScannerSignal = 'NO SETUP';
  let setupQuality: SetupQuality = 'NONE';
  let reason = '';
  let invalidationLevel = currentPrice;
  let keyPriceArea = '';

  const swingHighCount = marketStructure.swingPoints.filter((s) => s.isHigh).length;
  const swingLowCount = marketStructure.swingPoints.filter((s) => !s.isHigh).length;
  const marketStructureSummary = `${marketStructure.currentTrend.toUpperCase()} (${swingHighCount} Highs, ${swingLowCount} Lows${lastBreak ? `, ${lastBreak.type} at $${lastBreak.breakPrice.toFixed(2)}` : ''})`;

  const trendConditionSummary =
    marketCondition === 'trending bullish'
      ? `Bullish progression with ${higherLowCount > 0 ? 'Higher Lows' : 'BOS expansion'}`
      : marketCondition === 'trending bearish'
      ? `Bearish progression with ${lowerHighCount > 0 ? 'Lower Highs' : 'BOS expansion'}`
      : 'Ranging / Sideways oscillation within key boundaries';

  const hasBullishPattern = primaryPattern && primaryPattern.bias === 'bullish';
  const hasBearishPattern = primaryPattern && primaryPattern.bias === 'bearish';

  // ----------------------------------------------------
  // REGIME 1: TRENDING BULLISH
  // ----------------------------------------------------
  if (marketCondition === 'trending bullish') {
    // Conflict Check 1: Fatal overhead ceiling
    if (distToResistancePct < 0.005 && !isFreshBullishBreakout) {
      signal = 'NO SETUP';
      setupQuality = 'NONE';
      keyPriceArea = `Resistance Ceiling at $${resistanceLevel.toFixed(2)}`;
      reason = `Trending bullish, but price is pinned directly against overhead resistance ($${resistanceLevel.toFixed(2)}). Risk-to-reward is unfavorable for continuation without a confirmed breakout.`;
      invalidationLevel = supportLevel;
    }
    // Conflict Check 2: Unconfirmed breakout (lack of volume or rejected wick)
    else if (isUnconfirmedBullishBreakout) {
      signal = 'NO SETUP';
      setupQuality = 'NONE';
      keyPriceArea = `Breakout Level at $${resistanceLevel.toFixed(2)}`;
      reason = `Price attempted to break resistance ($${resistanceLevel.toFixed(2)}), but volume is contracting (${(volRatio * 100).toFixed(0)}% of 20MA) with rejection wick. Unconfirmed breakout; high fakeout risk.`;
      invalidationLevel = supportLevel;
    }
    // Setup A: Confirmed Bullish Break-and-Retest (Reinforced setup)
    else if (isBullishBreakAndRetest && (hasBullishPattern || hasSupportRejectionWick || c0IsGreen)) {
      signal = 'UP';
      setupQuality = 'HIGH';
      keyPriceArea = `Retest Support at $${breakRetestLevel.toFixed(2)}`;
      reason = `Confirmed Break-and-Retest (Reinforced): Previous resistance ($${breakRetestLevel.toFixed(2)}) was defended on retest as new support with ${hasBullishPattern ? primaryPattern.name : 'lower wick rejection'}. Retest strongly reinforces trend continuation.`;
      invalidationLevel = Math.min(c0.low, breakRetestLevel * 0.995);
    }
    // Setup B: Pullback to Support / Higher Low in Bullish Trend
    else if (isAtSupport && (hasBullishPattern || hasSupportRejectionWick)) {
      signal = 'UP';
      setupQuality = isVolumeExpansion ? 'HIGH' : 'MODERATE';
      keyPriceArea = `Swing Support Zone at $${supportLevel.toFixed(2)}`;
      reason = `Bullish Trend Continuation: Pullback held at verified support ($${supportLevel.toFixed(2)}) with ${hasBullishPattern ? primaryPattern.name : 'support defense'} and ${volumeCondition}.`;
      invalidationLevel = Math.min(c0.low, supportLevel * 0.995);
    }
    // Setup C: Strong Confirmed Breakout (Retest Optional)
    else if (isFreshBullishBreakout && c0IsGreen) {
      signal = 'UP';
      setupQuality = isVolumeExpansion ? 'HIGH' : 'MODERATE';
      keyPriceArea = `Breakout Zone at $${resistanceLevel.toFixed(2)}`;
      reason = `Strong Confirmed Breakout: Closed candle broke firmly above resistance ($${resistanceLevel.toFixed(2)}) with decisive bullish momentum. Retest is optional.`;
      invalidationLevel = resistanceLevel * 0.994;
    }
    // Setup D: Trend Continuation Impulse
    else if (isBullishContinuationCandle && isVolumeExpansion && c0.close > c1.high && !isAtResistance) {
      signal = 'UP';
      setupQuality = 'MODERATE';
      keyPriceArea = `Ascending Base near $${supportLevel.toFixed(2)}`;
      reason = `Bullish Continuation Impulse: Strong green body closing near highs with volume expansion (+${((volRatio - 1) * 100).toFixed(0)}%) aligned with bullish market structure.`;
      invalidationLevel = c0.low;
    }
    // Conflict Check 3: Counter-trend bearish pattern in bullish trend
    else if (hasBearishPattern) {
      signal = 'NO SETUP';
      setupQuality = 'NONE';
      keyPriceArea = `Resistance: $${resistanceLevel.toFixed(2)}`;
      reason = `Detected ${primaryPattern.name}, but market is in an established Bullish Trend (HH/HL sequence). Counter-trend short is not justified without a confirmed CHoCH breakdown.`;
      invalidationLevel = primaryPattern.invalidationPrice;
    }
    // Incomplete Evidence
    else {
      signal = 'NO SETUP';
      setupQuality = 'NONE';
      keyPriceArea = `Support: $${supportLevel.toFixed(2)} | Resistance: $${resistanceLevel.toFixed(2)}`;
      reason = `Market is trending bullish, but current price action is mid-range without an active retest or fresh trigger candle. Awaiting pullback to support or confirmed breakout.`;
      invalidationLevel = supportLevel;
    }
  }

  // ----------------------------------------------------
  // REGIME 2: TRENDING BEARISH
  // ----------------------------------------------------
  else if (marketCondition === 'trending bearish') {
    // Conflict Check 1: Fatal floor into support
    if (distToSupportPct < 0.005 && !isFreshBearishBreakout) {
      signal = 'NO SETUP';
      setupQuality = 'NONE';
      keyPriceArea = `Support Floor at $${supportLevel.toFixed(2)}`;
      reason = `Trending bearish, but price is sitting directly on key support ($${supportLevel.toFixed(2)}). Selling into immediate demand without confirmed breakdown carries high bounce risk.`;
      invalidationLevel = resistanceLevel;
    }
    // Conflict Check 2: Unconfirmed breakdown
    else if (isUnconfirmedBearishBreakout) {
      signal = 'NO SETUP';
      setupQuality = 'NONE';
      keyPriceArea = `Breakdown Level at $${supportLevel.toFixed(2)}`;
      reason = `Price pushed below support ($${supportLevel.toFixed(2)}), but volume is contracting with lower wick rejection. Unconfirmed breakdown; high bear-trap risk.`;
      invalidationLevel = resistanceLevel;
    }
    // Setup A: Confirmed Bearish Breakdown-and-Retest (Reinforced setup)
    else if (isBearishBreakAndRetest && (hasBearishPattern || hasResistanceRejectionWick || !c0IsGreen)) {
      signal = 'DOWN';
      setupQuality = 'HIGH';
      keyPriceArea = `Retest Resistance at $${breakRetestLevel.toFixed(2)}`;
      reason = `Confirmed Breakdown-and-Retest (Reinforced): Previous support ($${breakRetestLevel.toFixed(2)}) was rejected on retest as new resistance with ${hasBearishPattern ? primaryPattern.name : 'upper wick rejection'}. Retest strongly reinforces trend continuation.`;
      invalidationLevel = Math.max(c0.high, breakRetestLevel * 1.005);
    }
    // Setup B: Rally to Resistance / Lower High in Bearish Trend
    else if (isAtResistance && (hasBearishPattern || hasResistanceRejectionWick)) {
      signal = 'DOWN';
      setupQuality = isVolumeExpansion ? 'HIGH' : 'MODERATE';
      keyPriceArea = `Swing Resistance Zone at $${resistanceLevel.toFixed(2)}`;
      reason = `Bearish Trend Continuation: Relief rally stalled at verified resistance ($${resistanceLevel.toFixed(2)}) with ${hasBearishPattern ? primaryPattern.name : 'supply rejection'} and ${volumeCondition}.`;
      invalidationLevel = Math.max(c0.high, resistanceLevel * 1.005);
    }
    // Setup C: Strong Confirmed Breakdown (Retest Optional)
    else if (isFreshBearishBreakout && !c0IsGreen) {
      signal = 'DOWN';
      setupQuality = isVolumeExpansion ? 'HIGH' : 'MODERATE';
      keyPriceArea = `Breakdown Zone at $${supportLevel.toFixed(2)}`;
      reason = `Strong Confirmed Breakdown: Closed candle broke firmly below support ($${supportLevel.toFixed(2)}) with decisive bearish momentum. Retest is optional.`;
      invalidationLevel = supportLevel * 1.006;
    }
    // Setup D: Trend Continuation Downward Impulse
    else if (isBearishContinuationCandle && isVolumeExpansion && c0.close < c1.low && !isAtSupport) {
      signal = 'DOWN';
      setupQuality = 'MODERATE';
      keyPriceArea = `Descending Supply near $${resistanceLevel.toFixed(2)}`;
      reason = `Bearish Continuation Impulse: Strong red body closing near lows with volume expansion (+${((volRatio - 1) * 100).toFixed(0)}%) aligned with bearish market structure.`;
      invalidationLevel = c0.high;
    }
    // Conflict Check 3: Counter-trend bullish pattern in bearish trend
    else if (hasBullishPattern) {
      signal = 'NO SETUP';
      setupQuality = 'NONE';
      keyPriceArea = `Support: $${supportLevel.toFixed(2)}`;
      reason = `Detected ${primaryPattern.name}, but market is in an established Bearish Trend (LH/LL sequence). Counter-trend long is not justified without a confirmed CHoCH reversal.`;
      invalidationLevel = primaryPattern.invalidationPrice;
    }
    // Incomplete Evidence
    else {
      signal = 'NO SETUP';
      setupQuality = 'NONE';
      keyPriceArea = `Support: $${supportLevel.toFixed(2)} | Resistance: $${resistanceLevel.toFixed(2)}`;
      reason = `Market is trending bearish, but current price action is mid-range without an active retest or fresh trigger candle. Awaiting relief rally to resistance or confirmed breakdown.`;
      invalidationLevel = resistanceLevel;
    }
  }

  // ----------------------------------------------------
  // REGIME 3: RANGING OR NEUTRAL MARKET
  // ----------------------------------------------------
  else {
    // In a range, trending continuation does NOT apply. We require clean boundary behavior.
    if (isAtSupport && (hasBullishPattern || hasSupportRejectionWick)) {
      // Rejection from range support
      signal = 'UP';
      setupQuality = isVolumeExpansion ? 'HIGH' : 'MODERATE';
      keyPriceArea = `Range Low Boundary at $${supportLevel.toFixed(2)}`;
      reason = `Range Support Rejection: Price tested lower range boundary ($${supportLevel.toFixed(2)}) and rejected with ${hasBullishPattern ? primaryPattern.name : 'lower wick defense'}. Target is range mid/high.`;
      invalidationLevel = Math.min(c0.low, supportLevel * 0.995);
    } else if (isAtResistance && (hasBearishPattern || hasResistanceRejectionWick)) {
      // Rejection from range resistance
      signal = 'DOWN';
      setupQuality = isVolumeExpansion ? 'HIGH' : 'MODERATE';
      keyPriceArea = `Range High Boundary at $${resistanceLevel.toFixed(2)}`;
      reason = `Range Resistance Rejection: Price tested upper range boundary ($${resistanceLevel.toFixed(2)}) and rejected with ${hasBearishPattern ? primaryPattern.name : 'upper wick rejection'}. Target is range mid/low.`;
      invalidationLevel = Math.max(c0.high, resistanceLevel * 1.005);
    } else if (isFreshBullishBreakout && isVolumeExpansion && !isVolumeDisagreement) {
      // High volume breakout above range
      signal = 'UP';
      setupQuality = 'MODERATE';
      keyPriceArea = `Range Breakout at $${resistanceLevel.toFixed(2)}`;
      reason = `Range Breakout: Candle broke above horizontal range resistance ($${resistanceLevel.toFixed(2)}) with expanding volume (${(volRatio * 100).toFixed(0)}% of 20MA).`;
      invalidationLevel = resistanceLevel * 0.994;
    } else if (isFreshBearishBreakout && isVolumeExpansion && !isVolumeDisagreement) {
      // High volume breakdown below range
      signal = 'DOWN';
      setupQuality = 'MODERATE';
      keyPriceArea = `Range Breakdown at $${supportLevel.toFixed(2)}`;
      reason = `Range Breakdown: Candle broke below horizontal range support ($${supportLevel.toFixed(2)}) with expanding volume (${(volRatio * 100).toFixed(0)}% of 20MA).`;
      invalidationLevel = supportLevel * 1.006;
    } else if (isMidRange) {
      // Mid-range chop
      signal = 'NO SETUP';
      setupQuality = 'NONE';
      keyPriceArea = `Support: $${supportLevel.toFixed(2)} | Resistance: $${resistanceLevel.toFixed(2)}`;
      reason = `Market is in a neutral consolidation range. Current price ($${currentPrice.toFixed(2)}) is in the middle of the range. Trading mid-range in neutral chop lacks structural edge.`;
      invalidationLevel = supportLevel;
    } else {
      signal = 'NO SETUP';
      setupQuality = 'NONE';
      keyPriceArea = `Support: $${supportLevel.toFixed(2)} | Resistance: $${resistanceLevel.toFixed(2)}`;
      reason = `Ranging / neutral market condition without clear boundary rejection. Awaiting test of range low ($${supportLevel.toFixed(2)}) or range high ($${resistanceLevel.toFixed(2)}).`;
      invalidationLevel = supportLevel;
    }
  }

  const decision: ScannerDecision = {
    signal,
    setupQuality,
    marketCondition,
    marketStructure: marketStructureSummary,
    trendCondition: trendConditionSummary,
    volumeCondition,
    keyPriceArea,
    reason,
    invalidationLevel
  };

  // Trend confluence calculation
  let trendConfluence: 'aligned' | 'counter-trend' | 'neutral' = 'neutral';
  if (primaryPattern) {
    if (
      (primaryPattern.bias === 'bullish' && marketCondition === 'trending bullish') ||
      (primaryPattern.bias === 'bearish' && marketCondition === 'trending bearish')
    ) {
      trendConfluence = 'aligned';
    } else if (
      (primaryPattern.bias === 'bullish' && marketCondition === 'trending bearish') ||
      (primaryPattern.bias === 'bearish' && marketCondition === 'trending bullish')
    ) {
      trendConfluence = 'counter-trend';
    }
  }

  const overallConfidence =
    signal === 'NO SETUP'
      ? 50
      : setupQuality === 'HIGH'
      ? 88
      : setupQuality === 'MODERATE'
      ? 76
      : 62;

  // Educational narrative
  const educationalSummary = `Decision: ${signal} (${setupQuality} Quality) on ${asset} (${timeframe}) at $${currentPrice.toFixed(2)}. Market condition: ${marketCondition}. ${reason} Invalidation level: $${invalidationLevel.toFixed(2)}. Analysis strictly for educational purposes based on OHLCV confluence. Not financial advice.`;

  return {
    asset,
    timeframe,
    currentPrice,
    decision,
    patterns,
    primaryPattern,
    overallConfidence,
    trendConfluence,
    supportLevel,
    resistanceLevel,
    volumeStatus,
    educationalSummary,
    scannedAt: now
  };
}
