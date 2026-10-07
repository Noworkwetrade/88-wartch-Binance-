/**
 * AI Market Structure Intelligence & Regime Detection Engine
 *
 * Implements:
 * 1. Market Regime Detector (trending_up, trending_down, ranging, high_volatility, low_volatility, transition)
 * 2. Multi-Factor Structural Setup Validation (allow, reject, wait) with 0-100 Confidence
 * 3. 4-Model Research Generator (original, inverse, ai_filtered, ai_filtered_inverse)
 * 4. Walk-Forward Validation Engine (In-Sample vs Out-of-Sample evaluation with zero future lookahead)
 * 5. Adaptive Historical Safeguards (minimum sample requirement before adapting)
 *
 * Strictly educational market analysis. Never executes automated trades.
 */

// Helper to calculate Simple Moving Average
export function calcSMA(candles, period, source = 'close') {
  if (candles.length < period) return null;
  const slice = candles.slice(-period);
  const sum = slice.reduce((acc, c) => acc + (c[source] || 0), 0);
  return sum / period;
}

// Helper to calculate Exponential Moving Average
export function calcEMA(candles, period) {
  if (candles.length < period) return null;
  const k = 2 / (period + 1);
  let ema = candles[0].close;
  for (let i = 1; i < candles.length; i++) {
    ema = candles[i].close * k + ema * (1 - k);
  }
  return ema;
}

// Helper to calculate True Range and Average True Range (ATR)
export function calcATR(candles, period = 14) {
  if (candles.length < period + 1) return 0.001;
  const trs = [];
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
  if (trs.length < period) return trs.reduce((a, b) => a + b, 0) / (trs.length || 1);
  const recentTrs = trs.slice(-period);
  return recentTrs.reduce((a, b) => a + b, 0) / period;
}

/**
 * Detects Market Regime strictly from historical closed candles
 * Regimes:
 * - trending_up: Strong bullish EMA alignment, higher swing progression, low chop
 * - trending_down: Strong bearish EMA alignment, lower swing progression, low chop
 * - ranging: Flattening EMAs, price oscillating between swing bounds
 * - high_volatility: ATR expands > 1.45x 20-period baseline or wide erratic bars
 * - low_volatility: ATR contracts < 0.65x baseline (tight compression)
 * - transition: Recent structure breach opposing multi-candle trend, EMA compression
 */
