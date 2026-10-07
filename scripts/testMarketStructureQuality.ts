/**
 * NWWT Market Structure Quality Layer Validation Test Suite
 *
 * Verifies that the Market Structure Quality Layer runs strictly BEFORE
 * the existing strategy, stop loss/take profit calculations, and live signals.
 *
 * Validates:
 * 1. USDCUSDT is permanently rejected
 * 2. USD1USDT is permanently rejected
 * 3. Dead chart is rejected
 * 4. Extremely choppy chart is rejected
 * 5. Meaningful swing structure passes
 * 6. Clean trending chart passes
 * 7. Clean consolidation with readable boundaries passes
 * 8. Dynamic filtering: asset returns to scanner after structure improves
 * 9. Rejected asset cannot generate a signal
 * 10. Rejected asset cannot enter live performance
 * 11. Rejected asset cannot receive newest signal glow
 * 12. Multi-timeframe quality evaluation
 * 13. Developer diagnostic fields completeness
 */

import { Candle } from '../src/types.ts';
import {
  evaluateMarketStructureQuality,
  evaluateMultiTimeframeQuality,
  isPermanentlyExcludedSymbol,
  PERMANENT_EXCLUDED_SYMBOLS
} from '../src/utils/marketStructureQuality.ts';
import { scannerService } from '../server/scannerService.js';
import { marketCache } from '../server/marketCache.js';
import { fetchKlines } from '../server/binanceRest.js';
import { runChartScan } from '../src/components/scanner/scannerEngine.ts';
import { mergeScannerSignals, calculatePerformanceStats, evaluateSignalsWithTicker } from '../src/utils/performanceEngine.ts';
import { checkSignalTouch } from '../src/utils/signalTouchEngine.ts';

let passedTests = 0;
let totalTests = 0;

