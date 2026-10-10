/**
 * Quantitative Research Engine: Crypto Squeeze Breakout Strategy Evaluation
 * 
 * Research Purpose:
 * Evaluates whether a Squeeze Breakout setup possesses a statistically measurable edge
 * on real Binance Spot historical klines across multiple assets and timeframes,
 * compared against the existing NWWT 88 Bot baseline strategies.
 * 
 * Strict Confidentiality:
 * This script runs strictly in the background as a research harness.
 * Zero UI modifications, zero public disclosures, zero production code alterations.
 */

import { fetchKlines } from '../server/binanceRest.js';
import { calculateMarketStructureLevels, calculateATR } from '../server/marketStructureLevels.js';
import { detectMarketRegime } from '../server/structureIntelligence.js';

interface TradeResult {
  asset: string;
  timeframe: string;
  strategy: 'squeeze_breakout' | 'baseline';
  direction: 'UP' | 'DOWN';
  entryTime: number;
  entryPrice: number;
  stopLoss: number;
  takeProfit1: number;
  takeProfit2: number;
  exitPrice: number;
  exitTime: number;
  outcome: 'WIN' | 'LOSS' | 'EXPIRED';
  riskR: number;
  rewardR: number;
  netPnlPct: number;
  grossPnlPct: number;
  rMultiple: number;
  holdingCandles: number;
  sampleType: 'in_sample' | 'out_of_sample';
}

interface SqueezeMetrics {
  isSqueeze: boolean;
  squeezeLength: number;
  squeezeHigh: number;
  squeezeLow: number;
  compressionRatio: number;
}

// Helper: Calculate Standard Deviation
function calcStdDev(values: number[], mean: number): number {
  if (values.length < 2) return 0;
  const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length;
  return Math.sqrt(variance);
}

// Detect Squeeze on historical candle window
function detectSqueeze(candles: any[], index: number): SqueezeMetrics {
  const period = 20;
  if (index < period) {
    return { isSqueeze: false, squeezeLength: 0, squeezeHigh: 0, squeezeLow: 0, compressionRatio: 1 };
  }

  const window = candles.slice(index - period + 1, index + 1);
  const closes = window.map(c => c.close);
  const mean = closes.reduce((a, b) => a + b, 0) / period;
  const stdDev = calcStdDev(closes, mean);

  // Bollinger Bands (20, 2.0)
  const bbUpper = mean + 2.0 * stdDev;
  const bbLower = mean - 2.0 * stdDev;
  const bbWidth = bbUpper - bbLower;

  // Keltner Channels (20, 1.5 * ATR)
  const atr = calculateATR(window, 14);
  const kcUpper = mean + 1.5 * atr;
  const kcLower = mean - 1.5 * atr;
  const kcWidth = kcUpper - kcLower;

  // Squeeze condition: Bollinger Bands contracted inside Keltner Channels
  const isBBSqueeze = bbUpper <= kcUpper && bbLower >= kcLower;
  
  // ATR compression: short ATR(7) vs baseline ATR(20)
  const shortAtr = calculateATR(window.slice(-7), 7);
  const compressionRatio = atr > 0 ? shortAtr / atr : 1.0;
  const isAtrCompression = compressionRatio < 0.75;

  const isSqueeze = isBBSqueeze || isAtrCompression;

  const squeezeHigh = Math.max(...window.slice(-10).map(c => c.high));
  const squeezeLow = Math.min(...window.slice(-10).map(c => c.low));

  return {
    isSqueeze,
    squeezeLength: isSqueeze ? 5 : 0,
    squeezeHigh,
    squeezeLow,
    compressionRatio
  };
}

