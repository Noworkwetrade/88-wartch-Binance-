/**
 * NWWT Market Structure Quality Layer
 *
 * Pre-Strategy Quality Gate:
 * Evaluates whether an asset currently possesses readable, tradable market structure
 * BEFORE any strategy rules, entry, stop loss, take profit, or R:R calculations run.
 *
 * It does NOT predict direction.
 * It does NOT generate buy or sell signals.
 * It answers one question: "Is this chart structurally readable enough to trade?"
 *
 * Quality Grades:
 * - 'excellent'   (>= 80): Highly readable swings, clean trend or well-defined boundaries
 * - 'good'        (>= 65): Clear swings, good range, recognizable S/R
 * - 'acceptable'  (>= 50): Tradable structure, passes minimum quality thresholds
 * - 'poor'        (>= 30): Choppy, overlapping, micro-swings, or low relative movement [REJECTED]
 * - 'untradable'  (< 30): Dead, flatlining, compressed, or permanently excluded [REJECTED]
 */

import { Candle } from '../types.ts';
import { calculateATR, findFractalSwings } from './marketStructureLevels.ts';

export type MarketStructureQualityGrade = 'excellent' | 'good' | 'acceptable' | 'poor' | 'untradable';

export interface MarketStructureQualityMetrics {
  candleActivity: number; // 0-100 (absence of flat/dead candles)
  relativePriceMovement: number; // 0-100 (ATR% of price & window span)
  swingClarity: number; // 0-100 (clear swing highs/lows with separation)
  srClarity: number; // 0-100 (recognizable support and resistance levels)
  volumeActivity?: number; // 0-100 (supporting activity metric)
  averageCandleRangePercent: number; // Average (high - low) / close * 100
  totalWindowRangePercent: number; // (windowMax - windowMin) / close * 100
  swingCount: number;
  swingSeparationPercent: number;
  flatCandleRatio: number; // Ratio of zero-range or flat candles
  overlapRatio: number; // Ratio of body overlap between consecutive candles
}

export interface MarketStructureQualityResult {
  symbol: string;
  timeframe: string;
  isTradable: boolean; // True only for 'excellent' | 'good' | 'acceptable'
  qualityGrade: MarketStructureQualityGrade;
  qualityScore: number; // 0 to 100
  metrics: MarketStructureQualityMetrics;
  rejectionReason?: string;
  isPermanentlyExcluded?: boolean;
}

/**
 * Permanently excluded stablecoin or synthetic assets.
 * These must never enter opportunity scanning, strategy analysis, or live performance.
 */
export const PERMANENT_EXCLUDED_SYMBOLS = new Set<string>([
  'USDCUSDT',
  'USD1USDT',
  'USDC',
  'USD1'
]);

/**
 * Normalizes trading symbol inputs to standard Binance Spot format.
 * Handles bare symbols (e.g. BTC -> BTCUSDT), slashes (BTC/USDT -> BTCUSDT),
 * hyphens (BTC-USDC -> BTCUSDC), and respects USDT, USDC, and USD quote pairs.
 */
export function normalizeSymbol(rawSymbol: string): string {
  if (!rawSymbol) return 'BTCUSDT';
  let s = String(rawSymbol).trim().toUpperCase();
  s = s.replace(/[\/\-_\s]/g, '');
  if (!s) return 'BTCUSDT';

  if (s.endsWith('USDT') || s.endsWith('USDC') || s.endsWith('USD')) {
    return s;
  }

  return `${s}USDT`;
}

/**
 * Checks whether a symbol is permanently excluded from trading analysis
 */
export function isPermanentlyExcludedSymbol(symbol: string): boolean {
  if (!symbol) return false;
  const upper = String(symbol).toUpperCase().trim().replace(/[\/\-_\s]/g, '');
  return PERMANENT_EXCLUDED_SYMBOLS.has(upper) || PERMANENT_EXCLUDED_SYMBOLS.has(upper + 'USDT');
}

/**
 * Creates the standardized quality rejection object for permanently excluded assets
 */
