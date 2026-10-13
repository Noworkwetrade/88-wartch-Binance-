/**
 * Automated BTC Signal Lifecycle Test Suite
 *
 * Verifies all 6 critical signal lifecycle rules using synthetic ticks & candles only (no network/live prices):
 * 1. Bullish: entry 100, SL 95, TP1 105, TP2 110 -> TP1 touched -> reverses -> SL touched -> WIN at TP1 (realizedR = tp1R)
 * 2. Bullish: SL touched before TP1 -> LOSS at SL
 * 3. Bearish mirror: entry 100, SL 105, TP1 95, TP2 90 -> TP1 touched -> reverses -> SL touched -> WIN at TP1
 * 4. Wick ambiguity (touches both TP1 and SL in same tick/candle) -> Conservative LOSS
 * 5. Completed signal cannot reappear in getActive() or after scan cycle
 * 6. Persistent cleared-ID registry -> subsequent update is a no-op
 */

import { SignalTouchEngine } from '../server/signalTouchEngine.js';

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✓ PASS: ${message}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${message}`);
    failed++;
    process.exitCode = 1;
  }
}

async function runLifecycleTests() {
  console.log('\n======================================================');
  console.log('BTC SIGNAL LIFECYCLE VERIFICATION TEST SUITE');
  console.log('======================================================\n');

  // TEST 1: Bullish TP1 -> Reversal to SL
  console.log('TEST 1: Bullish TP1 Touched -> Reversal to SL');
  {
    const engine = new SignalTouchEngine();
    const signal = engine.registerSignal({
      id: 'sig-test-1',
      asset: 'BTCUSDT',
      direction: 'UP',
      entry: 100,
      stopLoss: 95,
      takeProfit1: 105,
      takeProfit2: 110
    });

    engine.evaluateTick('sig-test-1', 100);
    engine.evaluateTick('sig-test-1', 105); // TP1 touched
    assert(signal.tp1Hit === true, 'TP1 flag set when price hits 105');
    assert(signal.outcome === 'win', 'Outcome transitions to win immediately on TP1');

    engine.evaluateTick('sig-test-1', 99);
    engine.evaluateTick('sig-test-1', 95);  // Reversal to SL

    assert(signal.status === 'completed', 'Signal status is completed upon reversal to SL');
    assert(signal.outcome === 'win', 'Signal outcome permanently remains WIN (not loss)');
    assert(signal.settledAtLevel === 'tp1', 'Signal settledAtLevel is tp1');
    assert(signal.realizedR === signal.tp1R, 'Realized R equals tp1R (1.0)');
    assert(signal.realizedR !== -1.0, 'Realized R is NOT -1R');
  }

  // TEST 2: Bullish SL touched before TP1
  console.log('\nTEST 2: Bullish SL Touched Before TP1');
  {
    const engine = new SignalTouchEngine();
    const signal = engine.registerSignal({
      id: 'sig-test-2',
      asset: 'BTCUSDT',
      direction: 'UP',
      entry: 100,
      stopLoss: 95,
      takeProfit1: 105,
      takeProfit2: 110
    });

    engine.evaluateTick('sig-test-2', 97);
    engine.evaluateTick('sig-test-2', 95);

    assert(signal.status === 'completed', 'Signal status is completed on SL touch');
    assert(signal.outcome === 'loss', 'Signal outcome is loss when SL hit before TP1');
    assert(signal.settledAtLevel === 'sl', 'Signal settledAtLevel is sl');
    assert(signal.realizedR === -1.0, 'Realized R is -1.0');
  }

  // TEST 3: Bearish mirror
  console.log('\nTEST 3: Bearish Mirror (Short direction)');
  {
    const engine = new SignalTouchEngine();
    const signal = engine.registerSignal({
      id: 'sig-test-3',
      asset: 'BTCUSDT',
      direction: 'DOWN',
      entry: 100,
      stopLoss: 105,
      takeProfit1: 95,
      takeProfit2: 90
    });

    engine.evaluateTick('sig-test-3', 95); // TP1 hit
    assert(signal.tp1Hit === true, 'Short TP1 reached at 95');

    engine.evaluateTick('sig-test-3', 105); // Reverses upward to SL at 105
    assert(signal.status === 'completed', 'Short signal status is completed');
    assert(signal.outcome === 'win', 'Short signal outcome remains win after reversal to SL');
    assert(signal.settledAtLevel === 'tp1', 'Short signal settledAtLevel is tp1');
    assert(signal.realizedR === signal.tp1R, 'Short signal realizedR equals tp1R (1.0)');
    assert(signal.realizedR !== -1.0, 'Short signal realizedR is NOT -1R');
  }

  // TEST 4: Wick ambiguity (Touches BOTH in same candle)
  console.log('\nTEST 4: Wick Ambiguity (Touches BOTH TP1 and SL)');
  {
    const engine = new SignalTouchEngine();
    const signal = engine.registerSignal({
      id: 'sig-test-4',
      asset: 'BTCUSDT',
      direction: 'UP',
      entry: 100,
      stopLoss: 95,
      takeProfit1: 105,
      takeProfit2: 110
    });

    const ambiguousCandle = {
      openTime: 1728000000000,
      open: 100,
      high: 106,
      low: 94,
      close: 100,
      closeTime: 1728000900000
    };

    engine.evaluateCandle('sig-test-4', ambiguousCandle);

    assert(signal.status === 'completed', 'Status is completed');
    assert(signal.outcome === 'loss', 'Conservative rule resolves ambiguous candle to LOSS');
    assert(signal.settledAtLevel === 'sl', 'Settled level is sl');
    assert(signal.realizedR === -1.0, 'Realized R is -1.0');
  }

  // TEST 5: Completed signal cannot reappear
  console.log('\nTEST 5: Completed Signal Cannot Reappear');
  {
    const engine = new SignalTouchEngine();
    const signal = engine.registerSignal({
      id: 'sig-test-5',
      asset: 'BTCUSDT',
      direction: 'UP',
      entry: 100,
      stopLoss: 95,
      takeProfit1: 105,
      takeProfit2: 110
    });

    assert(engine.getActive().length === 1, 'Initially active');
    engine.evaluateTick('sig-test-5', 95); // Complete it

    assert(engine.getActive().length === 0, 'Completed signal absent from getActive()');

    const added = engine.runScanCycle([
      { id: 'sig-test-5', asset: 'BTCUSDT', direction: 'UP', entry: 100, stopLoss: 95, takeProfit1: 105 }
    ]);
    assert(added.length === 0, 'Scan cycle strictly rejects re-registering completed signal');
    assert(engine.getActive().length === 0, 'Active list remains empty after scan cycle');
  }

  // TEST 6: Persistent cleared-ID registry
  console.log('\nTEST 6: Persistent Cleared-ID Registry (No-op on update)');
  {
    const engine = new SignalTouchEngine();
    const signal = engine.registerSignal({
      id: 'sig-test-6',
      asset: 'BTCUSDT',
      direction: 'UP',
      entry: 100,
      stopLoss: 95,
      takeProfit1: 105,
      takeProfit2: 110
    });

    engine.evaluateTick('sig-test-6', 105);
    engine.evaluateTick('sig-test-6', 95);

    assert(engine.getClearedIds().has('sig-test-6'), 'Signal ID present in cleared registry');

    const updateAttempt = engine.updateSignal({ id: 'sig-test-6', status: 'active', outcome: 'loss' });
    assert(updateAttempt === false, 'Update on cleared ID is a strict no-op');

    const current = engine.signals.get('sig-test-6');
    assert(current.status === 'completed', 'Status remains completed');
    assert(current.outcome === 'win', 'Outcome remains win');
    assert(current.settledAtLevel === 'tp1', 'Settled level remains tp1');
  }

  console.log('\n======================================================');
  console.log(`RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('======================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runLifecycleTests();