// Backtest simulation engine
async function evaluateAssetTimeframe(
  symbol: string,
  timeframe: string,
  limit: number = 500
): Promise<{ squeezeTrades: TradeResult[]; baselineTrades: TradeResult[] }> {
  const rawCandles = await fetchKlines(symbol, timeframe, limit);
  if (!rawCandles || rawCandles.length < 80) {
    return { squeezeTrades: [], baselineTrades: [] };
  }

  // Filter only closed valid candles
  const candles = rawCandles.filter(c => c && !isNaN(c.close) && c.close > 0 && c.isClosed !== false);
  const totalCandles = candles.length;
  const splitIdx = Math.floor(totalCandles * 0.60); // 60% In-Sample, 40% Out-of-Sample

  const squeezeTrades: TradeResult[] = [];
  const baselineTrades: TradeResult[] = [];

  // Realistic Execution Costs
  const TAKER_FEE = 0.0010; // 0.10% each side
  const SLIPPAGE = 0.0005;   // 0.05% slippage on breakout entry

  let squeezeState = { inSqueeze: false, squeezeBars: 0, high: 0, low: 0 };

  for (let i = 40; i < totalCandles - 15; i++) {
    const historicalSlice = candles.slice(0, i + 1);
    const c0 = candles[i];     // Completed breakout trigger candle
    const c1 = candles[i - 1]; // Previous candle
    const sampleType: 'in_sample' | 'out_of_sample' = i < splitIdx ? 'in_sample' : 'out_of_sample';

    const regime = detectMarketRegime(historicalSlice);
    const sq = detectSqueeze(historicalSlice, i - 1); // Evaluate squeeze prior to breakout candle

    if (sq.isSqueeze) {
      squeezeState.inSqueeze = true;
      squeezeState.squeezeBars++;
      squeezeState.high = Math.max(squeezeState.high || sq.squeezeHigh, sq.squeezeHigh);
      squeezeState.low = squeezeState.low === 0 ? sq.squeezeLow : Math.min(squeezeState.low, sq.squeezeLow);
    }

    // -------------------------------------------------------------
    // SQUEEZE BREAKOUT SETUP
    // -------------------------------------------------------------
    if (squeezeState.inSqueeze && squeezeState.squeezeBars >= 3) {
      const c0Range = c0.high - c0.low || 0.0001;
      const c0Body = Math.abs(c0.close - c0.open);
      const isDecisive = (c0Body / c0Range) > 0.48;

      let sqDirection: 'UP' | 'DOWN' | null = null;
      if (c0.close > squeezeState.high && c0.close > c0.open && isDecisive) {
        sqDirection = 'UP';
      } else if (c0.close < squeezeState.low && c0.close < c0.open && isDecisive) {
        sqDirection = 'DOWN';
      }

      if (sqDirection) {
        // Calculate structural levels
        const levels = calculateMarketStructureLevels({
          symbol,
          timeframe,
          direction: sqDirection,
          entryPrice: c0.close,
          candles: historicalSlice,
          setupType: 'Squeeze Breakout'
        });

        if (levels && levels.isValid && levels.stopLoss && levels.takeProfit1) {
          // Model realistic entry: close + slippage
          const entryPrice = sqDirection === 'UP' 
            ? c0.close * (1 + SLIPPAGE) 
            : c0.close * (1 - SLIPPAGE);
          
          const sl = levels.stopLoss;
          const tp1 = levels.takeProfit1;
          const tp2 = levels.takeProfit2 || (sqDirection === 'UP' ? entryPrice + (entryPrice - sl) * 2 : entryPrice - (sl - entryPrice) * 2);

          // Simulate trade forward until hit or expiry
          const sim = simulateTrade(candles, i + 1, sqDirection, entryPrice, sl, tp1, tp2, 20);
          
          // Apply fees
          const grossPnl = sim.grossPnl;
          const netPnl = grossPnl - (TAKER_FEE * 2) - SLIPPAGE;
          const riskDistance = Math.abs(entryPrice - sl);
          const rMult = riskDistance > 0 ? (netPnl / ((riskDistance / entryPrice) * 100)) : 0;

          squeezeTrades.push({
            asset: symbol,
            timeframe,
            strategy: 'squeeze_breakout',
            direction: sqDirection,
            entryTime: c0.closeTime,
            entryPrice,
            stopLoss: sl,
            takeProfit1: tp1,
            takeProfit2: tp2,
            exitPrice: sim.exitPrice,
            exitTime: sim.exitTime,
            outcome: sim.outcome,
            riskR: 1.0,
            rewardR: levels.rewardRiskRatio || 1.5,
            netPnlPct: netPnl,
            grossPnlPct: grossPnl,
            rMultiple: rMult,
            holdingCandles: sim.candlesHeld,
            sampleType
          });

          // Reset squeeze state after firing
          squeezeState = { inSqueeze: false, squeezeBars: 0, high: 0, low: 0 };
          i += sim.candlesHeld; // Advance past trade duration to prevent overlapping duplicates
          continue;
        }
      }
    }

    // -------------------------------------------------------------
    // BASELINE NWWT 88 STRATEGY (BOS & Break/Retest)
    // -------------------------------------------------------------
    const swingWindow = historicalSlice.slice(-20);
    const prevHigh = Math.max(...swingWindow.slice(0, -2).map(c => c.high));
    const prevLow = Math.min(...swingWindow.slice(0, -2).map(c => c.low));

    let baseDir: 'UP' | 'DOWN' | null = null;
    if (c0.close > prevHigh && c1.close <= prevHigh && c0.close > c0.open) {
      baseDir = 'UP';
    } else if (c0.close < prevLow && c1.close >= prevLow && c0.close < c0.open) {
      baseDir = 'DOWN';
    }

    if (baseDir) {
      const levels = calculateMarketStructureLevels({
        symbol,
        timeframe,
        direction: baseDir,
        entryPrice: c0.close,
        candles: historicalSlice,
        setupType: 'Strong Confirmed Break (BOS)'
      });

      if (levels && levels.isValid && levels.stopLoss && levels.takeProfit1) {
        const entryPrice = baseDir === 'UP' 
          ? c0.close * (1 + SLIPPAGE) 
          : c0.close * (1 - SLIPPAGE);

        const sl = levels.stopLoss;
        const tp1 = levels.takeProfit1;
        const tp2 = levels.takeProfit2 || (baseDir === 'UP' ? entryPrice + (entryPrice - sl) * 2 : entryPrice - (sl - entryPrice) * 2);

        const sim = simulateTrade(candles, i + 1, baseDir, entryPrice, sl, tp1, tp2, 20);
        const grossPnl = sim.grossPnl;
        const netPnl = grossPnl - (TAKER_FEE * 2) - SLIPPAGE;
        const riskDistance = Math.abs(entryPrice - sl);
        const rMult = riskDistance > 0 ? (netPnl / ((riskDistance / entryPrice) * 100)) : 0;

        baselineTrades.push({
          asset: symbol,
          timeframe,
          strategy: 'baseline',
          direction: baseDir,
          entryTime: c0.closeTime,
          entryPrice,
          stopLoss: sl,
          takeProfit1: tp1,
          takeProfit2: tp2,
          exitPrice: sim.exitPrice,
          exitTime: sim.exitTime,
          outcome: sim.outcome,
          riskR: 1.0,
          rewardR: levels.rewardRiskRatio || 1.5,
          netPnlPct: netPnl,
          grossPnlPct: grossPnl,
          rMultiple: rMult,
          holdingCandles: sim.candlesHeld,
          sampleType
        });

        i += sim.candlesHeld;
      }
    }
  }

  return { squeezeTrades, baselineTrades };
}

