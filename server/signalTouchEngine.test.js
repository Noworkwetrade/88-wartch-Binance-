import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SignalTouchEngine } from './signalTouchEngine.js';

test('Task 3 — Signal Lifecycle Tests (synthetic candles only)', async (t) => {
  await t.test('1. Bullish: entry 100, SL 95, TP1 105, TP2 110 (TP1 touched -> reverses -> SL touched)', () => {
    const engine = new SignalTouchEngine();
    const signal = engine.registerSignal({
      id: 'sig-btc-bullish-01',
      asset: 'BTCUSDT',
      direction: 'UP',
      entry: 100,
      stopLoss: 95,
      takeProfit1: 105,
      takeProfit2: 110
    });

    assert.equal(signal.tp1R, 1.0, 'tp1R should equal (105-100)/(100-95) = 1.0');

    // Tick walk: entry (100) -> inside range (102) -> TP1 reached (105)
    engine.evaluateTick('sig-btc-bullish-01', 100);
    assert.equal(signal.status, 'active');
    assert.equal(signal.tp1Hit, false);

    engine.evaluateTick('sig-btc-bullish-01', 102);
    assert.equal(signal.status, 'active');
    assert.equal(signal.tp1Hit, false);

    engine.evaluateTick('sig-btc-bullish-01', 105);
    assert.equal(signal.tp1Hit, true);
    assert.equal(signal.outcome, 'win');

    // Reversal: price drops through 100 to SL at 95
    engine.evaluateTick('sig-btc-bullish-01', 99);
    engine.evaluateTick('sig-btc-bullish-01', 95);

    // Assert: status = completed, outcome = win, settledAtLevel = tp1, realizedR equals tp1R (NOT -1R)
    assert.equal(signal.status, 'completed', 'status must be completed');
    assert.equal(signal.outcome, 'win', 'outcome must be win');
    assert.equal(signal.settledAtLevel, 'tp1', 'settledAtLevel must be tp1');
    assert.equal(signal.realizedR, signal.tp1R, 'realizedR must equal tp1R (1.0)');
    assert.notEqual(signal.realizedR, -1.0, 'realizedR must NOT be -1R');
    assert.equal(signal.isTradeComplete, true, 'isTradeComplete must be true');
  });

  await t.test('2. Bullish: SL touched before TP1', () => {
    const engine = new SignalTouchEngine();
    const signal = engine.registerSignal({
      id: 'sig-btc-bullish-sl-first',
      asset: 'BTCUSDT',
      direction: 'UP',
      entry: 100,
      stopLoss: 95,
      takeProfit1: 105,
      takeProfit2: 110
    });

    // Tick walk: entry (100) -> moves down towards SL (97) -> SL touched (95)
    engine.evaluateTick('sig-btc-bullish-sl-first', 100);
    engine.evaluateTick('sig-btc-bullish-sl-first', 97);
    assert.equal(signal.status, 'active');
    assert.equal(signal.tp1Hit, false);

    engine.evaluateTick('sig-btc-bullish-sl-first', 95);

    // Assert: outcome = loss, settledAtLevel = sl
    assert.equal(signal.status, 'completed', 'status must be completed');
    assert.equal(signal.outcome, 'loss', 'outcome must be loss');
    assert.equal(signal.settledAtLevel, 'sl', 'settledAtLevel must be sl');
    assert.equal(signal.realizedR, -1.0, 'realizedR must be -1.0');
    assert.equal(signal.isTradeComplete, true, 'isTradeComplete must be true');
  });

  await t.test('3. Bearish mirror of test 1 (entry 100, SL 105, TP1 95, TP2 90)', () => {
    const engine = new SignalTouchEngine();
    const signal = engine.registerSignal({
      id: 'sig-btc-bearish-01',
      asset: 'BTCUSDT',
      direction: 'DOWN',
      entry: 100,
      stopLoss: 105,
      takeProfit1: 95,
      takeProfit2: 90
    });

    assert.equal(signal.tp1R, 1.0, 'tp1R should equal (100-95)/(105-100) = 1.0');

    // Short tick walk: entry (100) -> drops to TP1 (95)
    engine.evaluateTick('sig-btc-bearish-01', 98);
    assert.equal(signal.status, 'active');
    assert.equal(signal.tp1Hit, false);

    engine.evaluateTick('sig-btc-bearish-01', 95);
    assert.equal(signal.tp1Hit, true);
    assert.equal(signal.outcome, 'win');

    // Reverses upward through 101 to SL at 105
    engine.evaluateTick('sig-btc-bearish-01', 102);
    engine.evaluateTick('sig-btc-bearish-01', 105);

    // Assert same TP1-first-then-SL behavior in short direction: outcome = win, settledAtLevel = tp1, realizedR equals tp1R
    assert.equal(signal.status, 'completed', 'status must be completed');
    assert.equal(signal.outcome, 'win', 'outcome must be win');
    assert.equal(signal.settledAtLevel, 'tp1', 'settledAtLevel must be tp1');
    assert.equal(signal.realizedR, signal.tp1R, 'realizedR must equal tp1R');
    assert.notEqual(signal.realizedR, -1.0, 'realizedR must NOT be -1R');
    assert.equal(signal.isTradeComplete, true, 'isTradeComplete must be true');
  });

  await t.test('4. Candle that touches BOTH TP1 and SL in the same tick (wick ambiguity)', () => {
    const engine = new SignalTouchEngine();
    const signal = engine.registerSignal({
      id: 'sig-ambiguity-01',
      asset: 'BTCUSDT',
      direction: 'UP',
      entry: 100,
      stopLoss: 95,
      takeProfit1: 105,
      takeProfit2: 110
    });

    // Synthetic candle with high at 106 (pierced TP1) AND low at 94 (pierced SL)
    const ambiguousCandle = {
      openTime: 1728000000000,
      open: 100,
      high: 106,
      low: 94,
      close: 101,
      closeTime: 1728000900000
    };

    engine.evaluateCandle('sig-ambiguity-01', ambiguousCandle);

    // Assert: engine takes the CONSERVATIVE outcome (loss), matching documented behavior
    assert.equal(signal.status, 'completed', 'status must be completed');
    assert.equal(signal.outcome, 'loss', 'conservative rule resolves to loss');
    assert.equal(signal.settledAtLevel, 'sl', 'settledAtLevel must be sl');
    assert.equal(signal.realizedR, -1.0, 'realizedR must be -1.0');
    assert.equal(signal.isTradeComplete, true, 'isTradeComplete must be true');
  });

  await t.test('5. Completed signal cannot reappear (getActive and scan cycle rejection)', () => {
    const engine = new SignalTouchEngine();
    const signal = engine.registerSignal({
      id: 'sig-complete-check-01',
      asset: 'BTCUSDT',
      direction: 'UP',
      entry: 100,
      stopLoss: 95,
      takeProfit1: 105,
      takeProfit2: 110
    });

    // Initially active
    const initialActive = engine.getActive();
    assert.equal(initialActive.length, 1);
    assert.equal(initialActive[0].id, 'sig-complete-check-01');

    // Complete the signal via SL touch
    engine.evaluateTick('sig-complete-check-01', 95);
    assert.equal(signal.status, 'completed');

    // Assert the completed signal is absent from active list
    const activeAfterComplete = engine.getActive();
    assert.equal(activeAfterComplete.length, 0, 'completed signal must be absent from active list');

    // Run a scan cycle attempting to re-register the same signal
    const scanCandidates = [
      {
        id: 'sig-complete-check-01',
        asset: 'BTCUSDT',
        direction: 'UP',
        entry: 100,
        stopLoss: 95,
        takeProfit1: 105,
        takeProfit2: 110
      }
    ];

    const added = engine.runScanCycle(scanCandidates);
    assert.equal(added.length, 0, 'scan cycle must not re-register completed signal');

    // Active list remains empty
    const activeAfterScan = engine.getActive();
    assert.equal(activeAfterScan.length, 0, 'active list must not contain completed signal after scan cycle');
  });

  await t.test('6. Persistent cleared-ID registry (subsequent update is a no-op)', () => {
    const engine = new SignalTouchEngine();
    const signal = engine.registerSignal({
      id: 'sig-cleared-reg-01',
      asset: 'BTCUSDT',
      direction: 'UP',
      entry: 100,
      stopLoss: 95,
      takeProfit1: 105,
      takeProfit2: 110
    });

    // Complete the signal
    engine.evaluateTick('sig-cleared-reg-01', 105); // TP1 hit
    engine.evaluateTick('sig-cleared-reg-01', 95);  // SL hit -> settles as WIN at TP1

    assert.equal(signal.status, 'completed');
    assert.equal(signal.outcome, 'win');

    // Assert ID is in cleared registry
    const cleared = engine.getClearedIds();
    assert.ok(cleared.has('sig-cleared-reg-01'), 'completed signal ID must be in cleared registry');

    // Attempting to update or mutate the cleared signal must be a strict no-op
    const updateResult = engine.updateSignal({
      id: 'sig-cleared-reg-01',
      status: 'active',
      outcome: 'loss'
    });

    assert.equal(updateResult, false, 'update on cleared signal ID must return false (no-op)');

    // Signal state remains unchanged
    const currentSignal = engine.signals.get('sig-cleared-reg-01');
    assert.equal(currentSignal.status, 'completed', 'status must remain completed');
    assert.equal(currentSignal.outcome, 'win', 'outcome must remain win');
    assert.equal(currentSignal.settledAtLevel, 'tp1', 'settledAtLevel must remain tp1');

    // Attempting to evaluate ticks on cleared signal must also be a no-op
    const tickResult = engine.evaluateTick('sig-cleared-reg-01', 110);
    assert.equal(tickResult, null, 'tick evaluation on cleared signal ID must be a no-op');
  });
});
