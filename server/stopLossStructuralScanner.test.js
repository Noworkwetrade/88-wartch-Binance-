import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateMarketStructureLevels, findConfirmedStructuralSwings } from './marketStructureLevels.js';
import { scannerService } from './scannerService.js';

/**
 * Builds synthetic candle sequence with:
 * - A major bottom at index 10 (price 80000 - largest low in chart)
 * - An uptrend rallying to index 15 (high 85000)
 * - A confirmed pullback Higher Low (HL) at index 17 (low 83500)
 * - Confirming bounce at index 18 (low 83700, close 84200)
 * - Breakout signal candle at index 19 (low 84100, close 84900)
 */
function buildStructuralTrendCandles() {
  const candles = [];
  const baseTime = 1728000000000;
  const tf = 15 * 60 * 1000;
  let t = baseTime;

  function add(open, high, low, close) {
    candles.push({ openTime: t, closeTime: t + tf - 1, open, high, low, close, volume: 1000 });
    t += tf;
  }

  // Preceding bars 0..9
  for (let i = 0; i < 10; i++) {
    add(81000 - i * 50, 81100 - i * 50, 80800 - i * 50, 80900 - i * 50);
  }
  // Index 10: Deepest low in chart (largest low) = 80,000
  add(80500, 80600, 80000, 80400); // 10

  // Rally 11..15
  add(80400, 81500, 80300, 81400); // 11
  add(81400, 82500, 81300, 82400); // 12
  add(82400, 83600, 82300, 83500); // 13
  add(83500, 84600, 83400, 84500); // 14
  add(84500, 86800, 84400, 86500); // 15: Swing High peak target at 86,800

  // Pullback: 16, 17, 18
  add(86500, 86600, 84200, 84300); // 16: Falling into pullback
  add(84300, 84400, 83500, 83800); // 17: Confirmed Higher Low (HL) turning point at 83,500
  add(83800, 84300, 83700, 84200); // 18: Confirmed turn upward (low 83700 > 83500)

  // Breakout Signal Candle: index 19
  add(84200, 85000, 84100, 84900); // 19: Breakout close at 84,900 (low 84100 is NOT confirmed)

  return candles;
}