// Forward simulation of candle prices
function simulateTrade(
  candles: any[],
  startIndex: number,
  direction: 'UP' | 'DOWN',
  entryPrice: number,
  sl: number,
  tp1: number,
  tp2: number,
  maxHold: number = 20
): { outcome: 'WIN' | 'LOSS' | 'EXPIRED'; exitPrice: number; exitTime: number; grossPnl: number; candlesHeld: number } {
  let candlesHeld = 0;
  for (let k = startIndex; k < Math.min(startIndex + maxHold, candles.length); k++) {
    candlesHeld++;
    const bar = candles[k];

    if (direction === 'UP') {
      const slHit = bar.low <= sl;
      const tp1Hit = bar.high >= tp1;

      if (slHit && tp1Hit) {
        // Conservative assumption: loss if both hit in the same candle
        const grossPnl = ((sl - entryPrice) / entryPrice) * 100;
        return { outcome: 'LOSS', exitPrice: sl, exitTime: bar.closeTime, grossPnl, candlesHeld };
      }
      if (tp1Hit) {
        const grossPnl = ((tp1 - entryPrice) / entryPrice) * 100;
        return { outcome: 'WIN', exitPrice: tp1, exitTime: bar.closeTime, grossPnl, candlesHeld };
      }
      if (slHit) {
        const grossPnl = ((sl - entryPrice) / entryPrice) * 100;
        return { outcome: 'LOSS', exitPrice: sl, exitTime: bar.closeTime, grossPnl, candlesHeld };
      }
    } else {
      const slHit = bar.high >= sl;
      const tp1Hit = bar.low <= tp1;

      if (slHit && tp1Hit) {
        const grossPnl = -((sl - entryPrice) / entryPrice) * 100;
        return { outcome: 'LOSS', exitPrice: sl, exitTime: bar.closeTime, grossPnl, candlesHeld };
      }
      if (tp1Hit) {
        const grossPnl = ((entryPrice - tp1) / entryPrice) * 100;
        return { outcome: 'WIN', exitPrice: tp1, exitTime: bar.closeTime, grossPnl, candlesHeld };
      }
      if (slHit) {
        const grossPnl = -((sl - entryPrice) / entryPrice) * 100;
        return { outcome: 'LOSS', exitPrice: sl, exitTime: bar.closeTime, grossPnl, candlesHeld };
      }
    }
  }

  // Timeout expiry
  const lastBar = candles[Math.min(startIndex + maxHold - 1, candles.length - 1)];
  const grossPnl = direction === 'UP'
    ? ((lastBar.close - entryPrice) / entryPrice) * 100
    : ((entryPrice - lastBar.close) / entryPrice) * 100;
  return { outcome: 'EXPIRED', exitPrice: lastBar.close, exitTime: lastBar.closeTime, grossPnl, candlesHeld };
}

