/**
 * NWWT Market Structure Level Engine (Server ESM)
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

/**
 * Calculates Average True Range (ATR) from closed candles
 */
export function calculateATR(candles, period = 14) {
  if (!candles || candles.length < 2) return 0.001;
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
  const slice = trs.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / (slice.length || 1);
}

/**
 * Identifies fractal swing highs and swing lows from closed candles
 */
export function findFractalSwings(candles, lookback = 2) {
  const highs = [];
  const lows = [];
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
export function clusterSupportResistance(candles) {
  const { highs, lows } = findFractalSwings(candles, 2);
  const highPrices = highs.map((h) => h.price);
  const lowPrices = lows.map((l) => l.price);

  function cluster(prices, tolerancePct = 0.004) {
    if (prices.length === 0) return [];
    const sorted = [...prices].sort((a, b) => a - b);
    const clusters = [];
    let curGroup = [sorted[0]];

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
export function calculateMarketStructureLevels(options) {
  const {
    symbol,
    timeframe,
    direction,
    entryPrice,
    candles,
    higherTfCandles,
    fiveMinCandles,
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
  const minBuffer = entryPrice * 0.0002;
  const buffer = Math.max(minBuffer, Math.min(entryPrice * 0.001, atr * 0.08));

  // 2. Identify Fractal Swings and S/R clusters
  const { highs, lows } = findFractalSwings(candles, 2);
  const { supports, resistances } = clusterSupportResistance(candles);

  // 5-minute candles for the 5-minute swing high/low if available, otherwise input candles
  const swingCandles = (fiveMinCandles && fiveMinCandles.length >= 5) ? fiveMinCandles : candles;
  const { highs: swingHighs, lows: swingLows } = findFractalSwings(swingCandles, 2);

  // Higher timeframe context if available
  let htfHighs = [];
  let htfLows = [];
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

    // A. Identify the most relevant recent 5-minute swing low before entry
    // The stop loss must be below the last 5-minute swing low at the lowest point of the previous swing
    const validLowsBelow = swingLows
      .filter((l) => l.price < entryPrice)
      .sort((a, b) => b.time - a.time);

    const recentWindowLows = swingCandles.slice(-20).map((c) => c.low);
    const fallbackLow = Math.min(...recentWindowLows);

    const candidateLow = validLowsBelow.length > 0 ? validLowsBelow[0].price : fallbackLow;
    const structuralLow = candidateLow;
    const chosenSupport = structuralLow;

    // Place stop loss below the last 5-minute swing low with small structure buffer
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
    const validHighsAbove = highs
      .filter((h) => h.price > entryPrice + buffer)
      .sort((a, b) => a.price - b.price);

    const validResistancesAbove = resistances
      .filter((r) => r > entryPrice + buffer)
      .sort((a, b) => a - b);

    const candidateTargets = Array.from(new Set([
      ...validHighsAbove.map((h) => h.price),
      ...validResistancesAbove
    ])).sort((a, b) => a - b);

    let tp1 = 0;
    let tp1Type = 'Recent Swing High';
    if (candidateTargets.length > 0) {
      tp1 = candidateTargets[0];
      tp1Type = 'Structural Resistance / Swing High';
    } else if (recentHighestHigh > entryPrice + buffer) {
      tp1 = recentHighestHigh;
      tp1Type = 'Recent 20-Bar High';
    } else {
      return rejectResult(symbol, timeframe, entryPrice, 'No meaningful structural resistance target identified above entry. Setup rejected.');
    }

    const targetDistance = parseFloat((tp1 - entryPrice).toFixed(6));

    if (targetDistance < atr * minTargetAtrMultiple || (targetDistance / entryPrice) < 0.002) {
      return rejectResult(symbol, timeframe, entryPrice, `Take Profit #1 is too close to entry (${targetDistance.toFixed(2)} | <0.6x ATR) to provide a meaningful opportunity.`);
    }

    const rewardRiskRatio = parseFloat((targetDistance / riskDistance).toFixed(2));

    if (rewardRiskRatio < minRiskRewardRatio) {
      return rejectResult(
        symbol,
        timeframe,
        entryPrice,
        `Resulting structural risk-to-reward ratio (1:${rewardRiskRatio}) is unfavorable (<1:${minRiskRewardRatio}). Structure does not justify trade without moving levels.`
      );
    }

    let tp2 = undefined;
    let tp2Type = undefined;

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

    // A. Identify the highest point of the 5-minute swing high before entry
    // If it's a sell signal the stop loss should be at the top of the highest point of the 5-minute swing high
    const validHighsAbove = swingHighs
      .filter((h) => h.price > entryPrice)
      .sort((a, b) => b.time - a.time);

    const recentWindowHighs = swingCandles.slice(-20).map((c) => c.high);
    const fallbackHigh = Math.max(...recentWindowHighs);

    const candidateHigh = validHighsAbove.length > 0 ? validHighsAbove[0].price : fallbackHigh;
    const structuralHigh = candidateHigh;
    const chosenResistance = structuralHigh;

    // Place stop loss at the top of the highest point of the 5-minute swing high
    const stopLoss = parseFloat((structuralHigh + buffer).toFixed(6));
    const riskDistance = parseFloat((stopLoss - entryPrice).toFixed(6));
    const riskPercent = (riskDistance / entryPrice) * 100;

    if (stopLoss <= entryPrice) {
      return rejectResult(symbol, timeframe, entryPrice, 'No logical structural invalidation swing high above entry.');
    }
    if (riskPercent > maxRiskPercent || riskDistance > atr * 4.5) {
      return rejectResult(symbol, timeframe, entryPrice, `Structural stop loss is unreasonably wide (${riskPercent.toFixed(2)}% | >4.5x ATR). Setup rejected.`);
    }
    if (riskDistance < buffer * 0.8) {
      return rejectResult(symbol, timeframe, entryPrice, 'Stop loss is too close to entry (structural compression noise). Setup rejected.');
    }

    const validLowsBelow = lows
      .filter((l) => l.price < entryPrice - buffer)
      .sort((a, b) => b.price - a.price);

    const validSupportsBelow = supports
      .filter((s) => s < entryPrice - buffer)
      .sort((a, b) => b - a);

    const candidateTargets = Array.from(new Set([
      ...validLowsBelow.map((l) => l.price),
      ...validSupportsBelow
    ])).sort((a, b) => b - a);

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

    if (targetDistance < atr * minTargetAtrMultiple || (targetDistance / entryPrice) < 0.002) {
      return rejectResult(symbol, timeframe, entryPrice, `Take Profit #1 is too close to entry (${targetDistance.toFixed(2)} | <0.6x ATR) to provide a meaningful opportunity.`);
    }

    const rewardRiskRatio = parseFloat((targetDistance / riskDistance).toFixed(2));

    if (rewardRiskRatio < minRiskRewardRatio) {
      return rejectResult(
        symbol,
        timeframe,
        entryPrice,
        `Resulting structural risk-to-reward ratio (1:${rewardRiskRatio}) is unfavorable (<1:${minRiskRewardRatio}). Structure does not justify trade without moving levels.`
      );
    }

    let tp2 = undefined;
    let tp2Type = undefined;

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

function rejectResult(symbol, timeframe, entryPrice, rejectReason) {
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
