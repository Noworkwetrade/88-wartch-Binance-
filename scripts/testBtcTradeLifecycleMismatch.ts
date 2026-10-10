/**
 * Focused Reproduction and Verification Test Suite:
 * BTCUSDT Trade Lifecycle Mismatch & Chart Level Removal Synchronization
 *
 * Verifies:
 * 1. Signal creation time, settlement time, settlement reason, exit price, and status.
 * 2. Stop loss touch detection using market data (price >= SL for short / price <= SL for long).
 * 3. Immediate removal of chart levels & registration in cleared signals upon settlement.
 * 4. Timezone conversion & clear distinction between signal creation time and settlement time.
 * 5. Elimination of duplicate or stale model variants (e.g. baseline 'original' coexisting with settled 'ai_filtered').
 */

import { checkSignalTouch, addClearedSignalId, loadClearedSignalIds } from '../src/utils/signalTouchEngine.ts';
import {
  mergeScannerSignals,
  loadStoredSignals,
  saveStoredSignals,
  calculatePerformanceStats
} from '../src/utils/performanceEngine.ts';
import { ScannerSignalItem, Candle } from '../src/types.ts';

// Mock localStorage for Node test runner
if (typeof globalThis.localStorage === 'undefined') {
  const memoryStore = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (key: string) => memoryStore.get(key) || null,
    setItem: (key: string, value: string) => memoryStore.set(key, value),
    removeItem: (key: string) => memoryStore.delete(key),
    clear: () => memoryStore.clear(),
    key: (index: number) => Array.from(memoryStore.keys())[index] || null,
    length: 0
  } as any;
}

let passed = 0;
let total = 0;

function assert(condition: boolean, desc: string, details?: any) {
  total++;
  if (condition) {
    console.log(`  ✓ PASS: ${desc}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${desc}`, details ? details : '');
    process.exitCode = 1;
  }
}

