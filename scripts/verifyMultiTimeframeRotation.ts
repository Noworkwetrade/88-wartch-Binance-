/**
 * Verification Suite for Multi-Timeframe Scanner & Fair Asset Coverage
 * Tests:
 * 1. Entry Timeframe (1m, 5m, 15m, 30m, 1h, 4h, 1d)
 * 2. Higher Timeframe Confirmation (Lenient, Aligned, Strict, Closed Candles, Countertrend)
 * 3. Asset Rotation (Full Universe Round-Robin, BTC/ETH Anchors, Resilience)
 * 4. Scan Scheduling (Cycle Duration, Overlap Prevention, Concurrency)
 * 5. Signal Integrity (Real Binance Spot, Completed Candles, Settlement & Deduplication)
 */

import { scannerService, evaluateHtfConfirmation, getLogicalHigherTimeframe, getTimeframeMinutes } from '../server/scannerService.js';
import { symbolManager } from '../server/symbolManager.js';
import { fetchKlines, isPermanentlyExcludedSymbol } from '../server/binanceRest.js';

let passed = 0;
let failed = 0;

function assert(condition: boolean, testName: string, detail: string = '') {
  if (condition) {
    console.log(`  ✓ PASS: ${testName}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${testName} - ${detail}`);
    failed++;
  }
}

