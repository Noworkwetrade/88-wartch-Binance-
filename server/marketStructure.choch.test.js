/**
 * Market Structure CHoCH & Directional Guard Test Suite
 *
 * Covers:
 * B.1 CHoCH direction inversion verification:
 *     After a bearish leg (LL + BOS down), the FIRST break above the last swing high
 *     must be classified strictly as a BULLISH CHoCH (direction = 'bullish') across both
 *     server and client structure engines.
 * B.2 Fakeout Rejection misfire prevention:
 *     Candle with body >= 60% of range closing in breakout direction is NOT a fakeout.
 *     It is evaluated as a LONG continuation setup, never as a counter-trend short.
 * B.3 Directional conflict guard (HARD REJECT):
 *     If market regime = trending_up OR a bullish CHoCH is present in the last 5 candles,
 *     scanner strictly rejects any SHORT signal unless structure has flipped bearish again.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectMarketStructure, detectCHoCH, detectFakeout } from './structureIntelligence.js';
import { calculateMarketStructure } from '../src/utils/marketStructure.ts';
import { calculateMarketStructureLevels } from './marketStructureLevels.js';
import { scannerService } from './scannerService.js';

/**
 * Builds the exact BTCUSDT 15m sequence:
 * 1. Bearish leg: LL -> BOS down
 * 2. Rally through last swing high: First break above swing high -> BULLISH CHoCH
 * 3. Pullback Higher Low (HL)
 * 4. Large-bodied green candle breaking out -> BOS(up) / LONG continuation
 */
function buildBtcUsdtChartSequence() {
  const candles = [];
  const baseTime = 1728000000000;
  const candleInterval = 15 * 60 * 1000;
  let t = baseTime;

  function addCandle(open, high, low, close) {
    candles.push({
      openTime: t,
      open,
      high,
      low,
      close,
      volume: 150,
      closeTime: t + candleInterval - 1
    });
    t += candleInterval;
  }

  // Preceding structure setup
  addCandle(85000, 85200, 84800, 85000);
  addCandle(85000, 85100, 84600, 84700);
  addCandle(84700, 84900, 84500, 84600);

  // Swing High 1 (LH): 84,400
  addCandle(84600, 84800, 84300, 84400); // index 3
  addCandle(84400, 84500, 83800, 84000); // index 4: fractal pivot creates LH at 84800 / 84500
  addCandle(84000, 84100, 83200, 83400); // index 5: pushes lower

  // Swing Low 1 (LL): 83,000
  addCandle(83400, 83500, 82900, 83100); // index 6: low 82900
  addCandle(83100, 83800, 83000, 83700); // index 7: bounce
  addCandle(83700, 83900, 83500, 83800); // index 8

  // Lower High 2 (LH): peak at 84,000
  addCandle(83800, 84100, 83600, 83900); // index 9: swing high at 84100
  addCandle(83900, 84000, 83200, 83300); // index 10
  addCandle(83300, 83400, 82600, 82700); // index 11: BOS down below 82900 confirmed!
  addCandle(82700, 82800, 82400, 82500); // index 12: lowest low (LL) at 82400

  // Bullish reversal leg begins
  addCandle(82500, 83200, 82450, 83100); // index 13
  addCandle(83100, 83700, 83000, 83600); // index 14
  addCandle(83600, 84300, 83500, 84250); // index 15: FIRST break above last swing high (84100) -> BULLISH CHoCH!

  // Pullback creates Higher Low (HL)
  addCandle(84250, 84300, 83800, 83900); // index 16
  addCandle(83900, 84100, 83750, 83850); // index 17: HL at 83750
  addCandle(83850, 84200, 83800, 84150); // index 18

  // Signal Candle (index 19): Large-bodied green candle breaking out at $84,900
  // Body = 84850 - 84150 = 700, Range = 84900 - 84100 = 800 -> Body is 87.5% of range!
  addCandle(84150, 84900, 84100, 84850); // index 19: Strong breakout candle

  return candles;
}

