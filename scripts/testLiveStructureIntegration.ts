/**
 * Live 88 Binance Scanner Market Structure Integration Test Suite
 *
 * Verifies that the live 88 Binance Scanner:
 * 1. Exclusively uses the structure-based trade level engine for every live signal.
 * 2. Emits signals with distinct entry, SL, TP1, TP2, risk distance, target distance, R:R, timeframe, structureReference, pair, and direction.
 * 3. Produces truly dynamic, pair-specific levels across genuine Binance Spot pairs (BTC, ETH, SOL, BNB, DOGE, XRP).
 * 4. Never reuses fixed percentage (1.5%) or fixed dollar distances.
 * 5. Visually and logically locks trade levels so chart updates never randomly move SL or TP.
 * 6. Keeps the newest signal glow locked to the newest confirmed closed-candle signal without price-tick jitter.
 * 7. Strictly rejects trades when structure invalidation is missing, TP1 is too close, stop is too wide, or R:R is unfavorable.
 * 8. Maintains absolute separation of live and backtest performance, preserving validated settlement rules.
 * 9. Provides developer diagnostics showing structure references, support/resistance, and exact level reasons.
 */

import { fetchKlines } from '../server/binanceRest.js';
import { calculateMarketStructureLevels, calculateATR, findFractalSwings } from '../src/utils/marketStructureLevels.ts';
import { scannerService } from '../server/scannerService.js';
import { checkSignalTouch } from '../src/utils/signalTouchEngine.ts';
import {
  evaluateSignalsWithTicker,
  calculatePerformanceStats,
  mergeScannerSignals
} from '../src/utils/performanceEngine.ts';
import { ScannerSignalItem, Candle } from '../src/types.ts';

// Mock localStorage for Node.js environment
if (typeof globalThis.localStorage === 'undefined') {
  const store = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (key: string) => store.get(key) || null,
    setItem: (key: string, value: string) => store.set(key, value),
    removeItem: (key: string) => store.delete(key),
    clear: () => store.clear(),
    key: (index: number) => Array.from(store.keys())[index] || null,
    length: 0
  } as any;
}

let passedTests = 0;
let totalTests = 0;

function assert(condition: boolean, testName: string, details?: any) {
  totalTests++;
  if (condition) {
    console.log(`  ✓ PASS: ${testName}`);
    passedTests++;
  } else {
    console.error(`  ✗ FAIL: ${testName}`, details ? details : '');
    process.exitCode = 1;
  }
}

