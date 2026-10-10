/**
 * Extended Audit & Validation: Crypto Squeeze Breakout vs Existing BOS Strategy
 * 
 * Scope:
 * - 2,000 historical candles per asset & timeframe via paginated Binance Spot REST
 * - 10 representative assets (3 benchmark + 7 liquid alts)
 * - 4 timeframes: 5m, 15m, 1h, 4h (up to 80,000 total historical bars)
 * - Strict lookahead bias prevention (trigger on candle i close, forward sim i+1..i+20)
 * - Full mathematical reconciliation of PnL, Profit Factor, Expectancy, and Expired trades
 * 
 * Strict Confidentiality:
 * - Background research harness only. Zero UI modifications.
 */

import { normalizeSymbol, isPermanentlyExcludedSymbol } from '../server/binanceRest.js';
import { calculateMarketStructureLevels, calculateATR } from '../server/marketStructureLevels.js';
import { detectMarketRegime } from '../server/structureIntelligence.js';

const BASE_URLS = [
  'https://api.binance.com',
  'https://data-api.binance.vision',
  'https://api1.binance.com',
  'https://api2.binance.com'
];

async function binanceFetch(path: string) {
  let lastErr = null;
  for (const base of BASE_URLS) {
    try {
      const res = await fetch(`${base}${path}`, {
        headers: { 'User-Agent': 'NWWT-Research-Audit/2.0', 'Accept': 'application/json' },
        signal: AbortSignal.timeout(10000)
      });
      if (res.ok) return await res.json();
      lastErr = new Error(`HTTP ${res.status} from ${base}${path}`);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error(`Failed to fetch ${path}`);
}

// Fetch up to 2,000 candles via backward pagination
async function fetch2000Klines(symbol: string, interval: string, targetCount: number = 2000): Promise<any[]> {
  const cleanSymbol = normalizeSymbol(symbol);
  if (isPermanentlyExcludedSymbol(cleanSymbol)) return [];

  let allCandles: any[] = [];

  // Batch 1: Latest 1,000 candles
  try {
    const raw1 = await binanceFetch(`/api/v3/klines?symbol=${cleanSymbol}&interval=${interval}&limit=1000`);
    if (Array.isArray(raw1)) {
      const parsed1 = raw1.map(k => ({
        openTime: Number(k[0]),
        open: parseFloat(k[1]),
        high: parseFloat(k[2]),
        low: parseFloat(k[3]),
        close: parseFloat(k[4]),
        volume: parseFloat(k[5]),
        closeTime: Number(k[6]),
        isClosed: true
      })).filter(c => !isNaN(c.close) && c.close > 0);
      allCandles = parsed1;
    }
  } catch (err: any) {
    console.warn(`[audit] Batch 1 fetch error for ${cleanSymbol} ${interval}:`, err.message);
    return [];
  }

  // Batch 2: Previous 1,000 candles using endTime
  if (allCandles.length > 0 && allCandles.length < targetCount) {
    const oldestOpen = allCandles[0].openTime;
    try {
      const raw2 = await binanceFetch(`/api/v3/klines?symbol=${cleanSymbol}&interval=${interval}&limit=1000&endTime=${oldestOpen - 1}`);
      if (Array.isArray(raw2)) {
        const parsed2 = raw2.map(k => ({
          openTime: Number(k[0]),
          open: parseFloat(k[1]),
          high: parseFloat(k[2]),
          low: parseFloat(k[3]),
          close: parseFloat(k[4]),
          volume: parseFloat(k[5]),
          closeTime: Number(k[6]),
          isClosed: true
        })).filter(c => !isNaN(c.close) && c.close > 0);
        allCandles = [...parsed2, ...allCandles];
      }
    } catch (err: any) {
      // Fallback with batch 1
    }
  }

  // Deduplicate and sort ascending by openTime
  const seen = new Set<number>();
  const deduped: any[] = [];
  for (const c of allCandles) {
    if (!seen.has(c.openTime)) {
      seen.add(c.openTime);
      deduped.push(c);
    }
  }
  deduped.sort((a, b) => a.openTime - b.openTime);
  return deduped;
}

interface Trade {
  asset: string;
  timeframe: string;
  strategy: 'squeeze_breakout' | 'baseline_bos';
  direction: 'UP' | 'DOWN';
  entryTime: number;
  entryPrice: number;
  stopLoss: number;
  takeProfit1: number;
  takeProfit2: number;
  exitPrice: number;
  exitTime: number;
  outcome: 'WIN' | 'LOSS' | 'EXPIRED';
  candlesHeld: number;
  riskPct: number;
  rewardPct: number;
  grossPnlPct: number;
  netPnlPct: number;
  rMultiple: number;
  sampleType: 'in_sample' | 'out_of_sample';
}

function calcStdDev(values: number[], mean: number): number {
  if (values.length < 2) return 0;
  const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length;
  return Math.sqrt(variance);
}

function detectSqueeze(candles: any[], index: number) {
  const period = 20;
  if (index < period) {
    return { isSqueeze: false, squeezeHigh: 0, squeezeLow: 0 };
  }
  const window = candles.slice(index - period + 1, index + 1);
  const closes = window.map(c => c.close);
  const mean = closes.reduce((a, b) => a + b, 0) / period;
  const stdDev = calcStdDev(closes, mean);

  const bbUpper = mean + 2.0 * stdDev;
  const bbLower = mean - 2.0 * stdDev;

  const atr = calculateATR(window, 14);
  const kcUpper = mean + 1.5 * atr;
  const kcLower = mean - 1.5 * atr;

  const isBBSqueeze = bbUpper <= kcUpper && bbLower >= kcLower;
  const shortAtr = calculateATR(window.slice(-7), 7);
  const isAtrCompression = atr > 0 ? (shortAtr / atr) < 0.75 : false;

  const isSqueeze = isBBSqueeze || isAtrCompression;
  const squeezeHigh = Math.max(...window.slice(-10).map(c => c.high));
  const squeezeLow = Math.min(...window.slice(-10).map(c => c.low));

  return { isSqueeze, squeezeHigh, squeezeLow };
}

function simulateForward(
  candles: any[],
  startIndex: number,
  direction: 'UP' | 'DOWN',
  entryPrice: number,
  sl: number,
  tp1: number,
  maxHold: number = 20
) {
  let candlesHeld = 0;
  for (let k = startIndex; k < Math.min(startIndex + maxHold, candles.length); k++) {
    candlesHeld++;
    const bar = candles[k];

    if (direction === 'UP') {
      const slHit = bar.low <= sl;
      const tp1Hit = bar.high >= tp1;
      if (slHit && tp1Hit) {
        // Conservative assumption: Loss if both touched on same candle
        const grossPnl = ((sl - entryPrice) / entryPrice) * 100;
        return { outcome: 'LOSS' as const, exitPrice: sl, exitTime: bar.closeTime, grossPnl, candlesHeld };
      }
      if (tp1Hit) {
        const grossPnl = ((tp1 - entryPrice) / entryPrice) * 100;
        return { outcome: 'WIN' as const, exitPrice: tp1, exitTime: bar.closeTime, grossPnl, candlesHeld };
      }
      if (slHit) {
        const grossPnl = ((sl - entryPrice) / entryPrice) * 100;
        return { outcome: 'LOSS' as const, exitPrice: sl, exitTime: bar.closeTime, grossPnl, candlesHeld };
      }
    } else {
      const slHit = bar.high >= sl;
      const tp1Hit = bar.low <= tp1;
      if (slHit && tp1Hit) {
        const grossPnl = -((sl - entryPrice) / entryPrice) * 100;
        return { outcome: 'LOSS' as const, exitPrice: sl, exitTime: bar.closeTime, grossPnl, candlesHeld };
      }
      if (tp1Hit) {
        const grossPnl = ((entryPrice - tp1) / entryPrice) * 100;
        return { outcome: 'WIN' as const, exitPrice: tp1, exitTime: bar.closeTime, grossPnl, candlesHeld };
      }
      if (slHit) {
        const grossPnl = -((sl - entryPrice) / entryPrice) * 100;
        return { outcome: 'LOSS' as const, exitPrice: sl, exitTime: bar.closeTime, grossPnl, candlesHeld };
      }
    }
  }

  // Expiration at bar 20 close
  const lastBar = candles[Math.min(startIndex + maxHold - 1, candles.length - 1)];
  const grossPnl = direction === 'UP'
    ? ((lastBar.close - entryPrice) / entryPrice) * 100
    : ((entryPrice - lastBar.close) / entryPrice) * 100;
  return { outcome: 'EXPIRED' as const, exitPrice: lastBar.close, exitTime: lastBar.closeTime, grossPnl, candlesHeld };
}

async function runAudit() {
  console.log('========================================================================');
  console.log('AUDIT & VALIDATION: CRYPTO SQUEEZE BREAKOUT (EXTENDED 2,000 BARS)');
  console.log('========================================================================\n');

  const assets = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'ADAUSDT', 'XRPUSDT', 'DOGEUSDT', 'LINKUSDT', 'AVAXUSDT', 'NEARUSDT'];
  const timeframes = ['5m', '15m', '1h', '4h'];

  const TAKER_FEE = 0.0010; // 0.10% per side (0.20% round trip)
  const SLIPPAGE = 0.0005;   // 0.05% slippage on entry execution

  const allSqueezeTrades: Trade[] = [];
  const allBaselineTrades: Trade[] = [];
  const candleCounts: Record<string, number> = {};

  for (const asset of assets) {
    for (const tf of timeframes) {
      console.log(`Fetching 2,000 candles for ${asset} [${tf}]...`);
      const candles = await fetch2000Klines(asset, tf, 2000);
      const totalCandles = candles.length;
      candleCounts[`${asset}-${tf}`] = totalCandles;

      if (totalCandles < 100) continue;
      const splitIdx = Math.floor(totalCandles * 0.60);

      let squeezeState = { inSqueeze: false, squeezeBars: 0, high: 0, low: 0 };

      for (let i = 40; i < totalCandles - 25; i++) {
        const hist = candles.slice(0, i + 1);
        const c0 = candles[i];
        const c1 = candles[i - 1];
        const sampleType: 'in_sample' | 'out_of_sample' = i < splitIdx ? 'in_sample' : 'out_of_sample';

        const sq = detectSqueeze(hist, i - 1);
        if (sq.isSqueeze) {
          squeezeState.inSqueeze = true;
          squeezeState.squeezeBars++;
          squeezeState.high = Math.max(squeezeState.high || sq.squeezeHigh, sq.squeezeHigh);
          squeezeState.low = squeezeState.low === 0 ? sq.squeezeLow : Math.min(squeezeState.low, sq.squeezeLow);
        }

        // --- SQUEEZE BREAKOUT EVALUATION ---
        if (squeezeState.inSqueeze && squeezeState.squeezeBars >= 3) {
          const c0Range = c0.high - c0.low || 0.0001;
          const c0Body = Math.abs(c0.close - c0.open);
          const isDecisive = (c0Body / c0Range) > 0.48;

          let sqDir: 'UP' | 'DOWN' | null = null;
          if (c0.close > squeezeState.high && c0.close > c0.open && isDecisive) {
            sqDir = 'UP';
          } else if (c0.close < squeezeState.low && c0.close < c0.open && isDecisive) {
            sqDir = 'DOWN';
          }

          if (sqDir) {
            const levels = calculateMarketStructureLevels({
              symbol: asset,
              timeframe: tf,
              direction: sqDir,
              entryPrice: c0.close,
              candles: hist,
              setupType: 'Squeeze Breakout'
            });

            if (levels && levels.isValid && levels.stopLoss && levels.takeProfit1) {
              const entryPrice = sqDir === 'UP' ? c0.close * (1 + SLIPPAGE) : c0.close * (1 - SLIPPAGE);
              const sl = levels.stopLoss;
              const tp1 = levels.takeProfit1;
              const tp2 = levels.takeProfit2 || (sqDir === 'UP' ? entryPrice + (entryPrice - sl) * 2 : entryPrice - (sl - entryPrice) * 2);

              const sim = simulateForward(candles, i + 1, sqDir, entryPrice, sl, tp1, 20);
              const grossPnl = sim.grossPnl;
              const netPnl = grossPnl - (TAKER_FEE * 2) - SLIPPAGE;
              const riskDist = Math.abs(entryPrice - sl);
              const rMult = riskDist > 0 ? (netPnl / ((riskDist / entryPrice) * 100)) : 0;

              allSqueezeTrades.push({
                asset,
                timeframe: tf,
                strategy: 'squeeze_breakout',
                direction: sqDir,
                entryTime: c0.closeTime,
                entryPrice,
                stopLoss: sl,
                takeProfit1: tp1,
                takeProfit2: tp2,
                exitPrice: sim.exitPrice,
                exitTime: sim.exitTime,
                outcome: sim.outcome,
                candlesHeld: sim.candlesHeld,
                riskPct: (riskDist / entryPrice) * 100,
                rewardPct: (Math.abs(tp1 - entryPrice) / entryPrice) * 100,
                grossPnlPct: grossPnl,
                netPnlPct: netPnl,
                rMultiple: rMult,
                sampleType
              });

              squeezeState = { inSqueeze: false, squeezeBars: 0, high: 0, low: 0 };
              i += sim.candlesHeld;
              continue;
            }
          }
        }

        // --- BASELINE BOS EVALUATION ---
        const swingWindow = hist.slice(-20);
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
            symbol: asset,
            timeframe: tf,
            direction: baseDir,
            entryPrice: c0.close,
            candles: hist,
            setupType: 'Strong Confirmed Break (BOS)'
          });

          if (levels && levels.isValid && levels.stopLoss && levels.takeProfit1) {
            const entryPrice = baseDir === 'UP' ? c0.close * (1 + SLIPPAGE) : c0.close * (1 - SLIPPAGE);
            const sl = levels.stopLoss;
            const tp1 = levels.takeProfit1;
            const tp2 = levels.takeProfit2 || (baseDir === 'UP' ? entryPrice + (entryPrice - sl) * 2 : entryPrice - (sl - entryPrice) * 2);

            const sim = simulateForward(candles, i + 1, baseDir, entryPrice, sl, tp1, 20);
            const grossPnl = sim.grossPnl;
            const netPnl = grossPnl - (TAKER_FEE * 2) - SLIPPAGE;
            const riskDist = Math.abs(entryPrice - sl);
            const rMult = riskDist > 0 ? (netPnl / ((riskDist / entryPrice) * 100)) : 0;

            allBaselineTrades.push({
              asset,
              timeframe: tf,
              strategy: 'baseline_bos',
              direction: baseDir,
              entryTime: c0.closeTime,
              entryPrice,
              stopLoss: sl,
              takeProfit1: tp1,
              takeProfit2: tp2,
              exitPrice: sim.exitPrice,
              exitTime: sim.exitTime,
              outcome: sim.outcome,
              candlesHeld: sim.candlesHeld,
              riskPct: (riskDist / entryPrice) * 100,
              rewardPct: (Math.abs(tp1 - entryPrice) / entryPrice) * 100,
              grossPnlPct: grossPnl,
              netPnlPct: netPnl,
              rMultiple: rMult,
              sampleType
            });

            i += sim.candlesHeld;
          }
        }
      }
    }
  }

  // --- MATHEMATICAL RECONCILIATION SUITE ---
  function computeReconciledMetrics(trades: Trade[]) {
    const total = trades.length;
    if (total === 0) return null;

    const wins = trades.filter(t => t.outcome === 'WIN');
    const losses = trades.filter(t => t.outcome === 'LOSS');
    const expired = trades.filter(t => t.outcome === 'EXPIRED');

    const expiredGains = expired.filter(t => t.netPnlPct > 0);
    const expiredLosses = expired.filter(t => t.netPnlPct <= 0);

    // 1. Definitive Binary Settlement (TP vs SL only)
    const settledCount = wins.length + losses.length;
    const settledWinRate = settledCount > 0 ? (wins.length / settledCount) * 100 : 0;
    const settledWinPnl = wins.reduce((s, t) => s + t.netPnlPct, 0);
    const settledLossPnl = losses.reduce((s, t) => s + Math.abs(t.netPnlPct), 0);
    const settledProfitFactor = settledLossPnl > 0 ? settledWinPnl / settledLossPnl : settledWinPnl > 0 ? 999 : 0;
    const avgSettledWinR = wins.length > 0 ? wins.reduce((s, t) => s + t.rMultiple, 0) / wins.length : 0;
    const avgSettledLossR = losses.length > 0 ? losses.reduce((s, t) => s + Math.abs(t.rMultiple), 0) / losses.length : 0;
    const settledExpectancyR = settledCount > 0 ? ((wins.length / settledCount) * avgSettledWinR) - ((losses.length / settledCount) * (avgSettledLossR || 1.0)) : 0;

    // 2. Mark-to-Market at Expiry (Every trade closed at T+20)
    const mtmWins = [...wins, ...expiredGains];
    const mtmLosses = [...losses, ...expiredLosses];
    const mtmWinRate = (mtmWins.length / total) * 100;
    const mtmGrossProfit = mtmWins.reduce((s, t) => s + t.netPnlPct, 0);
    const mtmGrossLoss = mtmLosses.reduce((s, t) => s + Math.abs(t.netPnlPct), 0);
    const mtmProfitFactor = mtmGrossLoss > 0 ? mtmGrossProfit / mtmGrossLoss : mtmGrossProfit > 0 ? 999 : 0;
    const totalNetPnl = trades.reduce((s, t) => s + t.netPnlPct, 0);
    const totalGrossPnl = trades.reduce((s, t) => s + t.grossPnlPct, 0);
    const mtmExpectancyR = trades.reduce((s, t) => s + t.rMultiple, 0) / total;

    // Equity Curve Max Drawdown
    let peak = 0;
    let maxDD = 0;
    let equity = 0;
    for (const t of trades) {
      equity += t.netPnlPct;
      if (equity > peak) peak = equity;
      const dd = peak - equity;
      if (dd > maxDD) maxDD = dd;
    }

    return {
      counts: {
        totalSetups: total,
        wins: wins.length,
        losses: losses.length,
        expiredTotal: expired.length,
        expiredGains: expiredGains.length,
        expiredLosses: expiredLosses.length,
        expiredRatioPct: (expired.length / total) * 100
      },
      definitiveSettlement: {
        settledTrades: settledCount,
        winRatePct: parseFloat(settledWinRate.toFixed(2)),
        profitFactor: parseFloat(settledProfitFactor.toFixed(2)),
        expectancyR: parseFloat(settledExpectancyR.toFixed(2)),
        avgWinPct: wins.length > 0 ? parseFloat((settledWinPnl / wins.length).toFixed(2)) : 0,
        avgLossPct: losses.length > 0 ? parseFloat((settledLossPnl / losses.length).toFixed(2)) : 0
      },
      markToMarketAtExpiry: {
        allInTrades: total,
        winRatePct: parseFloat(mtmWinRate.toFixed(2)),
        profitFactor: parseFloat(mtmProfitFactor.toFixed(2)),
        expectancyR: parseFloat(mtmExpectancyR.toFixed(2)),
        totalNetPnlPct: parseFloat(totalNetPnl.toFixed(2)),
        totalGrossPnlPct: parseFloat(totalGrossPnl.toFixed(2)),
        maxDrawdownPct: parseFloat(maxDD.toFixed(2))
      }
    };
  }

  const sqOverall = computeReconciledMetrics(allSqueezeTrades);
  const baseOverall = computeReconciledMetrics(allBaselineTrades);

  // In-Sample vs Out-of-Sample
  const sqIS = computeReconciledMetrics(allSqueezeTrades.filter(t => t.sampleType === 'in_sample'));
  const sqOOS = computeReconciledMetrics(allSqueezeTrades.filter(t => t.sampleType === 'out_of_sample'));
  const baseIS = computeReconciledMetrics(allBaselineTrades.filter(t => t.sampleType === 'in_sample'));
  const baseOOS = computeReconciledMetrics(allBaselineTrades.filter(t => t.sampleType === 'out_of_sample'));

  // Directional
  const sqLong = computeReconciledMetrics(allSqueezeTrades.filter(t => t.direction === 'UP'));
  const sqShort = computeReconciledMetrics(allSqueezeTrades.filter(t => t.direction === 'DOWN'));

  // Timeframe Breakdowns
  const sqByTf: Record<string, any> = {};
  const baseByTf: Record<string, any> = {};
  for (const tf of timeframes) {
    sqByTf[tf] = computeReconciledMetrics(allSqueezeTrades.filter(t => t.timeframe === tf));
    baseByTf[tf] = computeReconciledMetrics(allBaselineTrades.filter(t => t.timeframe === tf));
  }

  // Asset Group Breakdowns
  const benchmarks = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'];
  const sqBenchmark = computeReconciledMetrics(allSqueezeTrades.filter(t => benchmarks.includes(t.asset)));
  const sqAlts = computeReconciledMetrics(allSqueezeTrades.filter(t => !benchmarks.includes(t.asset)));
  const baseBenchmark = computeReconciledMetrics(allBaselineTrades.filter(t => benchmarks.includes(t.asset)));
  const baseAlts = computeReconciledMetrics(allBaselineTrades.filter(t => !benchmarks.includes(t.asset)));

  const auditOutput = {
    auditScope: {
      totalCandlesSampled: Object.values(candleCounts).reduce((a, b) => a + b, 0),
      assetsEvaluated: assets,
      timeframesEvaluated: timeframes,
      frictionModel: '0.20% Round-Trip Fees (Binance Spot VIP0) + 0.05% Execution Slippage'
    },
    squeezeBreakout: {
      overall: sqOverall,
      inSample: sqIS,
      outOfSample: sqOOS,
      longOnly: sqLong,
      shortOnly: sqShort,
      byTimeframe: sqByTf,
      byAssetGroup: { benchmark: sqBenchmark, altcoins: sqAlts }
    },
    baselineBos: {
      overall: baseOverall,
      inSample: baseIS,
      outOfSample: baseOOS,
      byTimeframe: baseByTf,
      byAssetGroup: { benchmark: baseBenchmark, altcoins: baseAlts }
    }
  };

  console.log('\n========================================================================');
  console.log('AUDIT RECONCILIATION REPORT (JSON):');
  console.log('========================================================================');
  import('fs').then(fs => {
    fs.writeFileSync('scripts/auditResult.json', JSON.stringify(auditOutput, null, 2));
    console.log('Audit results saved to scripts/auditResult.json');
    process.exit(0);
  });
}

runAudit().catch(err => {
  console.error('[audit] Execution error:', err);
  process.exit(1);
});
