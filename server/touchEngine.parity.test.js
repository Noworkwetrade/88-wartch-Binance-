/**
 * Touch Engine Parity Test Suite — Production Server Path vs Client Engine
 *
 * Feeds identical synthetic tick and candle sequences to BOTH production engines:
 *   - Engine A: Production Server Settlement Path (scannerService.watchActiveSignals & evaluateCandle)
 *   - Engine B: Client Touch Engine (src/utils/signalTouchEngine.ts & src/utils/performanceEngine.ts)
 *
 * Asserts identical final settlement state across both engines:
 *   status, outcome, settledAtLevel, realizedR
 *
 * Covers all six cases:
 *   1. Bullish TP1 then reversal to SL
 *   2. Bullish SL before TP1
 *   3. Bearish mirror: TP1 then reversal to SL
 *   4. Wick ambiguity (TP1 and SL same candle -> conservative loss)
 *   5. Completed signal cannot reappear in active list
 *   6. Persistent cleared-ID registry is a strict no-op
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

// Mock localStorage for Node environment BEFORE importing client modules
if (typeof globalThis.localStorage === 'undefined') {
  const memoryStore = new Map();
  globalThis.localStorage = {
    getItem: (key) => memoryStore.get(key) || null,
    setItem: (key, value) => memoryStore.set(key, value),
    removeItem: (key) => memoryStore.delete(key),
    clear: () => memoryStore.clear(),
    key: (index) => Array.from(memoryStore.keys())[index] || null,
    length: 0
  };
}

const { scannerService } = await import('./scannerService.js');
const { marketCache } = await import('./marketCache.js');
const { SignalTouchEngine } = await import('./signalTouchEngine.js');
const {
  checkSignalTouch,
  addClearedSignalId,
  loadClearedSignalIds
} = await import('../src/utils/signalTouchEngine.ts');
const {
  evaluateSignalsWithTicker,
  mergeScannerSignals
} = await import('../src/utils/performanceEngine.ts');

/**
 * Normalizes client signal representation into lifecycle parity state
 */
function toClientParityState(clientSignal) {
  return {
    status: clientSignal.isTradeComplete ? 'completed' : 'active',
    outcome: clientSignal.outcome,
    settledAtLevel: clientSignal.settledAtLevel,
    realizedR: clientSignal.realizedR
  };
}

/**
 * Normalizes production server signal representation into lifecycle parity state
 */
function toServerParityState(serverSignal) {
  return {
    status: serverSignal.isTradeComplete ? 'completed' : 'active',
    outcome: serverSignal.outcome,
    settledAtLevel: serverSignal.settledAtLevel,
    realizedR: serverSignal.realizedR
  };
}

function resetServerEngine() {
  scannerService.performanceSignals.clear();
  scannerService.touchEngine = new SignalTouchEngine();
}