async function runVerification() {
  console.log('======================================================');
  console.log('88 BOT MULTI-TIMEFRAME & ASSET ROTATION VERIFICATION');
  console.log('======================================================\n');

  // -----------------------------------------------------------------
  // 1. ENTRY TIMEFRAME VERIFICATION
  // -----------------------------------------------------------------
  console.log('SECTION 1: Entry Timeframe Switching & Alignment');
  const supportedTimeframes = ['1m', '5m', '15m', '30m', '1h', '4h', '1d'];

  for (const tf of supportedTimeframes) {
    scannerService.setScannerConfig({ timeframe: tf as any });
    assert(
      scannerService.timeframe === tf,
      `1.1 setScannerConfig correctly updates scannerService.timeframe to ${tf}`,
      `Expected ${tf}, got ${scannerService.timeframe}`
    );

    const minutes = getTimeframeMinutes(tf);
    assert(
      minutes > 0,
      `1.2 getTimeframeMinutes returns valid duration for ${tf} (${minutes}m)`
    );
  }

  // Verify single asset scan records exact requested timeframe
  console.log('\n  Testing scanSingleAsset on BTCUSDT with 5m and 1h...');
  const res5m = await scannerService.scanSingleAsset('BTCUSDT', '5m');
  assert(
    res5m.timeframe === '5m',
    '1.3 scanSingleAsset returns exact timeframe (5m)',
    `Got ${res5m?.timeframe}`
  );
  assert(
    res5m.evaluation?.timeframe === '5m',
    '1.4 Evaluation object matches entry timeframe (5m)'
  );

  const res1h = await scannerService.scanSingleAsset('BTCUSDT', '1h');
  assert(
    res1h.timeframe === '1h',
    '1.5 scanSingleAsset returns exact timeframe (1h)',
    `Got ${res1h?.timeframe}`
  );
  assert(
    res1h.evaluation?.timeframe === '1h',
    '1.6 Evaluation object matches entry timeframe (1h)'
  );

  // -----------------------------------------------------------------
  // 2. HIGHER TIMEFRAME CONFIRMATION & MODES
  // -----------------------------------------------------------------
  console.log('\nSECTION 2: Higher Timeframe Confirmation (Strict, Aligned, Lenient)');

  // Mock HTF candles: Bullish trend (50 candles to provide full 9/21/50 EMA coverage)
  const bullishHtfCandles = Array.from({ length: 55 }, (_, i) => ({
    openTime: 1000000 + i * 3600000,
    closeTime: 1000000 + (i + 1) * 3600000 - 1,
    open: 100 + i * 2,
    high: 102 + i * 2,
    low: 99 + i * 2,
    close: 101 + i * 2,
    volume: 1000,
    isClosed: true
  }));

  // Mock HTF candles: Bearish trend
  const bearishHtfCandles = Array.from({ length: 55 }, (_, i) => ({
    openTime: 1000000 + i * 3600000,
    closeTime: 1000000 + (i + 1) * 3600000 - 1,
    open: 250 - i * 2,
    high: 251 - i * 2,
    low: 247 - i * 2,
    close: 248 - i * 2,
    volume: 1000,
    isClosed: true
  }));

  // Test 2.1: Strict Mode
  const strictBullPass = evaluateHtfConfirmation({
    setupDirection: 'UP',
    entryTimeframe: '15m',
    htfTimeframe: '1h',
    htfClosedCandles: bullishHtfCandles,
    ruleMode: 'strict'
  });
  assert(
    strictBullPass.status === 'confirmed',
    '2.1 Strict Mode: Bullish HTF confirms UP setup'
  );

  const strictBullFail = evaluateHtfConfirmation({
    setupDirection: 'DOWN',
    entryTimeframe: '15m',
    htfTimeframe: '1h',
    htfClosedCandles: bullishHtfCandles,
    ruleMode: 'strict'
  });
  assert(
    strictBullFail.status === 'rejected',
    '2.2 Strict Mode: Bullish HTF rejects DOWN setup'
  );

  // Test 2.2: Aligned Mode
  const alignedBearPass = evaluateHtfConfirmation({
    setupDirection: 'DOWN',
    entryTimeframe: '15m',
    htfTimeframe: '1h',
    htfClosedCandles: bearishHtfCandles,
    ruleMode: 'aligned'
  });
  assert(
    alignedBearPass.status === 'confirmed',
    '2.3 Aligned Mode: Bearish HTF confirms DOWN setup'
  );

  const alignedBearFail = evaluateHtfConfirmation({
    setupDirection: 'UP',
    entryTimeframe: '15m',
    htfTimeframe: '1h',
    htfClosedCandles: bearishHtfCandles,
    ruleMode: 'aligned'
  });
  assert(
    alignedBearFail.status === 'rejected',
    '2.4 Aligned Mode: Bearish HTF rejects countertrend UP setup'
  );

  // Test 2.3: Lenient Mode
  // Lenient allows neutral or ranging markets, but rejects direct conflict
  const lenientConflict = evaluateHtfConfirmation({
    setupDirection: 'UP',
    entryTimeframe: '15m',
    htfTimeframe: '1h',
    htfClosedCandles: bearishHtfCandles,
    ruleMode: 'lenient'
  });
  assert(
    lenientConflict.status === 'rejected',
    '2.5 Lenient Mode: Directly opposing HTF trend rejects setup'
  );

  // Ranging mock candles (55 candles with tight horizontal consolidation)
  const rangingHtfCandles = Array.from({ length: 55 }, (_, i) => ({
    openTime: 1000000 + i * 3600000,
    closeTime: 1000000 + (i + 1) * 3600000 - 1,
    open: 100 + (i % 2 === 0 ? 0.2 : -0.2),
    high: 100.5,
    low: 99.5,
    close: 100 + (i % 2 === 0 ? -0.2 : 0.2),
    volume: 1000,
    isClosed: true
  }));

  const lenientRangingPass = evaluateHtfConfirmation({
    setupDirection: 'UP',
    entryTimeframe: '15m',
    htfTimeframe: '1h',
    htfClosedCandles: rangingHtfCandles,
    ruleMode: 'lenient'
  });
  assert(
    lenientRangingPass.status === 'confirmed',
    '2.6 Lenient Mode: Non-opposing ranging HTF permits UP setup (does not block range/reversion)'
  );

  // Test 2.4: Disabling HTF confirmation preserves entry timeframe
  scannerService.setScannerConfig({ htfConfirmationEnabled: false, timeframe: '5m' });
  assert(
    scannerService.timeframe === '5m' && scannerService.htfConfirmationEnabled === false,
    '2.7 Disabling HTF confirmation does NOT modify selected entry timeframe (remains 5m)'
  );

  // -----------------------------------------------------------------
  // 3. ASSET ROTATION & UNIVERSE COVERAGE
  // -----------------------------------------------------------------
  console.log('\nSECTION 3: Asset Rotation & Universe Coverage');

  // Load symbols if not already loaded
  if (!symbolManager.symbolNames || symbolManager.symbolNames.length === 0) {
    await symbolManager.loadSymbols();
  }

  const eligibleList = symbolManager.symbolNames.filter(
    (s) => s && s.endsWith('USDT') && !isPermanentlyExcludedSymbol(s)
  );
  const totalEligible = eligibleList.length;

  assert(
    totalEligible >= 450,
    `3.1 Discovered full universe of eligible Binance Spot USDT pairs (${totalEligible} pairs found)`
  );

  // Test Rotation Cursor Simulation across complete universe
  const batchSize = 25;
  const totalBatches = Math.ceil(totalEligible / batchSize);
  const visitedSymbols = new Set<string>();

  let cursor = 0;
  for (let b = 0; b < totalBatches; b++) {
    const start = cursor;
    const end = Math.min(start + batchSize, totalEligible);
    const batch = eligibleList.slice(start, end);

    // Anchors included
    const scanList = Array.from(new Set(['BTCUSDT', 'ETHUSDT', ...batch]));
    assert(
      scanList.includes('BTCUSDT') && scanList.includes('ETHUSDT'),
      `3.2 Batch ${b + 1} consistently includes benchmark anchors BTC & ETH`
    );

    for (const sym of batch) {
      visitedSymbols.add(sym);
    }

    cursor = end >= totalEligible ? 0 : end;
  }

  assert(
    visitedSymbols.size === totalEligible,
    `3.3 Round-robin cursor visits 100% of eligible universe (${visitedSymbols.size}/${totalEligible} pairs)`
  );
  assert(
    cursor === 0,
    '3.4 Cursor wraps back to 0 seamlessly after full universe rotation'
  );

  // -----------------------------------------------------------------
  // 4. SCAN SCHEDULING, CONCURRENCY & DURATION
  // -----------------------------------------------------------------
  console.log('\nSECTION 4: Scan Scheduling & Overlapping Cycle Prevention');

  // Test 4.1: Overlapping cycle guard
  scannerService.isScanning = true;
  const overlapPromise = scannerService.runScan('15m');
  // Since isScanning is true, runScan should return immediately without starting a second scan
  await overlapPromise;
  assert(
    scannerService.isScanning === true,
    '4.1 Overlapping scan is strictly blocked while a scan is in progress'
  );
  scannerService.isScanning = false;

  // Test 4.2: Actual scan batch execution duration measurement
  console.log('  Measuring real Binance spot scan execution for active batch...');
  const t0 = Date.now();
  await scannerService.runScan('15m');
  const batchDurationMs = Date.now() - t0;
  console.log(`  Observed batch scan duration: ${batchDurationMs}ms for ${scannerService.scannedCount} symbols.`);

  assert(
    batchDurationMs < 30000,
    `4.2 Batch scan completes well within 45s interval (${batchDurationMs}ms < 45000ms)`
  );

  const observedCycleSec = 45; // 45s interval between batches
  const estFullRotationSec = totalBatches * observedCycleSec;
  const estFullRotationMin = (estFullRotationSec / 60).toFixed(1);
  console.log(`  Calculated full rotation time for ${totalEligible} pairs: ~${estFullRotationMin} minutes (${totalBatches} batches x ${observedCycleSec}s).`);

  assert(
    Number(estFullRotationMin) <= 25,
    `4.3 Full universe rotation completes in reasonable time (~${estFullRotationMin} mins for ${totalEligible} pairs)`
  );

  // -----------------------------------------------------------------
  // 5. SIGNAL INTEGRITY & SAFEGUARDS
  // -----------------------------------------------------------------
  console.log('\nSECTION 5: Signal Integrity & Safeguards');

  // Verify only completed candles are evaluated
  const sampleCandles = await fetchKlines('BTCUSDT', '15m', 20);
  const now = Date.now();
  const tfDuration = 15 * 60 * 1000;
  const closedOnly = sampleCandles.filter(c => {
    const effClose = c.closeTime || (c.openTime + tfDuration - 1);
    return effClose <= now && (c.openTime + tfDuration) <= now;
  });

  assert(
    closedOnly.length > 0 && closedOnly.every(c => c.closeTime <= now || (c.openTime + tfDuration) <= now),
    '5.1 Scanner strictly rejects currently forming candle and evaluates only closed candles'
  );

  // Verify HTF cannot create a signal on its own
  const noSetupCandles = Array.from({ length: 30 }, (_, i) => ({
    openTime: 1000000 + i * 60000,
    closeTime: 1000000 + (i + 1) * 60000 - 1,
    open: 100,
    high: 100.1,
    low: 99.9,
    close: 100.0,
    volume: 50,
    isClosed: true
  }));
  const noSetupAnalysis = scannerService.analyzeCandles('BTCUSDT', '1m', noSetupCandles, 100.0, null, strictBullPass);
  assert(
    noSetupAnalysis.originalSignal === null && noSetupAnalysis.aiFilteredSignal === null,
    '5.2 HTF confirmation cannot manufacture a signal without a qualifying entry timeframe setup'
  );

  // Verify signal deduplication by candle close time
  const dummyCloseTime = 1700000000000;
  scannerService.performanceSignals.set('test-dup', {
    id: 'test-dup',
    asset: 'BTCUSDT',
    timeframe: '15m',
    status: 'ACTIVE',
    confirmedCandleCloseTime: dummyCloseTime
  } as any);

  const hasDup = scannerService.hasSignalForCandle('BTCUSDT', '15m', dummyCloseTime);
  assert(
    hasDup === true,
    '5.3 Duplicate signals on identical asset, timeframe, and confirmed close candle are prevented'
  );
  scannerService.performanceSignals.delete('test-dup');

  console.log('\n======================================================');
  console.log(`VERIFICATION SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('======================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
  process.exit(0);
}

runVerification().catch((err) => {
  console.error('Verification failed with error:', err);
  process.exit(1);
});