test('Stop Loss Structural Scanner Requirements Suite', async (t) => {
  await t.test('Req 1 & 2: Uses latest confirmed structural swing low, NOT nearest candle low or largest low in chart', () => {
    const candles = buildStructuralTrendCandles();
    const breakoutCandle = candles[candles.length - 1]; // index 19: close 84900, low 84100
    const confirmedHL = 83500; // index 17
    const deepestLow = 80000; // index 10

    const levels = calculateMarketStructureLevels({
      symbol: 'BTCUSDT',
      timeframe: '15m',
      direction: 'UP',
      entryPrice: breakoutCandle.close,
      candles
    });

    assert.ok(levels.isValid, 'Setup must produce valid structural levels');
    assert.equal(
      levels.structureReference.swingLow,
      confirmedHL,
      `Must use the latest confirmed structural Higher Low ($${confirmedHL}), not the deepest low ($${deepestLow}) or latest candle low ($${breakoutCandle.low})`
    );

    // Req 3: Stop loss has safety buffer below swing low
    assert.ok(
      levels.stopLoss < confirmedHL,
      `Stop loss ($${levels.stopLoss}) must be strictly below confirmed swing low ($${confirmedHL})`
    );
    const buffer = levels.structureReference.buffer;
    assert.ok(buffer > 0, 'Buffer must be positive');
    assert.equal(
      levels.stopLoss,
      parseFloat((confirmedHL - buffer).toFixed(6)),
      'Stop loss must equal swing low minus safety buffer'
    );
  });

  await t.test('Req 4: Rejects bad setups when no valid swing exists or stop is too close (no forced fake stop)', () => {
    // 1. Monotonic run-up where no swing low exists below entry
    const upwardCandles = [];
    const baseTime = 1728000000000;
    for (let i = 0; i < 20; i++) {
      const price = 50000 + i * 100;
      upwardCandles.push({
        openTime: baseTime + i * 900000,
        closeTime: baseTime + (i + 1) * 900000 - 1,
        open: price,
        high: price + 120,
        low: price + 10,
        close: price + 100,
        volume: 500
      });
    }

    const noSwingResult = calculateMarketStructureLevels({
      symbol: 'ETHUSDT',
      timeframe: '15m',
      direction: 'UP',
      entryPrice: 50000, // Below all candles -> no valid swing low below entry!
      candles: upwardCandles
    });

    assert.equal(noSwingResult.isValid, false, 'Must reject setup when no valid confirmed swing exists below entry');
    assert.ok(
      noSwingResult.rejectReason?.toLowerCase().includes('no valid') ||
      noSwingResult.rejectReason?.toLowerCase().includes('reject'),
      'Must give clear rejection reason without forcing a stop'
    );

    // 2. Setup where swing low would be too close to entry (<0.2%)
    const tightCandles = [];
    for (let i = 0; i < 25; i++) {
      tightCandles.push({
        openTime: baseTime + i * 900000,
        closeTime: baseTime + (i + 1) * 900000 - 1,
        open: 10000,
        high: 10010,
        low: 9995,
        close: 10005,
        volume: 500
      });
    }
    tightCandles[15] = { ...tightCandles[15], low: 9998 }; // Tiny micro-dip

    const tightResult = calculateMarketStructureLevels({
      symbol: 'ETHUSDT',
      timeframe: '15m',
      direction: 'UP',
      entryPrice: 10000.5,
      candles: tightCandles
    });

    assert.equal(tightResult.isValid, false, 'Must reject setup if stop is too close to entry (<0.2%)');
  });

  await t.test('Req 5: Stop loss is frozen upon signal generation and cannot be mutated by later candles', () => {
    const candles = buildStructuralTrendCandles();
    const entryCandle = candles[candles.length - 1];

    const signal = scannerService.createSignalItem({
      symbol: 'BTCUSDT',
      timeframe: '15m',
      direction: 'UP',
      setupType: 'Break & Retest',
      closePrice: entryCandle.close,
      invalidationLevel: 83400,
      stopLoss: 83400,
      confidence: 90,
      reason: 'Confirmed break and retest',
      timestamp: entryCandle.closeTime,
      confirmedCandleCloseTime: entryCandle.closeTime
    });

    assert.ok(signal, 'Signal item must be created');
    assert.equal(signal.stopLoss, 83400, 'Original stop loss must be 83400');
    assert.equal(signal.isStopLossFrozen, true, 'isStopLossFrozen flag must be true');

    // Attempt to silently overwrite or mutate stop loss as later candle comes in
    assert.throws(() => {
      signal.stopLoss = 84000;
    }, /Cannot assign to read only property 'stopLoss'/, 'Mutating frozen stopLoss must be blocked');

    assert.equal(signal.stopLoss, 83400, 'Stop loss must remain frozen at 83400');
  });
  await t.test('Req 6: Completed signals remain visible in the recent signals list', () => {
    const signal = scannerService.createSignalItem({
      symbol: 'BTCUSDT',
      timeframe: '15m',
      direction: 'UP',
      setupType: 'Breakout',
      closePrice: 85000,
      invalidationLevel: 84000,
      stopLoss: 84000,
      takeProfit1: 87000,
      confidence: 85,
      reason: 'Test signal history retention',
      timestamp: Date.now(),
      confirmedCandleCloseTime: Date.now()
    });
    signal.status = 'LOSS';
    signal.isTradeComplete = true;
    const previous = scannerService.performanceSignals.get(signal.id);
    scannerService.performanceSignals.set(signal.id, signal);
    try {
      scannerService.syncActiveSignalsArray();
      assert.ok(scannerService.signals.some((item) => item.id === signal.id),
        'Settled signal remains in the recent signals list');
    } finally {
      scannerService.performanceSignals.delete(signal.id);
      if (previous) scannerService.performanceSignals.set(signal.id, previous);
      scannerService.syncActiveSignalsArray();
    }
  });

});