// Compute quantitative summary statistics
function computeStats(trades: TradeResult[]) {
  const total = trades.length;
  if (total === 0) {
    return {
      total: 0,
      wins: 0,
      losses: 0,
      expired: 0,
      winRate: 0,
      profitFactor: 0,
      expectancyR: 0,
      avgWinPct: 0,
      avgLossPct: 0,
      maxDrawdownPct: 0,
      totalNetPnlPct: 0,
      totalGrossPnlPct: 0
    };
  }

  const wins = trades.filter(t => t.outcome === 'WIN');
  const losses = trades.filter(t => t.outcome === 'LOSS');
  const expired = trades.filter(t => t.outcome === 'EXPIRED');

  const winRate = (wins.length / (wins.length + losses.length || 1)) * 100;

  const totalWinPnl = wins.reduce((sum, t) => sum + Math.max(0, t.netPnlPct), 0);
  const totalLossPnl = losses.reduce((sum, t) => sum + Math.abs(Math.min(0, t.netPnlPct)), 0);
  const profitFactor = totalLossPnl > 0 ? totalWinPnl / totalLossPnl : totalWinPnl > 0 ? 999 : 0;

  const avgWinPct = wins.length > 0 ? totalWinPnl / wins.length : 0;
  const avgLossPct = losses.length > 0 ? totalLossPnl / losses.length : 0;

  const winR = wins.map(t => Math.max(0, t.rMultiple));
  const lossR = losses.map(t => Math.abs(Math.min(0, t.rMultiple)));
  const avgWinR = winR.length > 0 ? winR.reduce((a, b) => a + b, 0) / winR.length : 0;
  const avgLossR = lossR.length > 0 ? lossR.reduce((a, b) => a + b, 0) / lossR.length : 0;
  const winFraction = wins.length / total;
  const lossFraction = losses.length / total;
  const expectancyR = (winFraction * avgWinR) - (lossFraction * (avgLossR || 1.0));

  // Max drawdown calculation on equity curve
  let peak = 0;
  let maxDD = 0;
  let equity = 0;
  for (const t of trades) {
    equity += t.netPnlPct;
    if (equity > peak) peak = equity;
    const dd = peak - equity;
    if (dd > maxDD) maxDD = dd;
  }

  const totalNetPnlPct = trades.reduce((sum, t) => sum + t.netPnlPct, 0);
  const totalGrossPnlPct = trades.reduce((sum, t) => sum + t.grossPnlPct, 0);

  return {
    total,
    wins: wins.length,
    losses: losses.length,
    expired: expired.length,
    winRate: parseFloat(winRate.toFixed(2)),
    profitFactor: parseFloat(profitFactor.toFixed(2)),
    expectancyR: parseFloat(expectancyR.toFixed(2)),
    avgWinPct: parseFloat(avgWinPct.toFixed(2)),
    avgLossPct: parseFloat(avgLossPct.toFixed(2)),
    maxDrawdownPct: parseFloat(maxDD.toFixed(2)),
    totalNetPnlPct: parseFloat(totalNetPnlPct.toFixed(2)),
    totalGrossPnlPct: parseFloat(totalGrossPnlPct.toFixed(2))
  };
}