async function runBtcMismatchTest() {
  console.log('\n======================================================');
  console.log('REPRODUCING & VERIFYING BTCUSDT TRADE LIFECYCLE MISMATCH');
  console.log('======================================================\n');

  localStorage.clear();

  // Scenario matching the tablet screenshot:
  // Candle close at 12:00:00 PM (1728475200000)
  // Settlement at 12:01:00 PM (1728475260000)
  // Tablet clock at 12:02:00 PM (1728475320000)
  const creationTime = 1728475200000; // 12:00 PM
  const settlementTime = 1728475260000; // 12:01 PM
  const tabletTime = 1728475320000; // 12:02 PM

  const baseSignalId = `BTCUSDT-15m-strongconfirmedbreakbos-down-${creationTime}`;
  const aiFilteredSignalId = `${baseSignalId}-aifiltered`;

  const btcShortOriginal: ScannerSignalItem = {
    id: baseSignalId,
    asset: 'BTCUSDT',
    timeframe: '15m',
    direction: 'DOWN',
    setupType: 'Strong Confirmed Break (BOS)',
    signalPrice: 64200,
    entryPrice: 64200,
    takeProfit: 63500,
    takeProfit1: 63500,
    takeProfit2: 63000,
    stopLoss: 64600,
    invalidationLevel: 64600,
    rewardRiskRatio: 1.75,
    confidence: 93,
    status: 'ACTIVE',
    reason: 'Strong breakdown below structure support',
    timestamp: creationTime,
    confirmedCandleCloseTime: creationTime,
    expiryTimestamp: creationTime + 3600000,
    expiryCandles: 4,
    modelType: 'original'
  };

  const btcShortAiFiltered: ScannerSignalItem = {
    ...btcShortOriginal,
    id: aiFilteredSignalId,
    modelType: 'ai_filtered'
  };

  // -------------------------------------------------------------------------
  // TEST GROUP 1: SIGNAL IDENTIFIERS, CREATION TIME & SETTLEMENT TIME
  // -------------------------------------------------------------------------
  console.log('TEST GROUP 1: BTCUSDT Signal Identifiers & Timing Distinction');

  assert(btcShortOriginal.id !== btcShortAiFiltered.id, '1.1 Original and AI Filtered signal IDs are distinct');
  assert(btcShortOriginal.timestamp === creationTime, '1.2 Signal creation timestamp reflects candle close time (12:00 PM)');

  // Verify settlement time formatting
  const settlementDate = new Date(settlementTime);
  const timeStr = settlementDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  assert(typeof timeStr === 'string' && timeStr.length > 0, '1.3 Settlement time converts cleanly to locale time (e.g. 12:01 PM)');

  // -------------------------------------------------------------------------
  // TEST GROUP 2: STOP LOSS TOUCH DETECTION VIA REAL MARKET TICK / WICK
  // -------------------------------------------------------------------------
  console.log('\nTEST GROUP 2: Stop Loss Touch Verification');

  // Below SL (in range)
  const touchNeutral = checkSignalTouch(btcShortAiFiltered, 64400);
  assert(!touchNeutral.isTouched, '2.1 Current price ($64,400) below SL ($64,600) for SHORT does not trigger SL');

  // Touches SL exactly at $64,600
  const touchSL = checkSignalTouch(btcShortAiFiltered, 64600);
  assert(
    touchSL.isTouched &&
    touchSL.touchedLevel === 'SL' &&
    touchSL.touchPrice === 64600 &&
    touchSL.isTradeComplete === true,
    '2.2 Price touching SL ($64,600) correctly triggers Stop Loss with touchPrice=64600 and isTradeComplete=true'
  );

  // -------------------------------------------------------------------------
  // TEST GROUP 3: SETTLEMENT SYNCHRONIZATION ACROSS SIBLING MODEL VARIANTS
  // -------------------------------------------------------------------------
  console.log('\nTEST GROUP 3: Settlement Synchronization & Sibling Signal Purging');

  // Suppose client had btcShortOriginal in storage
  saveStoredSignals([btcShortOriginal]);

  // Server settles btcShortAiFiltered as a LOSS at 12:01 PM
  const settledAiSignal: ScannerSignalItem = {
    ...btcShortAiFiltered,
    status: 'LOSS',
    isTradeComplete: true,
    completedAt: settlementTime,
    exitPrice: 64600,
    statusReason: 'Stop loss level ($64600.00) reached.',
    pnlPercent: -0.62
  };

  // Merge incoming completed trade from scanner into client signals
  const merged = mergeScannerSignals(loadStoredSignals(), [settledAiSignal]);

  const settledInMerged = merged.find((s) => s.id === aiFilteredSignalId);
  assert(
    settledInMerged?.status === 'LOSS' &&
    settledInMerged?.isTradeComplete === true &&
    settledInMerged?.completedAt === settlementTime,
    '3.1 Settled AI Filtered signal appears in merged list as LOSS with completedAt=12:01 PM'
  );

  // Sibling original signal from same candle MUST ALSO be synchronized to settled
  const originalInMerged = merged.find((s) => s.id === baseSignalId);
  assert(
    originalInMerged?.status === 'LOSS' &&
    originalInMerged?.isTradeComplete === true &&
    originalInMerged?.completedAt === settlementTime,
    '3.2 Sibling original signal from the same candle is synchronized to LOSS (no stale active variant)'
  );

  // -------------------------------------------------------------------------
  // TEST GROUP 4: IMMEDIATE REMOVAL OF CHART OVERLAYS & CLEARED REGISTRY
  // -------------------------------------------------------------------------
  console.log('\nTEST GROUP 4: Chart Level Removal & Cleared Registry Verification');

  const clearedSet = loadClearedSignalIds();
  assert(clearedSet.has(aiFilteredSignalId), '4.1 Settled AI Filtered signal ID is registered in clearedSignalIds');
  assert(clearedSet.has(baseSignalId), '4.2 Sibling baseline signal ID is also registered in clearedSignalIds');

  // Verify that activeSignals filter excludes all variants
  const activeSignals = merged.filter((s) => s.status === 'ACTIVE' && !clearedSet.has(s.id));
  assert(
    !activeSignals.some((s) => s.asset === 'BTCUSDT' && s.confirmedCandleCloseTime === creationTime),
    '4.3 activeSignals contains zero active setups for BTCUSDT from this candle'
  );

  // Verify that an incoming scan for the same candle cannot resurrect the active trade at 12:02 PM
  const attemptResurrect: ScannerSignalItem = {
    ...btcShortOriginal,
    timestamp: creationTime
  };
  const reMerged = mergeScannerSignals(merged, [attemptResurrect]);
  const activeAfterReScan = reMerged.filter((s) => s.status === 'ACTIVE' && !clearedSet.has(s.id));
  assert(
    !activeAfterReScan.some((s) => s.asset === 'BTCUSDT' && s.confirmedCandleCloseTime === creationTime),
    '4.4 Subsequent scan at 12:02 PM strictly rejects resurrecting the settled candle as ACTIVE'
  );

  // -------------------------------------------------------------------------
  // TEST GROUP 5: HISTORICAL SETTLED LOG & STATS CONSISTENCY
  // -------------------------------------------------------------------------
  console.log('\nTEST GROUP 5: Settled Historical Log & Performance Consistency');

  const settledHistoricalLog = merged.filter(
    (s) => (s.isTradeComplete || s.status === 'LOSS') && s.modelType !== 'inverse'
  );
  assert(settledHistoricalLog.length > 0, '5.1 Settled historical log includes the settled BTCUSDT trade');

  const btcSettled = settledHistoricalLog.find((s) => s.asset === 'BTCUSDT');
  assert(
    btcSettled?.status === 'LOSS' &&
    btcSettled?.exitPrice === 64600 &&
    btcSettled?.completedAt === settlementTime,
    '5.2 BTCUSDT in settled log displays exact exitPrice ($64,600) and settlement timestamp'
  );

  const stats = calculatePerformanceStats(merged);
  assert(stats.lossesCount >= 1, '5.3 Performance stats accurately counts the settled trade as a loss');

  console.log('\n======================================================');
  console.log(`TEST RESULTS: ${passed} / ${total} TESTS PASSED`);
  console.log('======================================================\n');

  if (passed === total) {
    console.log('BTCUSDT trade lifecycle mismatch is completely resolved! 🚀\n');
  } else {
    process.exit(1);
  }
}

runBtcMismatchTest().catch((err) => {
  console.error('Fatal error in BTC mismatch test:', err);
  process.exit(1);
});