test('WORKSTREAM B — Market Structure Intelligence & CHoCH Verification', async (t) => {
  const candles = buildBtcUsdtChartSequence();

  await t.test('B.1 CHoCH Direction Inversion: First break above swing high after bearish leg is BULLISH CHoCH', () => {
    // 1. Server Structure Engine
    const serverStructure = detectMarketStructure(candles, 2);
    const serverChochs = serverStructure.structureBreaks.filter((b) => b.type === 'CHoCH');

    assert.ok(serverChochs.length >= 1, 'Server must detect at least one CHoCH');
    const firstUpChoch = serverChochs.find((b) => b.breakPrice > 84000);
    assert.ok(firstUpChoch, 'Server must detect the upward structural change');
    assert.equal(
      firstUpChoch.direction,
      'bullish',
      'Server CHoCH direction MUST be bullish, never bearish or neutral'
    );

    // 2. Client Structure Utility (src/utils/marketStructure.ts)
    const clientStructure = calculateMarketStructure(candles, 2);
    const clientChochs = clientStructure.structureBreaks.filter((b) => b.type === 'CHoCH');

    assert.ok(clientChochs.length >= 1, 'Client must detect at least one CHoCH');
    const clientFirstUpChoch = clientChochs.find((b) => b.breakPrice > 84000);
    assert.ok(clientFirstUpChoch, 'Client must detect the upward structural change');
    assert.equal(
      clientFirstUpChoch.direction,
      'bullish',
      'Client CHoCH direction MUST be bullish, never bearish or neutral'
    );
  });

  await t.test('B.2 Fakeout Rejection Misfire Prevention: Body >= 60% of range in breakout direction rejects fakeout-short', () => {
    const lastCandle = candles[candles.length - 1];
    const body = Math.abs(lastCandle.close - lastCandle.open);
    const range = lastCandle.high - lastCandle.low;
    const bodyRatio = body / range;

    assert.ok(bodyRatio >= 0.60, `Body ratio (${(bodyRatio * 100).toFixed(1)}%) must be >= 60%`);

    // Analyze through production scannerService
    const analysis = scannerService.analyzeCandles(
      'BTCUSDT',
      '15m',
      candles,
      lastCandle.close,
      [],
      null
    );

    // Scanner must NOT produce a Fakeout Rejection SHORT
    if (analysis.hasSetup && analysis.signal) {
      assert.notEqual(
        analysis.signal.setupType,
        'Fakeout Rejection',
        'Large-bodied breakout candle must NEVER be identified as Fakeout Rejection'
      );
      assert.equal(
        analysis.signal.direction,
        'UP',
        'Breakout candle with bullish structure must be evaluated as LONG, not counter-trend short'
      );
    }
  });

  await t.test('B.3 Directional Conflict Guard (HARD REJECT): Short signals strictly blocked after bullish CHoCH', () => {
    // Construct a hypothetical counter-trend short candidate on this bullish chart
    const candidateShortSignal = {
      id: 'sig-invalid-short-01',
      asset: 'BTCUSDT',
      timeframe: '15m',
      direction: 'DOWN',
      marketRegime: 'trending_up',
      entryPrice: 84850,
      stopLoss: 85200,
      takeProfit1: 84000,
      timestamp: Date.now()
    };

    scannerService.performanceSignals.clear();
    scannerService.registerSignalSafely(candidateShortSignal);

    // Assert the directional conflict guard blocked registration
    const registered = scannerService.performanceSignals.get('sig-invalid-short-01');
    assert.equal(
      registered,
      undefined,
      'Directional Conflict Guard must strictly reject registering counter-trend SHORT during bullish regime'
    );
  });

  await t.test('B.4 SL/TP Sanity: Structural SL Placement & 0.2% Minimum Risk Threshold', () => {
    // 1. Long Setup Sanity: SL below most recent HL or breakout candle low, >= 0.2% away
    const now = Date.now() - 3600 * 1000 * 5;
    const tfMs = 15 * 60 * 1000;
    const candlesLong = [];
    for (let i = 25; i >= 1; i--) {
      const openTime = now - i * tfMs;
      const closeTime = openTime + tfMs - 1;
      let low = 84800, high = 85500, close = 85200;
      if (i === 15) { low = 83900; close = 84100; } // Swing Low Anchor
      if (i === 7) { high = 86800; close = 86500; }  // Swing High Target
      if (i === 1) { close = 85000; high = 85150; low = 84900; } // Breakout candle close
      candlesLong.push({ openTime, closeTime, open: close - 30, high, low, close, volume: 1500, isClosed: true });
    }

    const resLong = calculateMarketStructureLevels({
      symbol: 'BTCUSDT',
      timeframe: '15m',
      direction: 'UP',
      entryPrice: 85000,
      candles: candlesLong
    });

    assert.ok(resLong.isValid, 'B.4.1 Long setup must produce valid structural levels');
    assert.ok(
      resLong.stopLoss < 83900,
      `B.4.2 Long SL ($${resLong.stopLoss}) must be placed below recent higher swing low ($83,900)`
    );
    const longRiskPct = ((resLong.entryPrice - resLong.stopLoss) / resLong.entryPrice) * 100;
    assert.ok(
      longRiskPct >= 0.20,
      `B.4.3 Long SL distance (${longRiskPct.toFixed(2)}%) must never be within 0.2% of entry`
    );

    // 2. Short Setup Sanity: SL above most recent LH, >= 0.2% away
    const candlesShort = [];
    for (let i = 25; i >= 1; i--) {
      const openTime = now - i * tfMs;
      const closeTime = openTime + tfMs - 1;
      let low = 83500, high = 84500, close = 84000;
      if (i === 15) { high = 86100; close = 85800; } // Swing High Anchor (LH)
      if (i === 7) { low = 82200; close = 82500; }   // Swing Low Target
      if (i === 1) { close = 84000; high = 84200; low = 83900; } // Breakdown candle close
      candlesShort.push({ openTime, closeTime, open: close + 30, high, low, close, volume: 1500, isClosed: true });
    }

    const resShort = calculateMarketStructureLevels({
      symbol: 'BTCUSDT',
      timeframe: '15m',
      direction: 'DOWN',
      entryPrice: 84000,
      candles: candlesShort
    });

    assert.ok(resShort.isValid, 'B.4.4 Short setup must produce valid structural levels');
    assert.ok(
      resShort.stopLoss > 86100,
      `B.4.5 Short SL ($${resShort.stopLoss}) must be placed above recent lower swing high ($86,100)`
    );
    const shortRiskPct = ((resShort.stopLoss - resShort.entryPrice) / resShort.entryPrice) * 100;
    assert.ok(
      shortRiskPct >= 0.20,
      `B.4.6 Short SL distance (${shortRiskPct.toFixed(2)}%) must never be within 0.2% of entry`
    );
  });

  await t.test('Test D — Structural SL placement for the LONG (BTCUSDT Sequence)', () => {
    const btcCandles = buildBtcUsdtChartSequence();
    const breakoutCandle = btcCandles[btcCandles.length - 1]; // index 19: close 84850, low 84100
    const mostRecentHL = 83750; // Pullback Higher Low at index 17

    const levels = calculateMarketStructureLevels({
      symbol: 'BTCUSDT',
      timeframe: '15m',
      direction: 'UP',
      entryPrice: breakoutCandle.close,
      candles: btcCandles,
      minRiskRewardRatio: 0.25
    });

    assert.ok(levels.isValid, 'Test D: Structural levels for BTCUSDT LONG must be valid');

    // Assert: SL is placed below the most recent HL or the breakout candle low
    assert.ok(
      levels.stopLoss < mostRecentHL || levels.stopLoss < breakoutCandle.low,
      `Test D: SL ($${levels.stopLoss}) must be placed below most recent HL ($${mostRecentHL}) or breakout candle low ($${breakoutCandle.low})`
    );

    // Assert: SL is NOT within 0.2% of entry
    const riskDistance = levels.entryPrice - levels.stopLoss;
    const riskPercent = (riskDistance / levels.entryPrice) * 100;
    assert.ok(
      riskPercent >= 0.20,
      `Test D: SL distance (${riskPercent.toFixed(2)}%) must NOT be within 0.2% of entry (>= 0.20%)`
    );

    // Assert: entry, SL, TP1, TP2 are all consistent with a LONG
    assert.ok(levels.stopLoss < levels.entryPrice, 'Test D: SL must be strictly below Entry');
    assert.ok(levels.takeProfit1 > levels.entryPrice, 'Test D: TP1 must be strictly above Entry');
    assert.ok(levels.takeProfit2 > levels.takeProfit1, 'Test D: TP2 must be strictly above TP1');
  });

  await t.test('Test E — Regression: Genuine Fakeout Still Detected (Do Not Over-Correct)', () => {
    // Construct genuine fakeout candle that wicks above prior swing high (89,000) and closes back below with body < 40% of range
    const now = Date.now() - 3600 * 1000 * 5;
    const tf = 15 * 60 * 1000;
    const fakeoutCandles = [];

    for (let i = 25; i >= 1; i--) {
      const openTime = now - i * tf;
      const closeTime = openTime + tf - 1;
      let open, high, low, close;

      if (i >= 20) {
        if (i === 22) {
          open = 86200; low = 85800; high = 86400; close = 86100;
        } else {
          open = 86300; low = 86100; high = 86600; close = 86400;
        }
      } else if (i > 8 && i < 20) {
        const step = (20 - i) * 200;
        open = 86400 + step; close = open + 150; high = close + 100; low = open - 100;
      } else if (i === 8) {
        // Confirmed Swing High peak at 89,000
        open = 88600; high = 89000; low = 88500; close = 88800;
      } else if (i > 1 && i < 8) {
        // Consolidation pullback below 89,000
        const pull = (8 - i) * 80;
        open = 88600 - pull; close = 88500 - pull; high = open + 80; low = close - 80;
      } else if (i === 1) {
        // Genuine Fakeout candle:
        // Wicks above swing high (89,000) to 89,250, closes back below at 88,700
        // Range = 89250 - 88600 = 650. Body = |88700 - 88800| = 100 (15.38% of range < 40%)
        open = 88800; high = 89250; low = 88600; close = 88700;
      }

      fakeoutCandles.push({ openTime, closeTime, open, high, low, close, volume: 1500, isClosed: true });
    }

    const candle = fakeoutCandles[fakeoutCandles.length - 1];
    const priorSwingHigh = 89000;

    // Assert: detectFakeout() returns true
    const isFakeout = detectFakeout(candle, priorSwingHigh, 'high');
    assert.equal(isFakeout, true, 'Test E: detectFakeout() must return true for upper wick sweep with body < 40%');

    // Assert: a SHORT signal IS emitted for this candle
    const scanResult = scannerService.analyzeCandles(
      'BTCUSDT',
      '15m',
      fakeoutCandles,
      candle.close,
      [],
      null
    );

    assert.ok(scanResult.hasSetup, 'Test E: Scanner must detect a setup for the genuine fakeout candle');
    assert.ok(scanResult.signal !== null, 'Test E: Scanner must emit a non-null signal');
    assert.equal(
      scanResult.signal.direction,
      'DOWN',
      'Test E: Signal direction for genuine upper fakeout rejection must be DOWN (SHORT)'
    );
    assert.equal(
      scanResult.signal.setupType,
      'Fakeout Rejection',
      'Test E: Signal setupType must be Fakeout Rejection'
    );
  });
});