async function runResearch() {
  console.log('================================================================');
  console.log('CRYPTO SQUEEZE BREAKOUT QUANTITATIVE RESEARCH EVALUATION');
  console.log('================================================================\n');

  // Multi-Asset Representative Sample across 2 Tiers:
  // Tier 1: Benchmark High-Caps (BTC, ETH, SOL)
  // Tier 2: Liquid Altcoins (BNB, ADA, XRP, DOGE, LINK, AVAX, NEAR)
  const assets = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'ADAUSDT', 'XRPUSDT', 'DOGEUSDT', 'LINKUSDT', 'AVAXUSDT', 'NEARUSDT'];
  const timeframes = ['5m', '15m', '1h', '4h'];

  console.log(`Evaluating ${assets.length} assets across ${timeframes.length} timeframes on real Binance Spot historical klines...`);

  let allSqueezeTrades: TradeResult[] = [];
  let allBaselineTrades: TradeResult[] = [];

  for (const asset of assets) {
    for (const tf of timeframes) {
      try {
        const { squeezeTrades, baselineTrades } = await evaluateAssetTimeframe(asset, tf, 500);
        allSqueezeTrades.push(...squeezeTrades);
        allBaselineTrades.push(...baselineTrades);
      } catch (err: any) {
        console.warn(`Error evaluating ${asset} ${tf}:`, err.message);
      }
    }
  }

  console.log(`\nCollected ${allSqueezeTrades.length} Squeeze Breakout trades and ${allBaselineTrades.length} Baseline trades.`);

  // Compute Overall Stats
  const sqOverall = computeStats(allSqueezeTrades);
  const baseOverall = computeStats(allBaselineTrades);

  // In-Sample vs Out-of-Sample
  const sqIS = computeStats(allSqueezeTrades.filter(t => t.sampleType === 'in_sample'));
  const sqOOS = computeStats(allSqueezeTrades.filter(t => t.sampleType === 'out_of_sample'));
  const baseIS = computeStats(allBaselineTrades.filter(t => t.sampleType === 'in_sample'));
  const baseOOS = computeStats(allBaselineTrades.filter(t => t.sampleType === 'out_of_sample'));

  // Long vs Short
  const sqLong = computeStats(allSqueezeTrades.filter(t => t.direction === 'UP'));
  const sqShort = computeStats(allSqueezeTrades.filter(t => t.direction === 'DOWN'));

  // Timeframe Breakdowns
  const sqByTf: Record<string, any> = {};
  const baseByTf: Record<string, any> = {};
  for (const tf of timeframes) {
    sqByTf[tf] = computeStats(allSqueezeTrades.filter(t => t.timeframe === tf));
    baseByTf[tf] = computeStats(allBaselineTrades.filter(t => t.timeframe === tf));
  }

  // Asset Group Breakdowns
  const benchmarkAssets = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'];
  const sqBenchmark = computeStats(allSqueezeTrades.filter(t => benchmarkAssets.includes(t.asset)));
  const sqAlts = computeStats(allSqueezeTrades.filter(t => !benchmarkAssets.includes(t.asset)));
  const baseBenchmark = computeStats(allBaselineTrades.filter(t => benchmarkAssets.includes(t.asset)));
  const baseAlts = computeStats(allBaselineTrades.filter(t => !benchmarkAssets.includes(t.asset)));

  const reportData = {
    summary: {
      assetsTested: assets,
      timeframesTested: timeframes,
      candlesPerSeries: 500,
      totalHistoricalBarsEvaluated: assets.length * timeframes.length * 500,
      executionFrictionAssumed: '0.20% Round-Trip Fee + 0.05% Slippage'
    },
    squeezeBreakout: {
      overall: sqOverall,
      inSample: sqIS,
      outOfSample: sqOOS,
      longOnly: sqLong,
      shortOnly: sqShort,
      byTimeframe: sqByTf,
      byAssetGroup: {
        benchmark: sqBenchmark,
        altcoins: sqAlts
      }
    },
    baselineStrategy: {
      overall: baseOverall,
      inSample: baseIS,
      outOfSample: baseOOS,
      byTimeframe: baseByTf,
      byAssetGroup: {
        benchmark: baseBenchmark,
        altcoins: baseAlts
      }
    }
  };

  console.log('\n================================================================');
  console.log('RESEARCH RESULTS JSON OUTPUT:');
  console.log('================================================================');
  console.log(JSON.stringify(reportData, null, 2));

  process.exit(0);
}

runResearch().catch(err => {
  console.error('Research execution error:', err);
  process.exit(1);
});