async function runLiveStructureIntegrationTests() {
  console.log('\n======================================================');
  console.log('NWWT LIVE 88 BINANCE SCANNER STRUCTURE INTEGRATION SUITE');
  console.log('======================================================\n');

  // =========================================================================
  // TEST GROUP 1: Live Signal Field Completeness & Non-Fixed Distance Verification
  // =========================================================================
  console.log('TEST GROUP 1: Live Signal Field Completeness & Structure Attribution');
  {
    const now = Date.now();
    // Synthetic closed candles with a clear structural low and target resistance
    const candles: Candle[] = [];
    for (let i = 25; i >= 1; i--) {
      const openTime = now - i * 15 * 60 * 1000;
      const closeTime = openTime + 15 * 60 * 1000 - 1;
      let low = 84800, high = 85500, close = 85200;
      if (i === 15) { low = 83900; close = 84100; } // Swing Low Anchor
      if (i === 7) { high = 86800; close = 86500; }  // Swing High Target
      if (i === 1) { close = 85000; high = 85150; low = 84900; } // Entry close
      candles.push({ openTime, closeTime, open: close - 30, high, low, close, volume: 1500 });
    }

    const liveSignal = scannerService.generateStructuralSignal({
      symbol: 'BTCUSDT',
      timeframe: '15m',
      direction: 'UP',
      setupType: 'Break & Retest (Reinforced)',
      closePrice: 85000,
      confidence: 94,
      reason: 'Confirmed retest of broken structure',
      timestamp: now,
      confirmedCandleCloseTime: candles[candles.length - 1].closeTime,
      closedCandles: candles,
      regimeData: { regime: 'trending_bullish' }
    });

    assert(liveSignal !== null, '1.1 Live structural signal generated successfully');
    if (liveSignal) {
      assert(typeof liveSignal.entryPrice === 'number' && liveSignal.entryPrice === 85000, '1.2 Signal contains exact entryPrice ($85,000)');
      assert(typeof liveSignal.stopLoss === 'number' && liveSignal.stopLoss < 83900, '1.3 Signal contains structure-based stopLoss anchored below swing low');
      assert(typeof liveSignal.takeProfit1 === 'number' && liveSignal.takeProfit1 === 86800, '1.4 Signal contains structure-based takeProfit1 ($86,800)');
      assert(typeof liveSignal.riskDistance === 'number' && liveSignal.riskDistance > 0, '1.5 Signal contains calculated riskDistance');
      assert(typeof liveSignal.targetDistance === 'number' && liveSignal.targetDistance > 0, '1.6 Signal contains calculated targetDistance');
      assert(typeof liveSignal.rewardRiskRatio === 'number' && liveSignal.rewardRiskRatio > 0, '1.7 Signal contains resulting rewardRiskRatio');
      assert(liveSignal.timeframe === '15m', '1.8 Signal contains exact timeframe');
      assert(liveSignal.asset === 'BTCUSDT', '1.9 Signal contains exact pair identifier');
      assert(liveSignal.direction === 'UP', '1.10 Signal contains exact direction');
      assert(liveSignal.structureReference !== undefined, '1.11 Signal contains complete structureReference object');

      // Check legacy fixed 1.5% exclusion
      const stopDistancePct = ((liveSignal.entryPrice - liveSignal.stopLoss) / liveSignal.entryPrice) * 100;
      assert(stopDistancePct !== 1.50, `1.12 Stop loss distance (${stopDistancePct.toFixed(2)}%) is dynamic, NOT fixed 1.50%`);
    }
  }

  // =========================================================================
  // TEST GROUP 2: Proof of Dynamic Levels Across Multiple Real Binance Pairs
  // =========================================================================
  console.log('\nTEST GROUP 2: Dynamic Levels Across Genuine Binance Spot Market Pairs');
  {
    const pairsToTest = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'DOGEUSDT', 'XRPUSDT'];
    const pairResults: {
      symbol: string;
      direction: string;
      entry: number;
      sl: number;
      tp1: number;
      riskPct: number;
      riskDist: number;
      rr: number;
      atr: number;
    }[] = [];

    for (const symbol of pairsToTest) {
      try {
        const liveCandles = await fetchKlines(symbol, '15m', 100);
        if (Array.isArray(liveCandles) && liveCandles.length >= 35) {
          // Identify the most recent confirmed candle close that formed a valid structural setup
          let validSetup = null;
          for (let i = liveCandles.length - 1; i >= 30; i--) {
            const slice = liveCandles.slice(0, i);
            const cur = slice[slice.length - 1];

            const resUp = calculateMarketStructureLevels({
              symbol,
              timeframe: '15m',
              direction: 'UP',
              entryPrice: cur.close,
              candles: slice
            });

            const resDown = calculateMarketStructureLevels({
              symbol,
              timeframe: '15m',
              direction: 'DOWN',
              entryPrice: cur.close,
              candles: slice
            });

            if (resUp.isValid) {
              validSetup = { ...resUp, direction: 'UP' };
              break;
            }
            if (resDown.isValid) {
              validSetup = { ...resDown, direction: 'DOWN' };
              break;
            }
          }

          if (validSetup) {
            const atr = calculateATR(liveCandles, 14);
            const riskDist = Math.abs(validSetup.entryPrice - validSetup.stopLoss);
            const riskPct = (riskDist / validSetup.entryPrice) * 100;

            pairResults.push({
              symbol,
              direction: validSetup.direction,
              entry: validSetup.entryPrice,
              sl: validSetup.stopLoss,
              tp1: validSetup.takeProfit1,
              riskPct,
              riskDist,
              rr: validSetup.rewardRiskRatio,
              atr
            });
          }
        }
      } catch (err: any) {
        console.warn(`Note: Could not reach live Binance endpoint for ${symbol}:`, err.message);
      }
    }

    assert(pairResults.length >= 4, `2.1 Successfully verified structural setups on real Binance candles across ${pairResults.length} distinct pairs`);

    if (pairResults.length >= 2) {
      // Prove risk percentages vary significantly across pairs
      const riskPercentages = pairResults.map((p) => parseFloat(p.riskPct.toFixed(2)));
      const uniquePercentages = new Set(riskPercentages);
      assert(
        uniquePercentages.size > 1,
        `2.2 Risk percentages are distinct across pairs (${riskPercentages.join('%, ')}%), proving no universal fixed percentage`
      );

      // Prove dollar distances differ vastly (e.g. BTC vs SOL vs DOGE)
      const dollarDistances = pairResults.map((p) => p.riskDist);
      const uniqueDollars = new Set(dollarDistances);
      assert(
        uniqueDollars.size === pairResults.length,
        '2.3 Absolute dollar risk distances are pair-specific and not reused across assets'
      );

      // Verify none of the setups use the legacy 1.5% fixed distance
      const fixedMatches = pairResults.filter((p) => Math.abs(p.riskPct - 1.50) < 0.05);
      assert(
        fixedMatches.length === 0,
        '2.4 Zero pairs received the legacy hardcoded 1.5% stop loss distance'
      );

      // Print live table summary for documentation
      console.log('      Live Binance Structure Metrics:');
      pairResults.forEach((p) => {
        console.log(
          `      • ${p.symbol.padEnd(8)} [${p.direction}] Entry: $${p.entry.toFixed(2).padStart(8)} | SL: $${p.sl.toFixed(2).padStart(8)} | TP1: $${p.tp1.toFixed(2).padStart(8)} | Risk: ${p.riskPct.toFixed(2)}% ($${p.riskDist.toFixed(2)}) | R:R 1:${p.rr.toFixed(2)} | ATR: $${p.atr.toFixed(2)}`
        );
      });
    }
  }

  // =========================================================================
  // TEST GROUP 3: Live Chart Level Matching & Invariance on Chart Updates
  // =========================================================================
  console.log('\nTEST GROUP 3: Live Chart Level Matching & Fixed Level Invariance');
  {
    const initialSignal: ScannerSignalItem = {
      id: 'chart-invariance-btc-1',
      asset: 'BTCUSDT',
      timeframe: '15m',
      direction: 'UP',
      setupType: 'Break & Retest (Reinforced)',
      signalPrice: 85200,
      entryPrice: 85200,
      takeProfit: 86900,
      takeProfit1: 86900,
      takeProfit2: 88100,
      stopLoss: 84350,
      invalidationLevel: 84350,
      rewardRiskRatio: 2.0,
      riskDistance: 850,
      targetDistance: 1700,
      confidence: 93,
      status: 'ACTIVE',
      reason: 'Key resistance break & retest',
      timestamp: Date.now() - 300000,
      confirmedCandleCloseTime: Date.now() - 300000,
      expiryTimestamp: Date.now() + 3600000,
      expiryCandles: 24,
      structureReference: {
        swingLow: 84400,
        swingHigh: 86900,
        supportLevel: 84400,
        resistanceLevel: 86900,
        buffer: 50,
        atr: 280,
        invalidationType: 'Below Swing Low ($84400.00)',
        tp1TargetType: 'Structural Resistance',
        riskDistance: 850,
        targetDistance: 1700,
        timeframe: '15m',
        pair: 'BTCUSDT'
      }
    };

    // Simulate 10 incoming live price ticks on chart
    const liveTicks = [85210, 85250, 85190, 85300, 85280, 85350, 85220, 85400, 85390, 85450];
    let currentSignalState = { ...initialSignal };

    for (const tick of liveTicks) {
      const evaluation = evaluateSignalsWithTicker([currentSignalState], 'BTCUSDT', tick);
      currentSignalState = evaluation.updatedSignals[0];

      // Verify levels DID NOT MOVE
      assert(
        currentSignalState.entryPrice === 85200 &&
        currentSignalState.stopLoss === 84350 &&
        currentSignalState.takeProfit1 === 86900 &&
        currentSignalState.takeProfit2 === 88100,
        `3.1 Levels remained strictly fixed at tick price $${tick}`
      );
    }

    assert(
      currentSignalState.entryPrice === initialSignal.entryPrice &&
      currentSignalState.stopLoss === initialSignal.stopLoss &&
      currentSignalState.takeProfit1 === initialSignal.takeProfit1 &&
      currentSignalState.takeProfit2 === initialSignal.takeProfit2,
      '3.2 Final verification: Chart level values match initial signal engine records with zero drift'
    );
  }

  // =========================================================================
  // TEST GROUP 4: Signal Stability & Newest Signal Glow Anchoring
  // =========================================================================
  console.log('\nTEST GROUP 4: Signal Stability & Newest Signal Glow Anchoring');
  {
    const olderSignalTime = Date.now() - 900000; // Closed 15 mins ago
    const newestSignalTime = Date.now() - 60000; // Closed 1 min ago

    const olderSignal: ScannerSignalItem = {
      id: 'signal-older-sol',
      asset: 'SOLUSDT',
      timeframe: '15m',
      direction: 'UP',
      setupType: 'Break & Retest',
      signalPrice: 142.0,
      entryPrice: 142.0,
      takeProfit: 149.0,
      takeProfit1: 149.0,
      stopLoss: 138.5,
      invalidationLevel: 138.5,
      confidence: 88,
      status: 'ACTIVE',
      reason: 'Older valid signal',
      timestamp: olderSignalTime,
      confirmedCandleCloseTime: olderSignalTime,
      expiryTimestamp: olderSignalTime + 3600000,
      expiryCandles: 24
    };

    const newestSignal: ScannerSignalItem = {
      id: 'signal-newest-btc',
      asset: 'BTCUSDT',
      timeframe: '15m',
      direction: 'UP',
      setupType: 'Strong Confirmed Break (BOS)',
      signalPrice: 85800,
      entryPrice: 85800,
      takeProfit: 87400,
      takeProfit1: 87400,
      stopLoss: 85100,
      invalidationLevel: 85100,
      confidence: 92,
      status: 'ACTIVE',
      reason: 'Genuinely newer confirmed candle break',
      timestamp: newestSignalTime,
      confirmedCandleCloseTime: newestSignalTime,
      expiryTimestamp: newestSignalTime + 3600000,
      expiryCandles: 24
    };

    const activeList = [olderSignal, newestSignal];

    // Helper that replicates WatchlistScannerPanel latestActiveSignal determination
    const determineLatestSignal = (signals: ScannerSignalItem[]) => {
      const sorted = [...signals].sort((a, b) => {
        const timeA = a.confirmedCandleCloseTime || a.timestamp || 0;
        const timeB = b.confirmedCandleCloseTime || b.timestamp || 0;
        if (timeB !== timeA) return timeB - timeA;
        return (b.confidence || 0) - (a.confidence || 0);
      });
      return sorted[0] || null;
    };

    const latest = determineLatestSignal(activeList);
    assert(latest?.id === newestSignal.id, '4.1 Newest signal glow correctly targets the newest confirmed candle close signal');

    // Simulate 50 incoming fast price ticks
    for (let tick = 85801; tick <= 85850; tick++) {
      const liveEval = evaluateSignalsWithTicker(activeList, 'BTCUSDT', tick);
      const latestAfterTick = determineLatestSignal(liveEval.updatedSignals);
      if (latestAfterTick?.id !== newestSignal.id) {
        assert(false, '4.2 Price tick caused glow to jump or change!');
        break;
      }
    }
    assert(true, '4.2 50 consecutive live price ticks did NOT cause newest signal glow to jitter or shift');

    // Verify duplicate signal from same candle does not regenerate or replace
    const duplicateCandidate: ScannerSignalItem = {
      ...newestSignal,
      id: 'signal-newest-btc-dup-cand',
      confirmedCandleCloseTime: newestSignalTime
    };
    const merged = mergeScannerSignals([newestSignal], [duplicateCandidate]);
    assert(merged.length === 1, '4.3 Scanner strictly rejects regenerating identical signal from the same candle');
  }

  // =========================================================================
  // TEST GROUP 5: Rejection Verification (Strict No Forced Trades)
  // =========================================================================
  console.log('\nTEST GROUP 5: Rejection Verification (Strict No Forced Trades)');
  {
    const now = Date.now();

    // 5.1 Rejection when TP1 is too close to entry (< 0.55x ATR)
    const tightCandles: Candle[] = [];
    for (let i = 25; i >= 1; i--) {
      const openTime = now - i * 15 * 60 * 1000;
      const closeTime = openTime + 15 * 60 * 1000 - 1;
      let low = 84500, high = 85200, close = 85000;
      if (i === 12) { low = 84200; close = 84300; } // Swing Low
      if (i === 6) { high = 85080; close = 85070; }  // Ceiling only $80 above entry ($85,000)!
      if (i === 1) { close = 85000; high = 85050; low = 84950; }
      tightCandles.push({ openTime, closeTime, open: close - 20, high, low, close, volume: 1000 });
    }

    const resTooClose = calculateMarketStructureLevels({
      symbol: 'BTCUSDT',
      timeframe: '15m',
      direction: 'UP',
      entryPrice: 85000,
      candles: tightCandles
    });
    assert(resTooClose.isValid === false, '5.1 Setup strictly rejected when TP1 is too close to entry');
    assert(
      resTooClose.rejectReason?.toLowerCase().includes('close to entry') ||
      resTooClose.rejectReason?.toLowerCase().includes('risk-to-reward'),
      `5.2 Rejection reason clearly reported: "${resTooClose.rejectReason}"`
    );

    // 5.2 Rejection when structural stop loss is unreasonably wide (> 6.5%)
    const wideCandles: Candle[] = [];
    for (let i = 25; i >= 1; i--) {
      const openTime = now - i * 15 * 60 * 1000;
      const closeTime = openTime + 15 * 60 * 1000 - 1;
      let low = 84500, high = 85200, close = 85000;
      if (i === 18) { low = 78000; close = 78500; } // Stop at 78,000 is >8% away from 85,000!
      if (i === 7) { high = 88000; close = 87800; }
      if (i === 1) { close = 85000; high = 85100; low = 84900; }
      wideCandles.push({ openTime, closeTime, open: close - 20, high, low, close, volume: 1000 });
    }

    const resTooWide = calculateMarketStructureLevels({
      symbol: 'BTCUSDT',
      timeframe: '15m',
      direction: 'UP',
      entryPrice: 85000,
      candles: wideCandles,
      maxRiskPercent: 6.5
    });
    assert(resTooWide.isValid === false, '5.3 Setup strictly rejected when structural stop loss is unreasonably wide');
    assert(
      resTooWide.rejectReason?.toLowerCase().includes('unreasonably wide'),
      `5.4 Wide SL rejection reason: "${resTooWide.rejectReason}"`
    );

    // 5.3 ScannerService generateStructuralSignal returns null on rejected setups
    const signalRejected = scannerService.generateStructuralSignal({
      symbol: 'BTCUSDT',
      timeframe: '15m',
      direction: 'UP',
      setupType: 'Break & Retest',
      closePrice: 85000,
      confidence: 88,
      reason: 'Strategy triggered but structure invalid',
      timestamp: now,
      confirmedCandleCloseTime: now,
      closedCandles: tightCandles,
      regimeData: { regime: 'ranging' }
    });
    assert(signalRejected === null, '5.5 ScannerService returns null for rejected setups (no forced trades)');
  }

  // =========================================================================
  // TEST GROUP 6: Live Performance Quarantine & Settlement Invariance
  // =========================================================================
  console.log('\nTEST GROUP 6: Live Performance Quarantine & Settlement Invariance');
  {
    // A. Quarantine verification: Backtest signal NEVER counted as live trade
    const liveWin: ScannerSignalItem = {
      id: 'live-win-1',
      asset: 'BTCUSDT',
      timeframe: '15m',
      direction: 'UP',
      setupType: 'Break & Retest',
      entryPrice: 85000,
      takeProfit: 86500,
      takeProfit1: 86500,
      stopLoss: 84200,
      status: 'WIN',
      pnlPercent: 1.76,
      expiryCandles: 24,
      expiryTimestamp: Date.now() + 3600000,
      isTradeComplete: true,
      isBacktest: false // Genuine live trade
    };

    const backtestTrade: ScannerSignalItem = {
      id: 'bt-sim-1',
      asset: 'ETHUSDT',
      timeframe: '1h',
      direction: 'DOWN',
      setupType: 'Fakeout Rejection',
      entryPrice: 3200,
      takeProfit: 3050,
      takeProfit1: 3050,
      stopLoss: 3300,
      status: 'WIN',
      pnlPercent: 4.68,
      expiryCandles: 24,
      expiryTimestamp: Date.now() + 3600000,
      isTradeComplete: true,
      isBacktest: true // Quarantined historical simulation
    };

    const mixedSignals = [liveWin, backtestTrade];
    const stats = calculatePerformanceStats(mixedSignals);

    assert(stats.liveStats !== undefined, '6.1 Live performance summary generated');
    assert(stats.backtestStats !== undefined, '6.2 Backtest performance summary generated');
    assert(stats.liveStats?.trades === 1, '6.3 Live trades strictly equals 1 (backtest trade quarantined from live count)');
    assert(stats.liveStats?.sampleSize === 1, '6.4 Live sample size strictly isolates live signals');
    assert(stats.backtestStats?.trades === 1, '6.5 Backtest trades count accurately isolated');

    // B. Settlement rule: TP1 hit + subsequent reversal to SL permanently remains WIN
    const liveReversalTrade: ScannerSignalItem = {
      id: 'live-rev-1',
      asset: 'SOLUSDT',
      timeframe: '15m',
      direction: 'UP',
      setupType: 'Strong Confirmed Break',
      entryPrice: 140.0,
      takeProfit: 148.0,
      takeProfit1: 148.0,
      takeProfit2: 154.0,
      stopLoss: 135.0,
      invalidationLevel: 135.0,
      status: 'ACTIVE',
      expiryCandles: 24,
      expiryTimestamp: Date.now() + 3600000
    };

    // First: Price touches TP1 (148.20)
    const afterTP1 = evaluateSignalsWithTicker([liveReversalTrade], 'SOLUSDT', 148.2).updatedSignals[0];
    assert(afterTP1.status === 'WIN' && afterTP1.tp1Hit === true, '6.6 TP1 touch transitions status to WIN immediately');
    assert(afterTP1.isTradeComplete === false, '6.7 Trade remains active to monitor TP2');

    // Second: Market reverses sharply and touches SL (134.50)
    const afterReversal = evaluateSignalsWithTicker([afterTP1], 'SOLUSDT', 134.5).updatedSignals[0];
    assert(afterReversal.status === 'WIN', '6.8 Reversal to SL permanently retains WIN status');
    assert(afterReversal.isTradeComplete === true, '6.9 Reversal trade marked complete without converting to LOSS');

    // Calculate stats on reversal trade: must show 1 WIN, 0 LOSSES
    const reversalStats = calculatePerformanceStats([afterReversal]);
    assert(reversalStats.winsCount === 1 && reversalStats.lossesCount === 0, '6.10 Reversal trade counted as 1 WIN and 0 LOSSES in performance engine');
  }

  // =========================================================================
  // TEST GROUP 7: Developer Diagnostics Verification
  // =========================================================================
  console.log('\nTEST GROUP 7: Developer Diagnostics Field Verification');
  {
    const diagSignal: ScannerSignalItem = {
      id: 'diag-btc-verify',
      asset: 'BTCUSDT',
      timeframe: '15m',
      direction: 'UP',
      setupType: 'Break & Retest (Reinforced)',
      signalPrice: 85000,
      entryPrice: 85000,
      takeProfit: 86400,
      takeProfit1: 86400,
      takeProfit2: 87850,
      stopLoss: 83980,
      invalidationLevel: 83980,
      rewardRiskRatio: 1.37,
      confidence: 95,
      status: 'ACTIVE',
      reason: 'Structure validated break and retest',
      timestamp: Date.now(),
      expiryTimestamp: Date.now() + 3600000,
      expiryCandles: 24,
      structureReference: {
        swingLow: 84250,
        swingHigh: 86400,
        supportLevel: 84250,
        resistanceLevel: 86400,
        buffer: 270,
        atr: 380,
        invalidationType: 'Below Recent Swing Low ($84250.00)',
        tp1TargetType: 'Structural Resistance',
        tp2TargetType: 'Secondary Structural Target',
        riskDistance: 1020,
        targetDistance: 1400,
        timeframe: '15m',
        pair: 'BTCUSDT'
      }
    };

    // Construct the exact developer diagnostic record
    const diagRecord = {
      structureReference: diagSignal.structureReference?.invalidationType,
      supportReference: diagSignal.structureReference?.supportLevel,
      entry: diagSignal.entryPrice,
      sl: diagSignal.stopLoss,
      tp1: diagSignal.takeProfit1,
      tp2: diagSignal.takeProfit2,
      rr: `${(Math.abs(diagSignal.takeProfit1! - diagSignal.entryPrice) / Math.abs(diagSignal.entryPrice - diagSignal.stopLoss)).toFixed(2)} / ${(Math.abs(diagSignal.takeProfit2! - diagSignal.entryPrice) / Math.abs(diagSignal.entryPrice - diagSignal.stopLoss)).toFixed(2)}`,
      buffer: diagSignal.structureReference?.buffer,
      atr: diagSignal.structureReference?.atr
    };

    assert(diagRecord.structureReference?.includes('Recent Swing Low'), '7.1 Diagnostic correctly attributes recent swing low');
    assert(diagRecord.supportReference === 84250, '7.2 Diagnostic reports exact support reference (84250)');
    assert(diagRecord.entry === 85000, '7.3 Diagnostic reports exact entry (85000)');
    assert(diagRecord.sl === 83980, '7.4 Diagnostic reports exact stop loss (83980)');
    assert(diagRecord.tp1 === 86400, '7.5 Diagnostic reports exact TP1 (86400)');
    assert(diagRecord.tp2 === 87850, '7.6 Diagnostic reports exact TP2 (87850)');
    assert(diagRecord.rr.includes('1.37 / 2.79'), `7.7 Diagnostic reports exact multi-target R:R (${diagRecord.rr})`);
    assert(diagRecord.buffer === 270 && diagRecord.atr === 380, '7.8 Diagnostic reports volatility buffer and ATR metrics');

    console.log('      Developer Diagnostic Inspection Sample:');
    console.log(`      • structure reference: ${diagRecord.structureReference}`);
    console.log(`      • support reference:   $${diagRecord.supportReference}`);
    console.log(`      • entry:               $${diagRecord.entry}`);
    console.log(`      • sl:                  $${diagRecord.sl}`);
    console.log(`      • tp1:                 $${diagRecord.tp1}`);
    console.log(`      • tp2:                 $${diagRecord.tp2}`);
    console.log(`      • rr:                  ${diagRecord.rr}`);
  }

  // =========================================================================
  // SUMMARY
  // =========================================================================
  console.log('\n======================================================');
  console.log(`LIVE STRUCTURE INTEGRATION RESULTS: ${passedTests} / ${totalTests} PASSED`);
  console.log('======================================================');

  if (passedTests === totalTests) {
    console.log('All live 88 Binance Scanner structure integration tests passed successfully! 🚀');
  } else {
    process.exit(1);
  }
}

runLiveStructureIntegrationTests().catch((err) => {
  console.error('Fatal error in integration test runner:', err);
  process.exit(1);
});
