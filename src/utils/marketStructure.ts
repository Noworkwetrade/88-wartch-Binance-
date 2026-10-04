/**
 * Market Structure Analysis Utility
 * Calculates genuine Market Structure strictly from actual candlestick OHLC data.
 * Identifies:
 * - Swing Highs & Swing Lows (Fractal Pivots)
 * - Higher Highs (HH), Higher Lows (HL), Lower Highs (LH), Lower Lows (LL)
 * - Break of Structure (BOS)
 * - Change of Character (CHoCH)
 */

import { Candle, SwingType, SwingPoint, StructureBreak, MarketStructureResult } from '../types.ts';

export function calculateMarketStructure(candles: Candle[], lookback = 2): MarketStructureResult {
  if (!candles || candles.length < lookback * 2 + 1) {
    return {
      swingPoints: [],
      structureBreaks: [],
      currentTrend: 'neutral'
    };
  }

  const swingPoints: SwingPoint[] = [];
  const structureBreaks: StructureBreak[] = [];

  let lastSwingHigh: { price: number; index: number; type: 'HH' | 'LH' } | null = null;
  let lastSwingLow: { price: number; index: number; type: 'HL' | 'LL' } | null = null;
  let currentTrend: 'bullish' | 'bearish' | 'neutral' = 'neutral';

  // 1. Identify Swing Highs and Swing Lows
  const len = candles.length;
  for (let i = lookback; i < len - lookback; i++) {
    const current = candles[i];
    let isHigh = true;
    let isLow = true;

    for (let offset = 1; offset <= lookback; offset++) {
      if (candles[i - offset].high >= current.high || candles[i + offset].high > current.high) {
        isHigh = false;
      }
      if (candles[i - offset].low <= current.low || candles[i + offset].low < current.low) {
        isLow = false;
      }
    }

    if (isHigh) {
      const type: SwingType = lastSwingHigh ? (current.high >= lastSwingHigh.price ? 'HH' : 'LH') : 'HH';
      const point: SwingPoint = {
        index: i,
        time: current.openTime,
        price: current.high,
        type,
        isHigh: true
      };
      swingPoints.push(point);
      lastSwingHigh = { price: current.high, index: i, type: type as 'HH' | 'LH' };

      if (lastSwingLow && lastSwingHigh) {
        if (lastSwingHigh.type === 'HH' && lastSwingLow.type === 'HL') {
          currentTrend = 'bullish';
        } else if (lastSwingHigh.type === 'LH' && lastSwingLow.type === 'LL') {
          currentTrend = 'bearish';
        }
      }
    }

    if (isLow) {
      const type: SwingType = lastSwingLow ? (current.low >= lastSwingLow.price ? 'HL' : 'LL') : 'LL';
      const point: SwingPoint = {
        index: i,
        time: current.openTime,
        price: current.low,
        type,
        isHigh: false
      };
      swingPoints.push(point);
      lastSwingLow = { price: current.low, index: i, type: type as 'HL' | 'LL' };

      if (lastSwingLow && lastSwingHigh) {
        if (lastSwingHigh.type === 'HH' && lastSwingLow.type === 'HL') {
          currentTrend = 'bullish';
        } else if (lastSwingHigh.type === 'LH' && lastSwingLow.type === 'LL') {
          currentTrend = 'bearish';
        }
      }
    }
  }

  // 2. Identify confirmed Break of Structure (BOS) and Change of Character (CHoCH)
  // Walk forward through candles evaluating structure breaks against preceding swing points
  let activeHigh: SwingPoint | null = null;
  let activeLow: SwingPoint | null = null;
  let trend: 'bullish' | 'bearish' | 'neutral' = 'neutral';
  let brokenHighIndex = -1;
  let brokenLowIndex = -1;

  for (let i = 0; i < len; i++) {
    const candle = candles[i];

    // Check if new swing points are confirmed at this index
    const newPoint = swingPoints.find((p) => p.index === i);
    if (newPoint) {
      if (newPoint.isHigh) {
        activeHigh = newPoint;
        brokenHighIndex = -1; // reset break tracker for new high
      } else {
        activeLow = newPoint;
        brokenLowIndex = -1; // reset break tracker for new low
      }

      // Update structural trend context
      if (newPoint.type === 'HH') trend = 'bullish';
      else if (newPoint.type === 'LL') trend = 'bearish';
    }

    // Check for upward break of active high
    if (activeHigh && i > activeHigh.index && brokenHighIndex !== activeHigh.index) {
      if (candle.close > activeHigh.price) {
        // Break confirmed!
        const isChoch = trend === 'bearish';
        structureBreaks.push({
          type: isChoch ? 'CHoCH' : 'BOS',
          direction: 'bullish',
          breakIndex: i,
          breakTime: candle.openTime,
          breakPrice: candle.close,
          originIndex: activeHigh.index,
          originPrice: activeHigh.price
        });
        trend = 'bullish';
        brokenHighIndex = activeHigh.index;
      }
    }

    // Check for downward break of active low
    if (activeLow && i > activeLow.index && brokenLowIndex !== activeLow.index) {
      if (candle.close < activeLow.price) {
        // Break confirmed!
        const isChoch = trend === 'bullish';
        structureBreaks.push({
          type: isChoch ? 'CHoCH' : 'BOS',
          direction: 'bearish',
          breakIndex: i,
          breakTime: candle.openTime,
          breakPrice: candle.close,
          originIndex: activeLow.index,
          originPrice: activeLow.price
        });
        trend = 'bearish';
        brokenLowIndex = activeLow.index;
      }
    }
  }

  return {
    swingPoints,
    structureBreaks: structureBreaks.slice(-8), // Keep the most recent, relevant structural breaks
    currentTrend: trend !== 'neutral' ? trend : currentTrend
  };
}

export function getTimeframeDurationMs(tf: string): number {
  switch (tf) {
    case '1m': return 60 * 1000;
    case '5m': return 5 * 60 * 1000;
    case '15m': return 15 * 60 * 1000;
    case '30m': return 30 * 60 * 1000;
    case '1h': return 60 * 60 * 1000;
    case '2h': return 2 * 60 * 60 * 1000;
    case '4h': return 4 * 60 * 60 * 1000;
    case '6h': return 6 * 60 * 60 * 1000;
    case '8h': return 8 * 60 * 60 * 1000;
    case '12h': return 12 * 60 * 60 * 1000;
    case '1d': return 24 * 60 * 60 * 1000;
    case '1w': return 7 * 24 * 60 * 1000;
    case '1M': return 30 * 24 * 60 * 1000;
    default: return 15 * 60 * 1000;
  }
}