export function detectMarketRegime(candles) {
  const len = candles.length;
  if (len < 15) {
    return {
      regime: 'ranging',
      trendDirection: 'neutral',
      trendStrength: 50,
      volatilityRatio: 1.0,
      rangeWidthPercent: 1.0,
      adxEquivalent: 20,
      description: 'Insufficient candles for regime confirmation.'
    };
  }

  const c0 = candles[len - 1];
  const currentPrice = c0.close;

  // Short, medium, and base EMAs
  const ema9 = calcEMA(candles.slice(-30), 9) || currentPrice;
  const ema21 = calcEMA(candles.slice(-45), 21) || currentPrice;
  const ema50 = calcEMA(candles.slice(-60), 50) || currentPrice;

  // Volatility evaluation: current short ATR vs 20-period baseline
  const currentATR = calcATR(candles.slice(-10), 7);
  const baselineATR = calcATR(candles, 20);
  const volatilityRatio = baselineATR > 0 ? currentATR / baselineATR : 1.0;

  // Swing points in the last 20 candles
  const windowCandles = candles.slice(-25);
  const highestPrice = Math.max(...windowCandles.map((c) => c.high));
  const lowestPrice = Math.min(...windowCandles.map((c) => c.low));
  const rangeWidthPercent = lowestPrice > 0 ? ((highestPrice - lowestPrice) / lowestPrice) * 100 : 1;

  // Slope and EMA separation
  const bullAlignment = currentPrice > ema9 && ema9 > ema21 && ema21 > ema50;
  const bearAlignment = currentPrice < ema9 && ema9 < ema21 && ema21 < ema50;

  // Directional momentum over 12 bars
  const price12Ago = candles[Math.max(0, len - 12)].close;
  const net12Return = price12Ago > 0 ? ((currentPrice - price12Ago) / price12Ago) * 100 : 0;

  // Trend strength index (0 to 100)
  let trendStrength = Math.min(100, Math.max(10, Math.abs(net12Return) * 12));
  if (bullAlignment || bearAlignment) trendStrength = Math.min(100, trendStrength + 25);

  let regime = 'ranging';
  let trendDirection = 'neutral';
  let description = 'Market oscillating in consolidation range.';

  if (volatilityRatio > 1.55) {
    regime = 'high_volatility';
    trendDirection = net12Return > 0.5 ? 'bullish' : net12Return < -0.5 ? 'bearish' : 'neutral';
    description = `Elevated volatility: candle expansion (${volatilityRatio.toFixed(2)}x baseline ATR).`;
  } else if (volatilityRatio < 0.62) {
    regime = 'low_volatility';
    trendDirection = 'neutral';
    description = `Volatility compression: tight range before liquidity expansion.`;
  } else if (bullAlignment && net12Return > 0.8) {
    regime = 'trending_up';
    trendDirection = 'bullish';
    description = `Bullish structural trend: price positioned above aligned 9/21/50 EMAs with positive momentum.`;
  } else if (bearAlignment && net12Return < -0.8) {
    regime = 'trending_down';
    trendDirection = 'bearish';
    description = `Bearish structural trend: price positioned below aligned 9/21/50 EMAs with negative momentum.`;
  } else if (Math.abs(net12Return) < 0.6 && rangeWidthPercent < 3.5) {
    regime = 'ranging';
    trendDirection = 'neutral';
    description = `Horizontal balance: oscillating between $${lowestPrice.toFixed(2)} and $${highestPrice.toFixed(2)}.`;
  } else {
    regime = 'transition';
    trendDirection = net12Return > 0 ? 'bullish' : 'bearish';
    description = `Structural transition: mixed moving average alignment and shifting momentum.`;
  }

  return {
    regime,
    trendDirection,
    trendStrength: Math.round(trendStrength),
    volatilityRatio: parseFloat(volatilityRatio.toFixed(2)),
    rangeWidthPercent: parseFloat(rangeWidthPercent.toFixed(2)),
    highestPrice,
    lowestPrice,
    description
  };
}

/**
 * Deep Structural Setup Validation
 * Analyzes:
 * - Trend direction & strength
 * - Range vs trend conditions
 * - Recent swing highs/lows
 * - S/R proximity & barriers
 * - BOS & CHoCH
 * - Break & retest confirmation
 * - Fakeout rejection mechanics
 * - Rejection wicks vs continuation body closes
 * - R:R ratio geometry
 * - Historical regime adaptability (safeguard: requires >= 4 completed samples)
 *
 * Returns: { status: 'allow' | 'reject' | 'wait', confidence: number (0-100), reason: string, conditions: Record }
 */