export function createPermanentlyExcludedResult(symbol: string, timeframe: string): MarketStructureQualityResult {
  return {
    symbol,
    timeframe,
    isTradable: false,
    qualityGrade: 'untradable',
    qualityScore: 0,
    isPermanentlyExcluded: true,
    rejectionReason: `Permanently excluded stablecoin asset (${symbol}). Never evaluated by opportunity scanner.`,
    metrics: {
      candleActivity: 0,
      relativePriceMovement: 0,
      swingClarity: 0,
      srClarity: 0,
      averageCandleRangePercent: 0,
      totalWindowRangePercent: 0,
      swingCount: 0,
      swingSeparationPercent: 0,
      flatCandleRatio: 1,
      overlapRatio: 1
    }
  };
}

/**
 * Evaluates the Market Structure Quality of a candle series.
 * Runs BEFORE any strategy evaluation.
 */
export function evaluateMarketStructureQuality(
  symbol: string,
  timeframe: string,
  candles: Candle[],
  currentPrice?: number
): MarketStructureQualityResult {
  const cleanSymbol = normalizeSymbol(symbol || 'UNKNOWN');

  // 1. PERMANENT EXCLUSION CHECK
  if (isPermanentlyExcludedSymbol(cleanSymbol)) {
    return createPermanentlyExcludedResult(cleanSymbol, timeframe);
  }

  // 2. INSUFFICIENT DATA CHECK
  if (!candles || candles.length < 15) {
    return {
      symbol: cleanSymbol,
      timeframe,
      isTradable: false,
      qualityGrade: 'untradable',
      qualityScore: 10,
      rejectionReason: 'Insufficient candle history to determine market structure quality (<15 closed candles).',
      metrics: {
        candleActivity: 0,
        relativePriceMovement: 0,
        swingClarity: 0,
        srClarity: 0,
        averageCandleRangePercent: 0,
        totalWindowRangePercent: 0,
        swingCount: 0,
        swingSeparationPercent: 0,
        flatCandleRatio: 1,
        overlapRatio: 1
      }
    };
  }

  const window = candles.slice(-35); // Focus on recent 35 closed candles
  const len = window.length;
  const lastCandle = window[len - 1];
  const refPrice = currentPrice && currentPrice > 0 ? currentPrice : lastCandle.close;

  if (refPrice <= 0) {
    return {
      symbol: cleanSymbol,
      timeframe,
      isTradable: false,
      qualityGrade: 'untradable',
      qualityScore: 0,
      rejectionReason: 'Invalid market price level (<=0).',
      metrics: {
        candleActivity: 0,
        relativePriceMovement: 0,
        swingClarity: 0,
        srClarity: 0,
        averageCandleRangePercent: 0,
        totalWindowRangePercent: 0,
        swingCount: 0,
        swingSeparationPercent: 0,
        flatCandleRatio: 1,
        overlapRatio: 1
      }
    };
  }

  // 3. CANDLE ACTIVITY & DEAD CHART DETECTION
  // Count zero-range or flatlining candles where high == low or price doesn't move
  let flatCandlesCount = 0;
  let consecutiveUnchanged = 0;
  let maxConsecutiveUnchanged = 0;
  let totalRangePercentSum = 0;

  for (let i = 0; i < len; i++) {
    const c = window[i];
    const range = c.high - c.low;
    const body = Math.abs(c.close - c.open);
    const rangePct = (range / refPrice) * 100;
    totalRangePercentSum += rangePct;

    const isFlat = range <= 0.00000001 || (range / refPrice) < 0.00015;
    if (isFlat) flatCandlesCount++;

    if (i > 0 && Math.abs(c.close - window[i - 1].close) / refPrice < 0.00005) {
      consecutiveUnchanged++;
      if (consecutiveUnchanged > maxConsecutiveUnchanged) {
        maxConsecutiveUnchanged = consecutiveUnchanged;
      }
    } else {
      consecutiveUnchanged = 0;
    }
  }

  const flatCandleRatio = flatCandlesCount / len;
  const averageCandleRangePercent = totalRangePercentSum / len;

  // Window extreme prices
  const windowHighs = window.map((c) => c.high);
  const windowLows = window.map((c) => c.low);
  const windowMax = Math.max(...windowHighs);
  const windowMin = Math.min(...windowLows);
  const totalWindowRange = windowMax - windowMin;
  const totalWindowRangePercent = (totalWindowRange / refPrice) * 100;

  // ATR
  const atr = calculateATR(window, 14);
  const atrPercent = (atr / refPrice) * 100;

  // DEAD CHART REJECTION RULES:
  // A. Over 25% of candles are completely flat/zero range
  if (flatCandleRatio > 0.25) {
    return {
      symbol: cleanSymbol,
      timeframe,
      isTradable: false,
      qualityGrade: 'untradable',
      qualityScore: Math.round(15 * (1 - flatCandleRatio)),
      rejectionReason: `Dead chart with persistent flatlining candles (${(flatCandleRatio * 100).toFixed(0)}% zero-range bars).`,
      metrics: {
        candleActivity: 10,
        relativePriceMovement: 10,
        swingClarity: 5,
        srClarity: 5,
        averageCandleRangePercent,
        totalWindowRangePercent,
        swingCount: 0,
        swingSeparationPercent: 0,
        flatCandleRatio,
        overlapRatio: 1
      }
    };
  }

  // B. Long sequence of unchanged prices (>= 5 consecutive bars without price change)
  if (maxConsecutiveUnchanged >= 5) {
    return {
      symbol: cleanSymbol,
      timeframe,
      isTradable: false,
      qualityGrade: 'untradable',
      qualityScore: 20,
      rejectionReason: `Inactive chart showing ${maxConsecutiveUnchanged} consecutive unchanged candle periods.`,
      metrics: {
        candleActivity: 15,
        relativePriceMovement: 15,
        swingClarity: 10,
        srClarity: 10,
        averageCandleRangePercent,
        totalWindowRangePercent,
        swingCount: 0,
        swingSeparationPercent: 0,
        flatCandleRatio,
        overlapRatio: 0.9
      }
    };
  }

  // C. Extremely small candles / microscopic price movement (< 0.035% average range)
  if (averageCandleRangePercent < 0.035 || atrPercent < 0.035) {
    return {
      symbol: cleanSymbol,
      timeframe,
      isTradable: false,
      qualityGrade: 'untradable',
      qualityScore: 22,
      rejectionReason: `Extremely small candle ranges with insufficient price movement (avg range ${averageCandleRangePercent.toFixed(3)}% | ATR ${atrPercent.toFixed(3)}%).`,
      metrics: {
        candleActivity: 20,
        relativePriceMovement: 15,
        swingClarity: 15,
        srClarity: 10,
        averageCandleRangePercent,
        totalWindowRangePercent,
        swingCount: 0,
        swingSeparationPercent: 0,
        flatCandleRatio,
        overlapRatio: 0.85
      }
    };
  }

  // D. Price trapped inside an extremely narrow range (< 0.20% total window span)
  if (totalWindowRangePercent < 0.20) {
    return {
      symbol: cleanSymbol,
      timeframe,
      isTradable: false,
      qualityGrade: 'untradable',
      qualityScore: 25,
      rejectionReason: `Price trapped inside an extremely narrow range (${totalWindowRangePercent.toFixed(2)}% total span across ${len} bars). Inactive market structure.`,
      metrics: {
        candleActivity: 25,
        relativePriceMovement: 18,
        swingClarity: 15,
        srClarity: 15,
        averageCandleRangePercent,
        totalWindowRangePercent,
        swingCount: 0,
        swingSeparationPercent: totalWindowRangePercent,
        flatCandleRatio,
        overlapRatio: 0.85
      }
    };
  }

  // 4. SWING CLARITY & SEPARATION
  const { highs: swingHighs, lows: swingLows } = findFractalSwings(window, 2);
  const totalSwings = swingHighs.length + swingLows.length;

  let swingSeparationPercent = 0;
  if (swingHighs.length > 0 && swingLows.length > 0) {
    const highestSwing = Math.max(...swingHighs.map((h) => h.price));
    const lowestSwing = Math.min(...swingLows.map((l) => l.price));
    swingSeparationPercent = ((highestSwing - lowestSwing) / refPrice) * 100;
  }

  // E. No meaningful swing points or no separation between swings (< 0.22%)
  if (totalSwings === 0 || swingSeparationPercent < 0.22) {
    return {
      symbol: cleanSymbol,
      timeframe,
      isTradable: false,
      qualityGrade: 'poor',
      qualityScore: 32,
      rejectionReason: `Repeated tiny micro-swings without meaningful separation between swing points (${swingSeparationPercent.toFixed(2)}%). Unreadable market structure.`,
      metrics: {
        candleActivity: 40,
        relativePriceMovement: 35,
        swingClarity: 20,
        srClarity: 20,
        averageCandleRangePercent,
        totalWindowRangePercent,
        swingCount: totalSwings,
        swingSeparationPercent,
        flatCandleRatio,
        overlapRatio: 0.8
      }
    };
  }

  // 5. CHOPPINESS & CANDLE OVERLAP RATIO
  let overlapCount = 0;
  for (let i = 1; i < len; i++) {
    const cur = window[i];
    const prev = window[i - 1];
    const overlapMin = Math.max(cur.low, prev.low);
    const overlapMax = Math.min(cur.high, prev.high);
    const overlapRange = Math.max(0, overlapMax - overlapMin);
    const combinedSpan = Math.max(cur.high, prev.high) - Math.min(cur.low, prev.low);

    if (combinedSpan > 0 && overlapRange / combinedSpan > 0.65) {
      overlapCount++;
    }
  }
  const overlapRatio = overlapCount / (len - 1);

  // F. Persistent heavy chop / back-and-forth noise (> 82% overlap with tight swings)
  if (overlapRatio > 0.82 && swingSeparationPercent < 0.45) {
    return {
      symbol: cleanSymbol,
      timeframe,
      isTradable: false,
      qualityGrade: 'poor',
      qualityScore: 38,
      rejectionReason: `Extremely choppy price action with ${(overlapRatio * 100).toFixed(0)}% candle overlap and compressed micro-swings. Structure visually noisy.`,
      metrics: {
        candleActivity: 45,
        relativePriceMovement: 40,
        swingClarity: 25,
        srClarity: 25,
        averageCandleRangePercent,
        totalWindowRangePercent,
        swingCount: totalSwings,
        swingSeparationPercent,
        flatCandleRatio,
        overlapRatio
      }
    };
  }

  // 6. COMPUTE GRANULAR SCORES (0 to 100)
  // A. Candle Activity Score: rewards non-flatlining, healthy bars
  const candleActivity = Math.min(
    100,
    Math.max(0, Math.round((1 - flatCandleRatio * 2) * 60 + Math.min(40, averageCandleRangePercent * 80)))
  );

  // B. Relative Price Movement Score: rewards adequate ATR% and window range
  const relativePriceMovement = Math.min(
    100,
    Math.max(0, Math.round(Math.min(50, atrPercent * 70) + Math.min(50, totalWindowRangePercent * 25)))
  );

  // C. Swing Clarity Score: rewards distinct swings and separation
  const swingCountFactor = Math.min(40, totalSwings * 8);
  const separationFactor = Math.min(60, swingSeparationPercent * 35);
  const swingClarity = Math.min(100, Math.max(0, Math.round(swingCountFactor + separationFactor)));

  // D. S/R Clarity Score: rewards low overlap, recognizable boundaries
  const overlapPenalty = Math.max(0, (overlapRatio - 0.5) * 60);
  const srClarity = Math.min(100, Math.max(0, Math.round(100 - overlapPenalty)));

  // Composite Quality Score (weighted average)
  const compositeScore = Math.round(
    candleActivity * 0.25 +
    relativePriceMovement * 0.30 +
    swingClarity * 0.30 +
    srClarity * 0.15
  );

  // Determine Quality Grade
  let qualityGrade: MarketStructureQualityGrade = 'untradable';
  if (compositeScore >= 80) {
    qualityGrade = 'excellent';
  } else if (compositeScore >= 65) {
    qualityGrade = 'good';
  } else if (compositeScore >= 50) {
    qualityGrade = 'acceptable';
  } else if (compositeScore >= 30) {
    qualityGrade = 'poor';
  } else {
    qualityGrade = 'untradable';
  }

  const isTradable = qualityGrade === 'excellent' || qualityGrade === 'good' || qualityGrade === 'acceptable';

  let rejectionReason: string | undefined = undefined;
  if (!isTradable) {
    if (compositeScore < 30) {
      rejectionReason = 'Untradable market structure: insufficient candle activity and compressed volatility.';
    } else {
      rejectionReason = 'Poor market structure: high candle overlap and weak swing separation below minimum threshold.';
    }
  }

  // Volume Activity Metric (supporting evidence, not direction filter)
  let volumeActivity: number | undefined = undefined;
  const validVolumes = window.map((c) => c.volume || 0).filter((v) => v > 0);
  if (validVolumes.length > 0) {
    const avgVol = validVolumes.reduce((a, b) => a + b, 0) / validVolumes.length;
    const zeroVolCount = window.filter((c) => !c.volume || c.volume <= 0).length;
    const zeroVolRatio = zeroVolCount / len;
    volumeActivity = Math.min(
      100,
      Math.max(0, Math.round((1 - zeroVolRatio) * 80 + (avgVol > 0 ? 20 : 0)))
    );
  }

  return {
    symbol: cleanSymbol,
    timeframe,
    isTradable,
    qualityGrade,
    qualityScore: compositeScore,
    rejectionReason,
    isPermanentlyExcluded: false,
    metrics: {
      candleActivity,
      relativePriceMovement,
      swingClarity,
      srClarity,
      volumeActivity,
      averageCandleRangePercent: parseFloat(averageCandleRangePercent.toFixed(3)),
      totalWindowRangePercent: parseFloat(totalWindowRangePercent.toFixed(2)),
      swingCount: totalSwings,
      swingSeparationPercent: parseFloat(swingSeparationPercent.toFixed(2)),
      flatCandleRatio: parseFloat(flatCandleRatio.toFixed(3)),
      overlapRatio: parseFloat(overlapRatio.toFixed(3))
    }
  };
}