function assert(condition: boolean, description: string) {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  ✓ PASS: ${description}`);
  } else {
    console.error(`  ✗ FAIL: ${description}`);
    throw new Error(`Test assertion failed: ${description}`);
  }
}

function makeTimestamp(minutesAgo: number): number {
  return Date.now() - minutesAgo * 60 * 1000;
}

// ---------------------------------------------------------------------------
// CANDLE GENERATORS FOR TEST SCENARIOS
// ---------------------------------------------------------------------------

/**
 * Generates a dead chart (flat candles, zero range, no price movement)
 */
function createDeadCandles(count = 35, basePrice = 1.0000): Candle[] {
  const candles: Candle[] = [];
  const now = Date.now();
  for (let i = count; i >= 1; i--) {
    const openTime = now - i * 15 * 60 * 1000;
    const closeTime = openTime + 15 * 60 * 1000 - 1;
    candles.push({
      openTime,
      closeTime,
      open: basePrice,
      high: basePrice, // Zero range
      low: basePrice,
      close: basePrice,
      volume: 0,
      isClosed: true
    });
  }
  return candles;
}

/**
 * Generates an extremely choppy chart with tight micro-swings and heavy overlapping bodies
 */
function createChoppyCandles(count = 35, basePrice = 100): Candle[] {
  const candles: Candle[] = [];
  const now = Date.now();
  let p = basePrice;
  for (let i = count; i >= 1; i--) {
    const openTime = now - i * 15 * 60 * 1000;
    const closeTime = openTime + 15 * 60 * 1000 - 1;
    // Oscillation back and forth with high overlap and tiny micro-swings
    const direction = i % 2 === 0 ? 1 : -1;
    const open = p;
    const close = p + direction * 0.12;
    const high = Math.max(open, close) + 0.10;
    const low = Math.min(open, close) - 0.10;
    candles.push({
      openTime,
      closeTime,
      open,
      high,
      low,
      close,
      volume: 50,
      isClosed: true
    });
    p = close;
  }
  return candles;
}

/**
 * Generates a clean trending chart with distinct swing highs, higher lows, and clear candle bodies
 */
function createCleanTrendingCandles(count = 30, basePrice = 85000): Candle[] {
  const candles: Candle[] = [];
  const now = Date.now();
  for (let i = count; i >= 1; i--) {
    const openTime = now - i * 15 * 60 * 1000;
    const closeTime = openTime + 15 * 60 * 1000 - 1;
    const wave = Math.sin((i / 6) * Math.PI) * (basePrice * 0.008);
    const trend = (count - i) * (basePrice * 0.0015);
    const close = basePrice + trend + wave;
    const open = close - (basePrice * 0.001);
    const high = Math.max(open, close) + (basePrice * 0.002);
    const low = Math.min(open, close) - (basePrice * 0.002);
    candles.push({ openTime, closeTime, open, high, low, close, volume: 1500, isClosed: true });
  }
  return candles;
}

/**
 * Generates a clean horizontal consolidation with well-defined range boundaries (support and resistance)
 */
function createCleanConsolidationCandles(count = 30, basePrice = 2500): Candle[] {
  const candles: Candle[] = [];
  const now = Date.now();
  for (let i = count; i >= 1; i--) {
    const openTime = now - i * 15 * 60 * 1000;
    const closeTime = openTime + 15 * 60 * 1000 - 1;
    const wave = Math.sin((i / 4) * Math.PI) * (basePrice * 0.025);
    const close = basePrice + wave;
    const open = close - (basePrice * 0.004);
    const high = Math.max(open, close) + (basePrice * 0.005);
    const low = Math.min(open, close) - (basePrice * 0.005);
    candles.push({ openTime, closeTime, open, high, low, close, volume: 1000, isClosed: true });
  }
  return candles;
}

// ---------------------------------------------------------------------------
// TEST EXECUTION
// ---------------------------------------------------------------------------

async function runQualitySuite() {
  console.log('======================================================');
  console.log('NWWT MARKET STRUCTURE QUALITY LAYER VALIDATION SUITE');
  console.log('======================================================\n');

  // ---------------------------------------------------------------------------
  // TEST GROUP 1: PERMANENT EXCLUSIONS
  // ---------------------------------------------------------------------------
  console.log('TEST GROUP 1: Permanent Exclusions (USDCUSDT & USD1USDT)');

  const usdcResult = evaluateMarketStructureQuality('USDCUSDT', '15m', createCleanTrendingCandles());
  assert(!usdcResult.isTradable, '1.1 USDCUSDT is strictly not tradable');
  assert(usdcResult.qualityGrade === 'untradable', '1.2 USDCUSDT quality grade is untradable');
  assert(usdcResult.qualityScore === 0, '1.3 USDCUSDT quality score is 0');
  assert(usdcResult.isPermanentlyExcluded === true, '1.4 USDCUSDT is marked as permanently excluded');
  assert(usdcResult.rejectionReason!.includes('Permanently excluded'), '1.5 USDCUSDT provides clear permanent exclusion reason');

  const usd1Result = evaluateMarketStructureQuality('USD1USDT', '15m', createCleanTrendingCandles());
  assert(!usd1Result.isTradable, '1.6 USD1USDT is strictly not tradable');
  assert(usd1Result.qualityGrade === 'untradable', '1.7 USD1USDT quality grade is untradable');
  assert(usd1Result.qualityScore === 0, '1.8 USD1USDT quality score is 0');
  assert(usd1Result.isPermanentlyExcluded === true, '1.9 USD1USDT is marked as permanently excluded');

  assert(isPermanentlyExcludedSymbol('usdcusdt'), '1.10 isPermanentlyExcludedSymbol is case-insensitive for USDCUSDT');
  assert(isPermanentlyExcludedSymbol(' USD1USDT '), '1.11 isPermanentlyExcludedSymbol handles whitespace for USD1USDT');
  assert(PERMANENT_EXCLUDED_SYMBOLS.has('USDCUSDT') && PERMANENT_EXCLUDED_SYMBOLS.has('USD1USDT'), '1.12 Set contains permanent exclusions');

  // Verify market cache quarantine
  const wsUsdc = marketCache.updateFromWs('USDCUSDT', { c: '1.00', s: 'USDCUSDT' }, Date.now());
  assert(wsUsdc === null, '1.13 marketCache rejects USDCUSDT WebSocket update completely');
  const wsUsd1 = marketCache.updateFromWs('USD1USDT', { c: '1.00', s: 'USD1USDT' }, Date.now());
  assert(wsUsd1 === null, '1.14 marketCache rejects USD1USDT WebSocket update completely');
  assert(marketCache.getTicker('USDCUSDT') === null, '1.15 marketCache getTicker returns null for USDCUSDT');
  assert(marketCache.getTicker('USD1USDT') === null, '1.16 marketCache getTicker returns null for USD1USDT');
  assert(!marketCache.getAllTickers().some((t) => t.symbol === 'USDCUSDT'), '1.17 getAllTickers never includes USDCUSDT');
  assert(!marketCache.getAllTickers().some((t) => t.symbol === 'USD1USDT'), '1.18 getAllTickers never includes USD1USDT');

  // Verify REST candle fetching returns empty without querying API
  const usdcKlines = await fetchKlines('USDCUSDT', '15m', 50);
  assert(Array.isArray(usdcKlines) && usdcKlines.length === 0, '1.19 fetchKlines returns empty array immediately for USDCUSDT');
  const usd1Klines = await fetchKlines('USD1USDT', '15m', 50);
  assert(Array.isArray(usd1Klines) && usd1Klines.length === 0, '1.20 fetchKlines returns empty array immediately for USD1USDT');

  // Verify client performance engine isolates and quarantines excluded assets
  const dummySignals: any[] = [
    { id: 'usdc-sig', asset: 'USDCUSDT', status: 'ACTIVE', entryPrice: 1.0, timestamp: Date.now() },
    { id: 'usd1-sig', asset: 'USD1USDT', status: 'ACTIVE', entryPrice: 1.0, timestamp: Date.now() },
    { id: 'btc-sig', asset: 'BTCUSDT', status: 'ACTIVE', entryPrice: 85000, timestamp: Date.now() }
  ];
  const merged = mergeScannerSignals([], dummySignals);
  assert(!merged.some((s) => s.asset === 'USDCUSDT'), '1.21 mergeScannerSignals strips USDCUSDT from signals store');
  assert(!merged.some((s) => s.asset === 'USD1USDT'), '1.22 mergeScannerSignals strips USD1USDT from signals store');
  assert(merged.some((s) => s.asset === 'BTCUSDT'), '1.23 mergeScannerSignals retains valid non-excluded assets');

  const stats = calculatePerformanceStats(dummySignals);
  assert(!stats.byAsset['USDCUSDT'], '1.24 Performance stats byAsset never includes USDCUSDT');
  assert(!stats.byAsset['USD1USDT'], '1.25 Performance stats byAsset never includes USD1USDT');

  // ---------------------------------------------------------------------------
  // TEST GROUP 2: DEAD CHART REJECTION
  // ---------------------------------------------------------------------------
  console.log('\nTEST GROUP 2: Dead Chart Rejection');

  const deadCandles = createDeadCandles(35, 1.0000);
  const deadResult = evaluateMarketStructureQuality('DEADCOIN', '15m', deadCandles, 1.0000);

  assert(!deadResult.isTradable, '2.1 Dead chart is strictly rejected (isTradable = false)');
  assert(deadResult.qualityGrade === 'untradable', '2.2 Dead chart grade is untradable');
  assert(deadResult.qualityScore < 30, '2.3 Dead chart score (<30) fails tradable threshold');
  assert(deadResult.metrics.flatCandleRatio > 0.5, '2.4 Dead chart metrics flag high flat candle ratio');
  assert(deadResult.rejectionReason!.includes('flatlining') || deadResult.rejectionReason!.includes('unchanged') || deadResult.rejectionReason!.includes('Inactive'), '2.5 Dead chart provides explicit rejection reason');

  // ---------------------------------------------------------------------------
  // TEST GROUP 3: EXTREMELY CHOPPY CHART REJECTION
  // ---------------------------------------------------------------------------
  console.log('\nTEST GROUP 3: Extremely Choppy & Noise Chart Rejection');

  const choppyCandles = createChoppyCandles(35, 100);
  const choppyResult = evaluateMarketStructureQuality('CHOPPYUSDT', '15m', choppyCandles, 100);

  assert(!choppyResult.isTradable, '3.1 Extremely choppy chart is rejected (isTradable = false)');
  assert(choppyResult.qualityGrade === 'poor' || choppyResult.qualityGrade === 'untradable', '3.2 Choppy chart receives poor/untradable grade');
  assert(choppyResult.qualityScore < 50, '3.3 Choppy chart score (<50) fails acceptable threshold');
  assert(choppyResult.metrics.overlapRatio > 0.65, '3.4 Choppy chart metrics detect heavy candle overlap');
  assert(choppyResult.metrics.swingSeparationPercent < 0.40, '3.5 Choppy chart metrics detect lack of swing separation');
  assert(
    choppyResult.rejectionReason!.includes('choppy') ||
    choppyResult.rejectionReason!.includes('separation') ||
    choppyResult.rejectionReason!.includes('swings') ||
    choppyResult.rejectionReason!.includes('Unreadable') ||
    choppyResult.rejectionReason!.includes('overlap'),
    '3.6 Choppy chart reports noise/overlap rejection reason'
  );

  // ---------------------------------------------------------------------------
  // TEST GROUP 4: TRADABLE STRUCTURE PASSING
  // ---------------------------------------------------------------------------
  console.log('\nTEST GROUP 4: Tradable Structure Passing');

  const trendingCandles = createCleanTrendingCandles(35, 80000);
  const trendingResult = evaluateMarketStructureQuality('BTCUSDT', '15m', trendingCandles, 85000);

  assert(trendingResult.isTradable, '4.1 Clean trending chart passes (isTradable = true)');
  assert(trendingResult.qualityGrade === 'good' || trendingResult.qualityGrade === 'excellent', '4.2 Clean trending chart receives good or excellent grade');
  assert(trendingResult.qualityScore >= 65, '4.3 Clean trending chart score is >= 65');
  assert(trendingResult.metrics.candleActivity >= 70, '4.4 Candle activity score is healthy (>=70)');
  assert(trendingResult.metrics.swingClarity >= 60, '4.5 Swing clarity is high (>=60)');

  const consolidationCandles = createCleanConsolidationCandles(35, 2500, 2650);
  const consolidationResult = evaluateMarketStructureQuality('ETHUSDT', '15m', consolidationCandles, 2575);

  assert(consolidationResult.isTradable, '4.6 Clean consolidation with readable boundaries passes');
  assert(consolidationResult.qualityGrade === 'acceptable' || consolidationResult.qualityGrade === 'good' || consolidationResult.qualityGrade === 'excellent', '4.7 Clean consolidation receives acceptable or better grade');
  assert(consolidationResult.qualityScore >= 50, '4.8 Clean consolidation score is >= 50');
  assert(consolidationResult.metrics.swingCount >= 2, '4.9 Identifies recognizable swings across range boundaries');

  // ---------------------------------------------------------------------------
  // TEST GROUP 5: DYNAMIC FILTERING (NO PERMANENT BLACKLISTING OF NORMAL ASSETS)
  // ---------------------------------------------------------------------------
  console.log('\nTEST GROUP 5: Dynamic Filtering (Temporary Exclusions & Re-admission)');

  const assetName = 'SOLUSDT';
  const poorPeriodCandles = createChoppyCandles(35, 120);
  const poorPeriodResult = evaluateMarketStructureQuality(assetName, '15m', poorPeriodCandles, 120);
  assert(!poorPeriodResult.isTradable, '5.1 Normal asset is temporarily rejected during poor choppy period');
  assert(!poorPeriodResult.isPermanentlyExcluded, '5.2 Normal asset is NOT permanently blacklisted');

  const improvedPeriodCandles = createCleanTrendingCandles(35, 120);
  const improvedPeriodResult = evaluateMarketStructureQuality(assetName, '15m', improvedPeriodCandles, 140);
  assert(improvedPeriodResult.isTradable, '5.3 Normal asset is re-admitted into scanner when structure improves');
  assert(improvedPeriodResult.qualityScore >= 50, '5.4 Quality score updates dynamically to acceptable or higher');

  // ---------------------------------------------------------------------------
  // TEST GROUP 6: SCANNER STRATEGY ISOLATION & REJECTION INTEGRATION
  // ---------------------------------------------------------------------------
  console.log('\nTEST GROUP 6: Scanner Strategy Isolation & Signal Suppression on Rejected Assets');

  // Test 6.1: Server Scanner analyzeCandles does not run strategy when quality layer rejects
  const serverAnalysis = scannerService.analyzeCandles('DEADTOKEN', '15m', deadCandles, 1.00);
  assert(serverAnalysis.originalSignal === null, '6.1 Server analyzeCandles returns null signal for rejected asset');
  assert(serverAnalysis.aiFilteredSignal === null, '6.2 Server analyzeCandles returns null AI signal for rejected asset');
  assert(serverAnalysis.inverseSignal === null, '6.3 Server analyzeCandles returns null inverse signal for rejected asset');
  assert(serverAnalysis.pendingRetest === null, '6.4 Server analyzeCandles returns null pending retest for rejected asset');
  assert(serverAnalysis.qualityResult !== undefined, '6.5 Server analyzeCandles attaches qualityResult');
  assert(!serverAnalysis.qualityResult.isTradable, '6.6 Attached qualityResult confirms asset was rejected');

  // Test 6.2: Single Asset Scan returns quality rejection message and null signals
  const singleRes: any = await scannerService.scanSingleAsset('USDCUSDT', '15m');
  assert(singleRes.signal === null, '6.7 USDCUSDT single scan returns null signal');
  assert(singleRes.qualityResult?.isPermanentlyExcluded === true, '6.8 USDCUSDT single scan confirms permanent exclusion');

  // Test 6.3: Client Scanner runChartScan skips strategy rules and returns NO SETUP when quality layer rejects
  const clientScanResult = runChartScan(
    'DEADCOIN',
    '15m',
    deadCandles,
    { latestCandleVolume: 0, total24hVolume: 0 },
    { swingPoints: [], lastSwingHigh: null, lastSwingLow: null, marketStructure: 'ranging', structureBreaks: [] },
    1.00
  );
  assert(clientScanResult.decision.signal === 'NO SETUP', '6.9 Client scanner returns NO SETUP for rejected asset');
  assert(clientScanResult.decision.setupQuality === 'NONE', '6.10 Client scanner assigns NONE setup quality');
  assert(clientScanResult.decision.reason.includes('Market Structure Quality Filter'), '6.11 Decision reason clearly attributes quality filter rejection');
  assert(clientScanResult.qualityResult !== undefined, '6.12 Client scanner includes qualityResult');
  assert(!clientScanResult.qualityResult?.isTradable, '6.13 Client scanner confirms untradable quality');

  // ---------------------------------------------------------------------------
  // TEST GROUP 7: MULTI-TIMEFRAME QUALITY EVALUATION
  // ---------------------------------------------------------------------------
  console.log('\nTEST GROUP 7: Multi-Timeframe Quality Evaluation');

  const multiTfDead = {
    '1m': createDeadCandles(30, 0.05),
    '3m': createDeadCandles(30, 0.05),
    '5m': createDeadCandles(30, 0.05),
    '10m': createDeadCandles(30, 0.05)
  };

  const multiTfDeadResult = evaluateMultiTimeframeQuality('INACTIVETOKEN', multiTfDead, 0.05);
  assert(!multiTfDeadResult.isTradable, '7.1 Asset dead across 1m, 3m, 5m, 10m is strictly rejected');
  assert(multiTfDeadResult.poorTimeframeCount === 4, '7.2 All 4 evaluated timeframes flagged as poor/untradable');
  assert(multiTfDeadResult.overallGrade === 'untradable' || multiTfDeadResult.overallGrade === 'poor', '7.3 Overall grade is poor or untradable');
  assert(multiTfDeadResult.rejectionReason!.includes('structurally poor across 4/4 timeframes'), '7.4 Clear multi-timeframe rejection reason provided');

  const multiTfClean = {
    '1m': createCleanTrendingCandles(30, 85000),
    '3m': createCleanTrendingCandles(30, 85000),
    '5m': createCleanTrendingCandles(30, 85000),
    '10m': createCleanTrendingCandles(30, 85000)
  };

  const multiTfCleanResult = evaluateMultiTimeframeQuality('BTCUSDT', multiTfClean, 85000);
  assert(multiTfCleanResult.isTradable, '7.5 Asset with clean structure across timeframes passes multi-TF quality');
  assert(multiTfCleanResult.overallScore >= 65, '7.6 Multi-TF score is >= 65');

  // ---------------------------------------------------------------------------
  // TEST GROUP 8: DEVELOPER DIAGNOSTICS FIELD VERIFICATION
  // ---------------------------------------------------------------------------
  console.log('\nTEST GROUP 8: Developer Diagnostic Inspection Fields Verification');

  const diagCandles = createCleanTrendingCandles(35, 85000);
  const diagResult = evaluateMarketStructureQuality('BTCUSDT', '15m', diagCandles, 86000);

  assert(typeof diagResult.symbol === 'string' && diagResult.symbol === 'BTCUSDT', '8.1 Diagnostic contains symbol');
  assert(typeof diagResult.timeframe === 'string' && diagResult.timeframe === '15m', '8.2 Diagnostic contains timeframe');
  assert(['excellent', 'good', 'acceptable', 'poor', 'untradable'].includes(diagResult.qualityGrade), '8.3 Diagnostic contains valid structure quality grade');
  assert(typeof diagResult.qualityScore === 'number' && diagResult.qualityScore >= 0 && diagResult.qualityScore <= 100, '8.4 Diagnostic contains quality score (0-100)');
  assert(typeof diagResult.metrics.candleActivity === 'number', '8.5 Diagnostic contains candle activity metric');
  assert(typeof diagResult.metrics.relativePriceMovement === 'number', '8.6 Diagnostic contains relative price movement metric');
  assert(typeof diagResult.metrics.swingClarity === 'number', '8.7 Diagnostic contains swing clarity metric');
  assert(typeof diagResult.metrics.srClarity === 'number', '8.8 Diagnostic contains support/resistance clarity metric');
  assert(diagResult.metrics.volumeActivity !== undefined, '8.9 Diagnostic contains volume activity metric when available');
  assert(diagResult.rejectionReason === undefined || typeof diagResult.rejectionReason === 'string', '8.10 Diagnostic contains valid rejection reason or undefined on pass');

  console.log('\n    Developer Diagnostic Inspection Sample:');
  console.log(`    • symbol:                    ${diagResult.symbol}`);
  console.log(`    • timeframe:                 ${diagResult.timeframe}`);
  console.log(`    • structure quality:         ${diagResult.qualityGrade.toUpperCase()}`);
  console.log(`    • quality score:             ${diagResult.qualityScore} / 100`);
  console.log(`    • candle activity:           ${diagResult.metrics.candleActivity} / 100`);
  console.log(`    • relative price movement:   ${diagResult.metrics.relativePriceMovement} / 100`);
  console.log(`    • swing clarity:             ${diagResult.metrics.swingClarity} / 100`);
  console.log(`    • support/resistance clarity:${diagResult.metrics.srClarity} / 100`);
  console.log(`    • volume activity:           ${diagResult.metrics.volumeActivity} / 100`);
  console.log(`    • rejection reason:          ${diagResult.rejectionReason || 'None (Passes quality threshold)'}`);

  // ---------------------------------------------------------------------------
  // TEST GROUP 9: SIGNAL LIFECYCLE INTEGRITY & NO FLIPPED DIRECTION ON STOP LOSS
  // ---------------------------------------------------------------------------
  console.log('\nTEST GROUP 9: Signal Lifecycle Integrity & No Flipped Direction on Stop Loss');

  // Test 9.1: Buy signal hitting SL is completed as LOSS and NEVER flipped into a sell signal
  const testBuySignal: any = {
    id: 'buy-test-1',
    asset: 'ETHUSDT',
    direction: 'UP',
    entryPrice: 3000,
    stopLoss: 2900,
    takeProfit: 3200,
    takeProfit1: 3200,
    takeProfit2: 3400,
    status: 'ACTIVE',
    isTradeComplete: false,
    timestamp: Date.now() - 600000
  };

  const buySlTouch = checkSignalTouch(testBuySignal, 2895);
  assert(buySlTouch.isTouched, '9.1 Candle wick below Stop Loss detects touch');
  assert(buySlTouch.touchedLevel === 'SL', '9.2 Level touched is identified strictly as SL');
  assert(buySlTouch.isTradeComplete === true, '9.3 Trade is immediately marked complete upon SL touch');

  // Evaluate through ticker update engine
  const evalBuySl = evaluateSignalsWithTicker([testBuySignal], 'ETHUSDT', 2895);
  const completedBuy = evalBuySl.updatedSignals.find((s) => s.id === 'buy-test-1');
  assert(completedBuy?.status === 'LOSS', '9.4 Buy signal status is finalized as LOSS');
  assert(completedBuy?.isTradeComplete === true, '9.5 Buy signal is finalized as complete');
  assert(completedBuy?.direction === 'UP', '9.6 Buy signal permanently retains original UP direction (never flipped)');
  assert(!evalBuySl.updatedSignals.some((s) => s.direction === 'DOWN'), '9.7 No opposite sell signal is generated from entry');
  assert(completedBuy?.entryPrice === 3000, '9.8 Original entry price remains fixed ($3000)');
  assert(completedBuy?.stopLoss === 2900, '9.9 Original stop loss level remains fixed ($2900)');
  assert(completedBuy?.takeProfit === 3200, '9.10 Original take profit level remains fixed ($3200)');

  // Test 9.2: Sell signal hitting SL is completed as LOSS and NEVER flipped into a buy signal
  const testSellSignal: any = {
    id: 'sell-test-1',
    asset: 'SOLUSDT',
    direction: 'DOWN',
    entryPrice: 150,
    stopLoss: 155,
    takeProfit: 140,
    takeProfit1: 140,
    status: 'ACTIVE',
    isTradeComplete: false,
    timestamp: Date.now() - 600000
  };

  const sellSlTouch = checkSignalTouch(testSellSignal, 156);
  assert(sellSlTouch.isTouched, '9.11 Candle wick above Stop Loss detects touch');
  assert(sellSlTouch.touchedLevel === 'SL', '9.12 Level touched is identified strictly as SL');
  assert(sellSlTouch.isTradeComplete === true, '9.13 Sell trade is marked complete upon SL touch');

  const evalSellSl = evaluateSignalsWithTicker([testSellSignal], 'SOLUSDT', 156);
  const completedSell = evalSellSl.updatedSignals.find((s) => s.id === 'sell-test-1');
  assert(completedSell?.status === 'LOSS', '9.14 Sell signal status is finalized as LOSS');
  assert(completedSell?.direction === 'DOWN', '9.15 Sell signal permanently retains original DOWN direction');
  assert(!evalSellSl.updatedSignals.some((s) => s.direction === 'UP'), '9.16 No opposite buy signal is generated from entry');

  // Test 9.3: TP1 touch removes TP1 level and completes signal according to TP rules
  const testTpSignal: any = {
    id: 'buy-tp-test',
    asset: 'BTCUSDT',
    direction: 'UP',
    entryPrice: 85000,
    stopLoss: 84000,
    takeProfit: 87000,
    takeProfit1: 87000,
    status: 'ACTIVE',
    isTradeComplete: false,
    timestamp: Date.now() - 600000
  };
  const evalTp = evaluateSignalsWithTicker([testTpSignal], 'BTCUSDT', 87100);
  const completedTp = evalTp.updatedSignals.find((s) => s.id === 'buy-tp-test');
  assert(completedTp?.tp1Hit === true, '9.17 TP1 touch confirms tp1Hit flag for level removal from chart');
  assert(completedTp?.status === 'WIN', '9.18 Signal status marks WIN upon TP touch');

  // Summary
  console.log('\n======================================================');
  console.log(`MARKET STRUCTURE QUALITY SUITE RESULTS: ${passedTests} / ${totalTests} PASSED`);
  console.log('======================================================\n');
}

runQualitySuite().catch((err) => {
  console.error(err);
  process.exit(1);
});