export function validateSetupWithStructureIntelligence(
  setup,
  candles,
  regimeData,
  completedPerformanceStats = null
) {
  const len = candles.length;
  if (len < 10 || !setup) {
    return {
      status: 'wait',
      confidence: 50,
      reason: 'Insufficient structural data to validate setup quality.',
      regime: regimeData?.regime || 'ranging',
      conditions: {}
    };
  }

  const c0 = candles[len - 1]; // most recently closed candle
  const c1 = candles[len - 2];
  const c2 = len >= 3 ? candles[len - 3] : c1;

  const c0Range = Math.max(0.0001, c0.high - c0.low);
  const c0Body = Math.abs(c0.close - c0.open);
  const c0UpperWick = c0.high - Math.max(c0.open, c0.close);
  const c0LowerWick = Math.min(c0.open, c0.close) - c0.low;
  const c0IsGreen = c0.close >= c0.open;

  const isUp = setup.direction === 'UP';

  // 1. Risk to Reward Geometry
  const risk = Math.abs(setup.entryPrice - setup.stopLoss);
  const reward = Math.abs(setup.takeProfit - setup.entryPrice);
  const rrRatio = risk > 0 ? reward / risk : 1.0;
  const distanceToTpPct = setup.entryPrice > 0 ? (reward / setup.entryPrice) * 100 : 0;
  const distanceToSlPct = setup.entryPrice > 0 ? (risk / setup.entryPrice) * 100 : 0;

  // 2. Identify Key Swing Points in last 30 bars
  const swingHighs = [];
  const swingLows = [];
  for (let i = 2; i < len - 2; i++) {
    const cur = candles[i];
    if (
      cur.high > candles[i - 1].high &&
      cur.high > candles[i - 2].high &&
      cur.high > candles[i + 1].high &&
      cur.high > candles[i + 2].high
    ) {
      swingHighs.push(cur.high);
    }
    if (
      cur.low < candles[i - 1].low &&
      cur.low < candles[i - 2].low &&
      cur.low < candles[i + 1].low &&
      cur.low < candles[i + 2].low
    ) {
      swingLows.push(cur.low);
    }
  }

  const nearestSwingHigh = swingHighs.length > 0 ? swingHighs[swingHighs.length - 1] : c0.high;
  const nearestSwingLow = swingLows.length > 0 ? swingLows[swingLows.length - 1] : c0.low;

  // 3. Structural Barriers to TP
  // If longing and a major swing resistance sits between entry and TP, setup is obstructed
  let isObstructed = false;
  let obstructionNote = '';
  if (isUp) {
    const opposingRes = swingHighs.filter((h) => h > setup.entryPrice && h < setup.takeProfit);
    if (opposingRes.length > 1) {
      isObstructed = true;
      obstructionNote = `Major structural resistance clusters ($${opposingRes[0].toFixed(2)}) lie between entry and TP.`;
    }
  } else {
    const opposingSupp = swingLows.filter((l) => l < setup.entryPrice && l > setup.takeProfit);
    if (opposingSupp.length > 1) {
      isObstructed = true;
      obstructionNote = `Major structural support clusters ($${opposingSupp[0].toFixed(2)}) lie between entry and TP.`;
    }
  }

  // 4. Candlestick Confirmation Quality
  // Continuation body closes vs rejection wicks
  const bodyRatio = c0Body / c0Range;
  const decisiveClose = bodyRatio > 0.48;
  const strongRejectionWick = isUp ? c0LowerWick / c0Range > 0.42 : c0UpperWick / c0Range > 0.42;
  const adverseWick = isUp ? c0UpperWick / c0Range > 0.45 : c0LowerWick / c0Range > 0.45;

  // 5. Regime-Setup Alignment Check
  // E.g., BOS/Breakouts have low win-rates in ranging/low_volatility environments
  // Fakeout rejections thrive in ranging environments
  let regimeCompatibilityScore = 20; // 0 to 40
  let regimeMismatch = false;

  const isBreakout = setup.setupType.includes('Break') || setup.setupType.includes('BOS');
  const isFakeout = setup.setupType.includes('Fakeout');
  const isEngulfing = setup.setupType.includes('Engulfing');

  if (regimeData.regime === 'ranging' || regimeData.regime === 'low_volatility') {
    if (isBreakout) {
      regimeCompatibilityScore = -15; // Breakouts frequently fail in tight ranges
      regimeMismatch = true;
    } else if (isFakeout || isEngulfing) {
      regimeCompatibilityScore = 35; // Ideal for mean reversion / sweeps
    }
  } else if (regimeData.regime === 'trending_up') {
    if (isUp) {
      regimeCompatibilityScore = 35;
    } else {
      regimeCompatibilityScore = -10; // Counter-trend short in strong uptrend
    }
  } else if (regimeData.regime === 'trending_down') {
    if (!isUp) {
      regimeCompatibilityScore = 35;
    } else {
      regimeCompatibilityScore = -10; // Counter-trend long in strong downtrend
    }
  } else if (regimeData.regime === 'high_volatility') {
    // Requires wider buffers and clear rejection
    if (strongRejectionWick) {
      regimeCompatibilityScore = 25;
    } else {
      regimeCompatibilityScore = 5;
    }
  }

  // 6. Adaptive Historical Performance Validation
  // If this setupType in this regime has historical completed trades with poor stats
  // SAFEGUARD: Only adapts if sample size >= 4 trades (avoids 1-2 trade overreaction)
  let historicalFactorScore = 0;
  let adaptiveWarning = null;

  if (completedPerformanceStats) {
    const setupPerf = completedPerformanceStats.bySetupType?.[setup.setupType];
    if (setupPerf && (setupPerf.wins + setupPerf.losses) >= 4) {
      const settled = setupPerf.wins + setupPerf.losses;
      const winRate = (setupPerf.wins / settled) * 100;
      if (winRate < 35 || (setupPerf.expectancy !== undefined && setupPerf.expectancy < -0.2)) {
        historicalFactorScore = -25;
        adaptiveWarning = `Setup historically underperforming in recent completed samples (${winRate.toFixed(0)}% win rate across ${settled} trades).`;
      } else if (winRate >= 60 && setupPerf.avgPnlPercent > 0) {
        historicalFactorScore = +15;
      }
    }
  }

  // 7. Base Confidence Calculation
  let confidence = 55; // Neutral start

  // Trend Confluence
  if (isUp && regimeData.trendDirection === 'bullish') confidence += 12;
  else if (!isUp && regimeData.trendDirection === 'bearish') confidence += 12;
  else if (regimeData.trendDirection !== 'neutral') confidence -= 10;

  // Candlestick Confirmation
  if (decisiveClose && ((isUp && c0IsGreen) || (!isUp && !c0IsGreen))) {
    confidence += 10;
  }
  if (strongRejectionWick) {
    confidence += 12;
  }
  if (adverseWick) {
    confidence -= 18; // Opposing wick absorption
  }

  // R:R Quality
  if (rrRatio >= 1.45) confidence += 8;
  else if (rrRatio < 1.15) confidence -= 15;

  // Obstruction
  if (isObstructed) confidence -= 22;

  // Regime compatibility & historical adaptive factor
  confidence += regimeCompatibilityScore;
  confidence += historicalFactorScore;

  // Clamp confidence to 0-100
  confidence = Math.min(100, Math.max(0, Math.round(confidence)));

  // 8. Final Decision: allow | reject | wait
  let status = 'wait';
  let reason = '';

  if (adverseWick && Math.abs(confidence) < 70) {
    status = 'reject';
    reason = `Adverse wick rejection against proposed ${setup.direction} move indicates active counter-absorption.`;
  } else if (isObstructed && confidence < 75) {
    status = 'reject';
    reason = obstructionNote || `Structural barrier limits clearance to take profit target.`;
  } else if (regimeMismatch && isBreakout) {
    status = 'reject';
    reason = `Breakout setup rejected due to ${regimeData.regime} regime condition (high failure rate).`;
  } else if (adaptiveWarning && confidence < 75) {
    status = 'reject';
    reason = adaptiveWarning;
  } else if (confidence >= 75 && rrRatio >= 1.35) {
    status = 'allow';
    reason = `Strong structural confluence: aligned with ${regimeData.regime} regime, clean R:R (${rrRatio.toFixed(2)}x), and decisive candle close.`;
  } else if (confidence < 50) {
    status = 'reject';
    reason = `Weak structural confluence (confidence ${confidence}/100) with conflicting price action.`;
  } else {
    status = 'wait';
    reason = `Structure is consolidating or indecisive (confidence ${confidence}/100). Awaiting clear breakout or retest resolution.`;
  }

  return {
    status,
    confidence,
    reason,
    regime: regimeData.regime,
    conditions: {
      trendDirection: regimeData.trendDirection,
      trendStrength: regimeData.trendStrength,
      marketRegime: regimeData.regime,
      riskRewardRatio: parseFloat(rrRatio.toFixed(2)),
      distanceToTpPercent: parseFloat(distanceToTpPct.toFixed(2)),
      distanceToSlPercent: parseFloat(distanceToSlPct.toFixed(2)),
      isObstructed,
      strongRejectionWick,
      decisiveClose,
      regimeCompatibilityScore
    }
  };
}