export interface MultiTimeframeQualityResult {
  symbol: string;
  isTradable: boolean;
  overallGrade: MarketStructureQualityGrade;
  overallScore: number;
  timeframeResults: Record<string, MarketStructureQualityResult>;
  poorTimeframeCount: number;
  totalTimeframesEvaluated: number;
  rejectionReason?: string;
}

/**
 * Multi-Timeframe Quality Evaluation:
 * Evaluates an asset across multiple timeframes (e.g. 1m, 3m, 5m, 10m).
 * If an asset remains structurally poor across multiple timeframes,
 * it is excluded as broadly inactive or structurally unreadable.
 */
export function evaluateMultiTimeframeQuality(
  symbol: string,
  candlesByTimeframe: Record<string, Candle[]>,
  currentPrice?: number
): MultiTimeframeQualityResult {
  const cleanSymbol = (symbol || 'UNKNOWN').toUpperCase().trim();
  const tfKeys = Object.keys(candlesByTimeframe);

  if (isPermanentlyExcludedSymbol(cleanSymbol)) {
    const defaultRes = createPermanentlyExcludedResult(cleanSymbol, 'multi');
    return {
      symbol: cleanSymbol,
      isTradable: false,
      overallGrade: 'untradable',
      overallScore: 0,
      timeframeResults: { multi: defaultRes },
      poorTimeframeCount: tfKeys.length || 1,
      totalTimeframesEvaluated: tfKeys.length || 1,
      rejectionReason: defaultRes.rejectionReason
    };
  }

  const tfResults: Record<string, MarketStructureQualityResult> = {};
  let poorCount = 0;
  let scoreSum = 0;

  for (const tf of tfKeys) {
    const candles = candlesByTimeframe[tf] || [];
    const res = evaluateMarketStructureQuality(cleanSymbol, tf, candles, currentPrice);
    tfResults[tf] = res;
    if (!res.isTradable) {
      poorCount++;
    }
    scoreSum += res.qualityScore;
  }

  const total = tfKeys.length || 1;
  const avgScore = Math.round(scoreSum / total);
  // If 75% or more of tested timeframes are poor/untradable, asset is excluded
  const isBroadlyPoor = poorCount >= Math.ceil(total * 0.75);

  let overallGrade: MarketStructureQualityGrade = 'acceptable';
  if (isBroadlyPoor || avgScore < 45) {
    overallGrade = avgScore < 30 ? 'untradable' : 'poor';
  } else if (avgScore >= 80) {
    overallGrade = 'excellent';
  } else if (avgScore >= 65) {
    overallGrade = 'good';
  }

  const isTradable = !isBroadlyPoor && (overallGrade === 'excellent' || overallGrade === 'good' || overallGrade === 'acceptable');

  let rejectionReason: string | undefined = undefined;
  if (!isTradable) {
    rejectionReason = `Asset remains structurally poor across ${poorCount}/${total} timeframes (score: ${avgScore}/100). Inactive or compressed structure.`;
  }

  return {
    symbol: cleanSymbol,
    isTradable,
    overallGrade,
    overallScore: avgScore,
    timeframeResults: tfResults,
    poorTimeframeCount: poorCount,
    totalTimeframesEvaluated: total,
    rejectionReason
  };
}