test('Touch Engine Parity — Production Server Path vs Client Engine', async (t) => {
  await t.test('1. Bullish: TP1 then reversal to SL (identical win settlement)', () => {
    localStorage.clear();
    resetServerEngine();

    const now = Date.now();
    const signalId = 'parity-prod-bullish-01';
    const baseSignal = {
      id: signalId,
      asset: 'BTCUSDT',
      direction: 'UP',
      entryPrice: 100,
      entry: 100,
      stopLoss: 95,
      takeProfit1: 105,
      takeProfit: 105,
      takeProfit2: 110,
      rewardRiskRatio: 1.0,
      timeframe: '15m',
      timestamp: now,
      confirmedCandleCloseTime: now,
      expiryTimestamp: now + 3600000,
      expiryCandles: 4,
      status: 'ACTIVE'
    };

    // Engine A: Production Server Path
    scannerService.registerSignalSafely({ ...baseSignal });

    // Engine B: Client
    let clientSignals = [{ ...baseSignal }];

    // Walk ticks:
    // Tick 1: Entry 100
    marketCache.tickers.set('BTCUSDT', { symbol: 'BTCUSDT', lastPrice: '100' });
    scannerService.watchActiveSignals();
    clientSignals = evaluateSignalsWithTicker(clientSignals, 'BTCUSDT', 100).updatedSignals;

    // Tick 2: Reaches TP1 at 105
    marketCache.tickers.set('BTCUSDT', { symbol: 'BTCUSDT', lastPrice: '105' });
    scannerService.watchActiveSignals();
    clientSignals = evaluateSignalsWithTicker(clientSignals, 'BTCUSDT', 105).updatedSignals;

    const serverMid = scannerService.performanceSignals.get(signalId);
    assert.equal(serverMid.tp1Hit, true, 'Server must recognize TP1 hit');
    assert.equal(clientSignals[0].tp1Hit, true, 'Client must recognize TP1 hit');

    // Tick 3: Reversal to SL at 95
    marketCache.tickers.set('BTCUSDT', { symbol: 'BTCUSDT', lastPrice: '95' });
    scannerService.watchActiveSignals();
    clientSignals = evaluateSignalsWithTicker(clientSignals, 'BTCUSDT', 95).updatedSignals;

    const serverFinal = toServerParityState(scannerService.performanceSignals.get(signalId));
    const clientFinal = toClientParityState(clientSignals[0]);

    // Assert identical final state
    assert.deepEqual(
      serverFinal,
      clientFinal,
      'Both production server and client must produce identical final settlement on TP1 -> SL reversal'
    );
    assert.equal(serverFinal.status, 'completed');
    assert.equal(serverFinal.outcome, 'win');
    assert.equal(serverFinal.settledAtLevel, 'tp1');
    assert.equal(serverFinal.realizedR, 1.0);
  });

  await t.test('2. Bullish: SL hit before TP1 (identical loss settlement)', () => {
    localStorage.clear();
    resetServerEngine();

    const now = Date.now();
    const signalId = 'parity-prod-sl-first-01';
    const baseSignal = {
      id: signalId,
      asset: 'BTCUSDT',
      direction: 'UP',
      entryPrice: 100,
      entry: 100,
      stopLoss: 95,
      takeProfit1: 105,
      takeProfit: 105,
      takeProfit2: 110,
      rewardRiskRatio: 1.0,
      timeframe: '15m',
      timestamp: now,
      confirmedCandleCloseTime: now,
      expiryTimestamp: now + 3600000,
      expiryCandles: 4,
      status: 'ACTIVE'
    };

    scannerService.registerSignalSafely({ ...baseSignal });
    let clientSignals = [{ ...baseSignal }];

    // Drops straight to SL at 95 before TP1
    marketCache.tickers.set('BTCUSDT', { symbol: 'BTCUSDT', lastPrice: '95' });
    scannerService.watchActiveSignals();
    clientSignals = evaluateSignalsWithTicker(clientSignals, 'BTCUSDT', 95).updatedSignals;

    const serverFinal = toServerParityState(scannerService.performanceSignals.get(signalId));
    const clientFinal = toClientParityState(clientSignals[0]);

    assert.deepEqual(
      serverFinal,
      clientFinal,
      'Both production server and client must produce identical final state when SL touched before TP1'
    );
    assert.equal(serverFinal.status, 'completed');
    assert.equal(serverFinal.outcome, 'loss');
    assert.equal(serverFinal.settledAtLevel, 'sl');
    assert.equal(serverFinal.realizedR, -1.0);
  });

  await t.test('3. Bearish mirror: TP1 then reversal to SL (identical short win settlement)', () => {
    localStorage.clear();
    resetServerEngine();

    const now = Date.now();
    const signalId = 'parity-prod-bearish-01';
    const baseSignal = {
      id: signalId,
      asset: 'BTCUSDT',
      direction: 'DOWN',
      entryPrice: 100,
      entry: 100,
      stopLoss: 105,
      takeProfit1: 95,
      takeProfit: 95,
      takeProfit2: 90,
      rewardRiskRatio: 1.0,
      timeframe: '15m',
      timestamp: now,
      confirmedCandleCloseTime: now,
      expiryTimestamp: now + 3600000,
      expiryCandles: 4,
      status: 'ACTIVE'
    };

    scannerService.registerSignalSafely({ ...baseSignal });
    let clientSignals = [{ ...baseSignal }];

    // Short tick walk:
    // Tick 1: drops to TP1 at 95
    marketCache.tickers.set('BTCUSDT', { symbol: 'BTCUSDT', lastPrice: '95' });
    scannerService.watchActiveSignals();
    clientSignals = evaluateSignalsWithTicker(clientSignals, 'BTCUSDT', 95).updatedSignals;

    const serverMid = scannerService.performanceSignals.get(signalId);
    assert.equal(serverMid.tp1Hit, true);
    assert.equal(clientSignals[0].tp1Hit, true);

    // Tick 2: reverses to SL at 105
    marketCache.tickers.set('BTCUSDT', { symbol: 'BTCUSDT', lastPrice: '105' });
    scannerService.watchActiveSignals();
    clientSignals = evaluateSignalsWithTicker(clientSignals, 'BTCUSDT', 105).updatedSignals;

    const serverFinal = toServerParityState(scannerService.performanceSignals.get(signalId));
    const clientFinal = toClientParityState(clientSignals[0]);

    assert.deepEqual(
      serverFinal,
      clientFinal,
      'Both engines must produce identical final state on bearish TP1 -> SL reversal'
    );
    assert.equal(serverFinal.status, 'completed');
    assert.equal(serverFinal.outcome, 'win');
    assert.equal(serverFinal.settledAtLevel, 'tp1');
    assert.equal(serverFinal.realizedR, 1.0);
  });

  await t.test('4. Wick ambiguity (touches BOTH TP1 and SL in same candle -> conservative loss parity)', () => {
    localStorage.clear();
    resetServerEngine();

    const now = Date.now();
    const signalId = 'parity-prod-ambiguous-01';
    const baseSignal = {
      id: signalId,
      asset: 'BTCUSDT',
      direction: 'UP',
      entryPrice: 100,
      entry: 100,
      stopLoss: 95,
      takeProfit1: 105,
      takeProfit: 105,
      takeProfit2: 110,
      rewardRiskRatio: 1.0,
      timeframe: '15m',
      timestamp: now,
      confirmedCandleCloseTime: now,
      expiryTimestamp: now + 3600000,
      expiryCandles: 4,
      status: 'ACTIVE'
    };

    const ambiguousCandle = {
      openTime: now + 60000,
      open: 100,
      high: 106,
      low: 94,
      close: 100,
      volume: 100,
      closeTime: now + 960000
    };

    // Engine A: Production Server Path (evaluateCandle)
    scannerService.registerSignalSafely({ ...baseSignal });
    scannerService.evaluateCandle(signalId, ambiguousCandle);

    // Engine B: Client Candle Touch Evaluation
    const clientTouch = checkSignalTouch({ ...baseSignal }, 100, [ambiguousCandle]);
    assert.equal(clientTouch.touchedLevel, 'BOTH');
    assert.equal(clientTouch.isTradeComplete, true);

    let clientSignals = [{ ...baseSignal }];
    clientSignals = evaluateSignalsWithTicker(clientSignals, 'BTCUSDT', 100, 106, 94, [ambiguousCandle]).updatedSignals;

    const serverFinal = toServerParityState(scannerService.performanceSignals.get(signalId));
    const clientFinal = toClientParityState(clientSignals[0]);

    assert.deepEqual(
      serverFinal,
      clientFinal,
      'Both production server and client must take conservative LOSS outcome on wick ambiguity'
    );
    assert.equal(serverFinal.status, 'completed');
    assert.equal(serverFinal.outcome, 'loss');
    assert.equal(serverFinal.settledAtLevel, 'sl');
    assert.equal(serverFinal.realizedR, -1.0);
  });

  await t.test('5. Completed signal cannot reappear in active list', () => {
    localStorage.clear();
    resetServerEngine();

    const now = Date.now();
    const signalId = 'parity-prod-rescan-01';
    const baseSignal = {
      id: signalId,
      asset: 'BTCUSDT',
      direction: 'UP',
      entryPrice: 100,
      entry: 100,
      stopLoss: 95,
      takeProfit1: 105,
      takeProfit: 105,
      takeProfit2: 110,
      rewardRiskRatio: 1.0,
      timeframe: '15m',
      timestamp: now,
      confirmedCandleCloseTime: now,
      expiryTimestamp: now + 3600000,
      expiryCandles: 4,
      status: 'ACTIVE'
    };

    // 1. Complete signal on Production Server
    scannerService.registerSignalSafely({ ...baseSignal });
    marketCache.tickers.set('BTCUSDT', { symbol: 'BTCUSDT', lastPrice: '95' });
    scannerService.watchActiveSignals();

    const serverActive = scannerService.getScanData().signals;
    assert.equal(serverActive.find((s) => s.id === signalId), undefined, 'Server active list must NOT contain completed signal');

    // Attempt to re-register on server
    scannerService.registerSignalSafely({ ...baseSignal, timestamp: now + 60000, confirmedCandleCloseTime: now + 60000 });
    const serverActiveAfter = scannerService.getScanData().signals;
    assert.equal(serverActiveAfter.find((s) => s.id === signalId), undefined, 'Completed signal must never reappear after re-scan attempt');

    // 2. Complete signal on Client
    let clientSignals = [{ ...baseSignal }];
    clientSignals = evaluateSignalsWithTicker(clientSignals, 'BTCUSDT', 95).updatedSignals;
    assert.equal(clientSignals[0].isTradeComplete, true);

    addClearedSignalId(signalId);
    const clearedSet = loadClearedSignalIds();
    assert.ok(clearedSet.has(signalId), 'Client cleared registry must contain signal ID');

    // Rescan attempt on client
    const reMerged = mergeScannerSignals(clientSignals, [{ ...baseSignal, status: 'ACTIVE' }]);
    const activeClient = reMerged.filter((s) => s.status === 'ACTIVE' && !clearedSet.has(s.id));
    assert.equal(activeClient.length, 0, 'Client active list must NOT contain completed signal after re-scan');

    // Parity assertion
    assert.equal(serverActiveAfter.length, activeClient.length);
  });

  await t.test('6. Cleared-ID registry is a no-op (immutable completed state)', () => {
    localStorage.clear();
    resetServerEngine();

    const now = Date.now();
    const signalId = 'parity-prod-immutable-01';
    const baseSignal = {
      id: signalId,
      asset: 'BTCUSDT',
      direction: 'UP',
      entryPrice: 100,
      entry: 100,
      stopLoss: 95,
      takeProfit1: 105,
      takeProfit: 105,
      takeProfit2: 110,
      rewardRiskRatio: 1.0,
      timeframe: '15m',
      timestamp: now,
      confirmedCandleCloseTime: now,
      expiryTimestamp: now + 3600000,
      expiryCandles: 4,
      status: 'ACTIVE'
    };

    // Settle as WIN on server
    scannerService.registerSignalSafely({ ...baseSignal });
    marketCache.tickers.set('BTCUSDT', { symbol: 'BTCUSDT', lastPrice: '105' });
    scannerService.watchActiveSignals();
    marketCache.tickers.set('BTCUSDT', { symbol: 'BTCUSDT', lastPrice: '95' });
    scannerService.watchActiveSignals();

    // Verify signal is in server cleared registry
    assert.ok(scannerService.getClearedIds().has(signalId), 'Signal must be present in server cleared registry');

    // Attempt to mutate or update the cleared signal
    const serverUpdateResult = scannerService.touchEngine.updateSignal({
      id: signalId,
      status: 'active',
      outcome: 'loss',
      settledAtLevel: 'sl'
    });
    assert.equal(serverUpdateResult, false, 'Update on cleared ID must be a strict no-op');

    // Client side equivalent
    let clientSignals = [{ ...baseSignal }];
    clientSignals = evaluateSignalsWithTicker(clientSignals, 'BTCUSDT', 105).updatedSignals;
    clientSignals = evaluateSignalsWithTicker(clientSignals, 'BTCUSDT', 95).updatedSignals;

    addClearedSignalId(signalId);
    const clientCleared = loadClearedSignalIds();
    assert.ok(clientCleared.has(signalId), 'Signal must be in client cleared registry');

    // Attempt to resurrect via mergeScannerSignals
    const attemptResurrect = mergeScannerSignals(clientSignals, [{
      ...baseSignal,
      status: 'ACTIVE',
      outcome: 'loss'
    }]);
    const finalClient = attemptResurrect.find((s) => s.id === signalId);

    const finalServer = scannerService.performanceSignals.get(signalId);

    // Parity state verification
    assert.deepEqual(
      toServerParityState(finalServer),
      toClientParityState(finalClient),
      'Both engines must maintain immutable WIN / TP1 state'
    );
    assert.equal(finalServer.outcome, 'win');
    assert.equal(finalClient.outcome, 'win');
  });
});