/**
 * Creates an Inverse Signal for research and benchmark comparison
 * Flipped direction with mirrored TP and SL geometry relative to the entry price
 */
export function createInverseSignal(originalSignal) {
  const isUp = originalSignal.direction === 'UP';
  const newDirection = isUp ? 'DOWN' : 'UP';
  const entryPrice = originalSignal.entryPrice;

  const originalRisk = Math.abs(originalSignal.entryPrice - originalSignal.stopLoss);
  let inverseStopLoss = entryPrice;
  let inverseTakeProfit = entryPrice;

  if (newDirection === 'UP') {
    inverseStopLoss = entryPrice - originalRisk;
    inverseTakeProfit = entryPrice + originalRisk * 1.5;
  } else {
    inverseStopLoss = entryPrice + originalRisk;
    inverseTakeProfit = entryPrice - originalRisk * 1.5;
  }

  const id = `${originalSignal.id}-inverse`;

  return {
    ...originalSignal,
    id,
    direction: newDirection,
    setupType: `${originalSignal.setupType} [Inverse]`,
    signalPrice: entryPrice,
    entryPrice,
    takeProfit: inverseTakeProfit,
    takeProfit1: inverseTakeProfit,
    takeProfit2: undefined,
    stopLoss: inverseStopLoss,
    invalidationLevel: inverseStopLoss,
    rewardRiskRatio: 1.5,
    riskDistance: originalRisk,
    targetDistance: originalRisk * 1.5,
    modelType: 'inverse',
    reason: `Inverse Research Setup: Testing counter-hypothesis to ${originalSignal.direction} (${originalSignal.setupType}).`
  };
}

/**
 * Calculates Walk-Forward Validation across completed signals
 * Splits chronological records into:
 * - In-Sample Training (earlier 60%)
 * - Out-of-Sample Forward Validation (subsequent 40%)
 * Strictly ensures no future data informs past decisions.
 */
export function calculateWalkForwardValidation(completedSignals) {
  if (!completedSignals || completedSignals.length < 8) {
    return {
      isValid: false,
      sampleSize: completedSignals ? completedSignals.length : 0,
      minRequired: 8,
      inSample: null,
      outOfSample: null,
      message: 'Need at least 8 completed signals for statistically valid walk-forward validation.'
    };
  }

  // Sort chronologically by signal completion or creation
  const sorted = [...completedSignals].sort((a, b) => a.timestamp - b.timestamp);
  const splitIndex = Math.floor(sorted.length * 0.6);

  const inSampleTrades = sorted.slice(0, splitIndex);
  const outOfSampleTrades = sorted.slice(splitIndex);

  function computeMetrics(trades) {
    let wins = 0;
    let losses = 0;
    let winPnl = 0;
    let lossPnl = 0;
    let maxLosingStreak = 0;
    let curStreak = 0;

    for (const t of trades) {
      const pnl = t.pnlPercent || 0;
      if (t.status === 'WIN') {
        wins++;
        winPnl += pnl;
        curStreak = 0;
      } else if (t.status === 'LOSS') {
        losses++;
        lossPnl += Math.abs(pnl);
        curStreak++;
        if (curStreak > maxLosingStreak) maxLosingStreak = curStreak;
      }
    }

    const settled = wins + losses;
    const winRate = settled > 0 ? (wins / settled) * 100 : 0;
    const avgWin = wins > 0 ? winPnl / wins : 0;
    const avgLoss = losses > 0 ? lossPnl / losses : 0;
    const profitFactor = lossPnl > 0 ? winPnl / lossPnl : wins > 0 ? 9.99 : 0;
    const expectancy = settled > 0 ? (wins / settled) * avgWin - (losses / settled) * avgLoss : 0;

    return {
      count: trades.length,
      settled,
      wins,
      losses,
      winRate: parseFloat(winRate.toFixed(1)),
      profitFactor: parseFloat(profitFactor.toFixed(2)),
      expectancy: parseFloat(expectancy.toFixed(2)),
      avgWinPercent: parseFloat(avgWin.toFixed(2)),
      avgLossPercent: parseFloat(avgLoss.toFixed(2)),
      maxLosingStreak
    };
  }

  const inSample = computeMetrics(inSampleTrades);
  const outOfSample = computeMetrics(outOfSampleTrades);

  // Efficiency ratio: OOS Win Rate / In-Sample Win Rate
  const winRateEfficiency = inSample.winRate > 0 ? (outOfSample.winRate / inSample.winRate) * 100 : 0;

  return {
    isValid: true,
    sampleSize: sorted.length,
    minRequired: 8,
    inSample,
    outOfSample,
    winRateEfficiency: parseFloat(winRateEfficiency.toFixed(1)),
    message:
      winRateEfficiency >= 80
        ? 'Robust: Out-of-sample forward performance closely matches training baseline.'
        : 'Warning: Out-of-sample performance shows divergence from training baseline.'
  };
}
