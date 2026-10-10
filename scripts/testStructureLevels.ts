/**
 * Test Suite for NWWT Market Structure Level Engine
 *
 * Verifies all 7 structure-based requirements:
 * 1. Two different pairs receive different stop and take profit levels from the same strategy
 * 2. Different swing highs and swing lows produce different levels
 * 3. Bot rejects a setup when there is insufficient room to the next structural target
 * 4. Bot does not move levels simply to achieve a predetermined R:R
 * 5. Long trades use logical swing lows and resistance targets
 * 6. Short trades use logical swing highs and support targets
 * 7. Changing timeframe produces different valid structural levels
 */

import { calculateMarketStructureLevels, calculateATR } from '../src/utils/marketStructureLevels.ts';
import { Candle } from '../src/types.ts';

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

/**
 * Helper to build synthetic closed candle sequences with specific swing highs/lows
 */
function buildCandleSequence(
  startPrice: number,
  pattern: { openOffset: number; highOffset: number; lowOffset: number; closeOffset: number }[],
  timeframeMinutes: number = 15
): Candle[] {
  const now = Date.now();
  const tfMs = timeframeMinutes * 60 * 1000;
  const candles: Candle[] = [];
  let curPrice = startPrice;

  for (let i = pattern.length - 1; i >= 0; i--) {
    const p = pattern[pattern.length - 1 - i];
    const openTime = now - (i + 1) * tfMs;
    const closeTime = openTime + tfMs - 1;
    const open = curPrice + p.openOffset;
    const high = open + p.highOffset;
    const low = open - p.lowOffset;
    const close = open + p.closeOffset;
    curPrice = close;

    candles.push({
      openTime,
      closeTime,
      open,
      high,
      low,
      close,
      volume: 1200
    });
  }

  return candles;
}

async function runStructureLevelTests() {
  console.log('\n======================================================');
  console.log('NWWT MARKET STRUCTURE LEVEL ENGINE TEST SUITE');
  console.log('======================================================\n');

  // =========================================================================
  // TEST GROUP 1: Two different pairs receive different stop & TP levels
  // =========================================================================
  console.log('TEST GROUP 1: Two Different Pairs Receive Different Stop and Take Profit Levels');
  {
    // BTCUSDT: price ~85000, high ATR ~$350, swing low ~84200, swing high target ~86800
    const btcCandles: Candle[] = [];
    const btcBase = 84000;
    const now = Date.now();
    for (let i = 25; i >= 1; i--) {
      const openTime = now - i * 15 * 60 * 1000;
      const closeTime = openTime + 15 * 60 * 1000 - 1;
      // create a swing low around i=15 at 84200, swing high around i=8 at 86800, and current entry at 85500
      let low = 84800;
      let high = 85600;
      let close = 85200;
      if (i === 15) { low = 84200; close = 84400; } // Swing Low
      if (i === 8) { high = 86800; close = 86500; }  // Swing High Target
      if (i === 1) { close = 85500; high = 85600; low = 85300; } // Entry bar
      btcCandles.push({ openTime, closeTime, open: close - 50, high, low, close, volume: 1500 });
    }

    // SOLUSDT: price ~140, ATR ~$2.20, swing low ~135.50, swing high target ~148.00
    const solCandles: Candle[] = [];
    for (let i = 25; i >= 1; i--) {
      const openTime = now - i * 15 * 60 * 1000;
      const closeTime = openTime + 15 * 60 * 1000 - 1;
      let low = 138.5;
      let high = 142.0;
      let close = 140.0;
      if (i === 15) { low = 135.5; close = 136.5; } // Swing Low
      if (i === 8) { high = 148.0; close = 147.0; }  // Swing High Target
      if (i === 1) { close = 140.5; high = 141.0; low = 139.8; } // Entry bar
      solCandles.push({ openTime, closeTime, open: close - 0.2, high, low, close, volume: 25000 });
    }

    const btcResult = calculateMarketStructureLevels({
      symbol: 'BTCUSDT',
      timeframe: '15m',
      direction: 'UP',
      entryPrice: 85500,
      candles: btcCandles,
      setupType: 'Break & Retest'
    });

    const solResult = calculateMarketStructureLevels({
      symbol: 'SOLUSDT',
      timeframe: '15m',
      direction: 'UP',
      entryPrice: 140.5,
      candles: solCandles,
      setupType: 'Break & Retest'
    });

    assert(btcResult.isValid && solResult.isValid, '1.1 Both BTCUSDT and SOLUSDT successfully evaluate structural setups');

    const btcRiskPct = ((btcResult.entryPrice - btcResult.stopLoss) / btcResult.entryPrice) * 100;
    const solRiskPct = ((solResult.entryPrice - solResult.stopLoss) / solResult.entryPrice) * 100;

    assert(
      Math.abs(btcRiskPct - solRiskPct) > 0.5,
      `1.2 BTC risk % (${btcRiskPct.toFixed(2)}%) differs significantly from SOL risk % (${solRiskPct.toFixed(2)}%) proving no universal fixed percentage`
    );

    assert(
      btcRiskPct !== 1.5 && solRiskPct !== 1.5,
      '1.3 Neither pair uses the legacy hardcoded 1.5% stop loss distance'
    );

    assert(
      btcResult.takeProfit1 === 86800,
      `1.4 BTC take profit 1 ($${btcResult.takeProfit1}) anchors to BTC chart swing high ($86,800)`
    );

    assert(
      solResult.takeProfit1 === 148.0,
      `1.5 SOL take profit 1 ($${solResult.takeProfit1}) anchors to SOL chart swing high ($148.00)`
    );
  }

  // =========================================================================
  // TEST GROUP 2: Different swing highs and swing lows produce different levels
  // =========================================================================
  console.log('\nTEST GROUP 2: Different Swing Highs and Lows Produce Different Levels on Same Pair');
  {
    // Setup A: Tight swing low at 84600, swing high at 86200
    const candlesA: Candle[] = [];
    const now = Date.now();
    for (let i = 25; i >= 1; i--) {
      const openTime = now - i * 15 * 60 * 1000;
      const closeTime = openTime + 15 * 60 * 1000 - 1;
      let low = 84800, high = 85400, close = 85100;
      if (i === 14) { low = 84600; close = 84750; } // Swing Low A
      if (i === 7) { high = 86200; close = 86050; }  // Swing High A
      if (i === 1) { close = 85000; high = 85150; low = 84900; }
      candlesA.push({ openTime, closeTime, open: close - 30, high, low, close, volume: 1000 });
    }

    // Setup B: Deep swing low at 83500, higher swing high at 87500
    const candlesB: Candle[] = [];
    for (let i = 25; i >= 1; i--) {
      const openTime = now - i * 15 * 60 * 1000;
      const closeTime = openTime + 15 * 60 * 1000 - 1;
      let low = 84500, high = 85500, close = 85000;
      if (i === 14) { low = 83500; close = 83800; } // Swing Low B
      if (i === 7) { high = 87500; close = 87200; }  // Swing High B
      if (i === 1) { close = 85000; high = 85150; low = 84900; }
      candlesB.push({ openTime, closeTime, open: close - 30, high, low, close, volume: 1000 });
    }

    const resA = calculateMarketStructureLevels({
      symbol: 'BTCUSDT',
      timeframe: '15m',
      direction: 'UP',
      entryPrice: 85000,
      candles: candlesA
    });

    const resB = calculateMarketStructureLevels({
      symbol: 'BTCUSDT',
      timeframe: '15m',
      direction: 'UP',
      entryPrice: 85000,
      candles: candlesB
    });

    assert(resA.isValid && resB.isValid, '2.1 Both setup structures evaluated successfully');
    assert(
      resA.stopLoss !== resB.stopLoss,
      `2.2 Different swing lows produce different Stop Losses (A: $${resA.stopLoss} vs B: $${resB.stopLoss})`
    );
    assert(
      resA.takeProfit1 !== resB.takeProfit1,
      `2.3 Different swing highs produce different Take Profits (A: $${resA.takeProfit1} vs B: $${resB.takeProfit1})`
    );
    assert(
      resA.riskDistance < resB.riskDistance,
      `2.4 Tight swing low produces smaller risk distance ($${resA.riskDistance}) than deep swing low ($${resB.riskDistance})`
    );
  }

  // =========================================================================
  // TEST GROUP 3: Insufficient room to next structural target causes rejection
  // =========================================================================
  console.log('\nTEST GROUP 3: Setup Rejection When Insufficient Room to Next Structural Target');
  {
    // Candle series where entry is 85000, swing low is 84200 (risk = 800+),
    // but the highest swing high ceiling is only at 85220 (available room = 220).
    // Resulting R:R = 220 / (800 + buffer) = ~0.25 (unfavorable < 1.0)
    const candlesObstructed: Candle[] = [];
    const now = Date.now();
    for (let i = 25; i >= 1; i--) {
      const openTime = now - i * 15 * 60 * 1000;
      const closeTime = openTime + 15 * 60 * 1000 - 1;
      let low = 84500, high = 85150, close = 84900;
      if (i === 15) { low = 84200; close = 84350; } // Swing Low
      if (i === 8) { high = 85220; close = 85180; }  // Ceiling right above entry!
      if (i === 1) { close = 85000; high = 85080; low = 84850; }
      candlesObstructed.push({ openTime, closeTime, open: close - 20, high, low, close, volume: 1000 });
    }

    const resObstructed = calculateMarketStructureLevels({
      symbol: 'BTCUSDT',
      timeframe: '15m',
      direction: 'UP',
      entryPrice: 85000,
      candles: candlesObstructed,
      minRiskRewardRatio: 1.0
    });

    assert(
      resObstructed.isValid === false,
      '3.1 Bot strictly rejects trade when there is insufficient room to next structural target'
    );
    assert(
      resObstructed.rejectReason?.toLowerCase().includes('risk-to-reward') ||
      resObstructed.rejectReason?.toLowerCase().includes('close to entry'),
      `3.2 Clear rejection reason provided: "${resObstructed.rejectReason}"`
    );
  }

  // =========================================================================
  // TEST GROUP 4: Bot does NOT move levels simply to achieve a predetermined RR
  // =========================================================================
  console.log('\nTEST GROUP 4: Levels Not Moved Simply to Manufacture a Predetermined R:R Ratio');
  {
    // Natural chart target at 86800, swing low at 84000 (entry: 85000)
    // Risk = 1000 + buffer = ~1050, Target = 1800. Resulting R:R = ~1.71
    const candlesNatural: Candle[] = [];
    const now = Date.now();
    for (let i = 25; i >= 1; i--) {
      const openTime = now - i * 15 * 60 * 1000;
      const closeTime = openTime + 15 * 60 * 1000 - 1;
      let low = 84600, high = 85500, close = 85000;
      if (i === 14) { low = 84000; close = 84200; }
      if (i === 7) { high = 86800; close = 86600; }
      if (i === 1) { close = 85000; high = 85150; low = 84900; }
      candlesNatural.push({ openTime, closeTime, open: close - 30, high, low, close, volume: 1000 });
    }

    const resNatural = calculateMarketStructureLevels({
      symbol: 'BTCUSDT',
      timeframe: '15m',
      direction: 'UP',
      entryPrice: 85000,
      candles: candlesNatural
    });

    assert(resNatural.isValid, '4.1 Natural structure trade is valid');
    assert(
      resNatural.takeProfit1 === 86800,
      `4.2 TP1 remained anchored to actual swing high ($86,800), NOT pushed to manufactured 1.5R ($${(85000 + resNatural.riskDistance * 1.5).toFixed(0)}) or 2.0R`
    );
    assert(
      resNatural.rewardRiskRatio !== 1.50,
      `4.3 Resulting R:R (1:${resNatural.rewardRiskRatio}) is a natural result of structure, not forced to 1.50`
    );
  }

  // =========================================================================
  // TEST GROUP 5: Long trades use logical swing lows and resistance targets
  // =========================================================================
  console.log('\nTEST GROUP 5: Long Trades Use Logical Swing Lows and Resistance Targets');
  {
    const candlesLong: Candle[] = [];
    const now = Date.now();
    for (let i = 30; i >= 1; i--) {
      const openTime = now - i * 15 * 60 * 1000;
      const closeTime = openTime + 15 * 60 * 1000 - 1;
      let low = 84500, high = 85400, close = 85000;
      if (i === 20) { low = 83900; close = 84100; } // Major Swing Low
      if (i === 12) { high = 86400; close = 86200; } // TP1 Swing High
      if (i === 5) { high = 87800; close = 87600; }  // TP2 Secondary High
      if (i === 1) { close = 85000; high = 85100; low = 84900; }
      candlesLong.push({ openTime, closeTime, open: close - 20, high, low, close, volume: 1000 });
    }

    const resLong = calculateMarketStructureLevels({
      symbol: 'BTCUSDT',
      timeframe: '15m',
      direction: 'UP',
      entryPrice: 85000,
      candles: candlesLong
    });

    assert(resLong.isValid, '5.1 Long setup valid');
    assert(
      resLong.stopLoss < 83900,
      `5.2 Stop loss ($${resLong.stopLoss}) placed logically below swing low ($83,900) with volatility buffer`
    );
    assert(
      resLong.takeProfit1 === 86400,
      `5.3 TP1 ($${resLong.takeProfit1}) anchors to first logical resistance swing high ($86,400)`
    );
    assert(
      resLong.takeProfit2 === 87800,
      `5.4 TP2 ($${resLong.takeProfit2}) anchors to secondary structural resistance ($87,800)`
    );
  }

  // =========================================================================
  // TEST GROUP 6: Short trades use logical swing highs and support targets
  // =========================================================================
  console.log('\nTEST GROUP 6: Short Trades Use Logical Swing Highs and Support Targets');
  {
    const candlesShort: Candle[] = [];
    const now = Date.now();
    for (let i = 30; i >= 1; i--) {
      const openTime = now - i * 15 * 60 * 1000;
      const closeTime = openTime + 15 * 60 * 1000 - 1;
      let low = 84600, high = 85500, close = 85000;
      if (i === 20) { high = 86100; close = 85900; } // Major Swing High
      if (i === 12) { low = 83600; close = 83800; }  // TP1 Swing Low Support
      if (i === 5) { low = 82200; close = 82400; }   // TP2 Secondary Support
      if (i === 1) { close = 85000; high = 85100; low = 84900; }
      candlesShort.push({ openTime, closeTime, open: close + 20, high, low, close, volume: 1000 });
    }

    const resShort = calculateMarketStructureLevels({
      symbol: 'BTCUSDT',
      timeframe: '15m',
      direction: 'DOWN',
      entryPrice: 85000,
      candles: candlesShort
    });

    assert(resShort.isValid, '6.1 Short setup valid');
    assert(
      resShort.stopLoss > 86100,
      `6.2 Short Stop loss ($${resShort.stopLoss}) placed logically above swing high ($86,100) with volatility buffer`
    );
    assert(
      resShort.takeProfit1 === 83600,
      `6.3 Short TP1 ($${resShort.takeProfit1}) anchors to first logical support target ($83,600)`
    );
    assert(
      resShort.takeProfit2 === 82200,
      `6.4 Short TP2 ($${resShort.takeProfit2}) anchors to secondary support target ($82,200)`
    );
  }

  // =========================================================================
  // TEST GROUP 7: Changing timeframe produces different valid structural levels
  // =========================================================================
  console.log('\nTEST GROUP 7: Changing Timeframe Produces Different Valid Structural Levels');
  {
    // 15m candles: tighter ATR (~$150), tighter swing low at 84600
    const candles15m: Candle[] = [];
    const now = Date.now();
    for (let i = 25; i >= 1; i--) {
      const openTime = now - i * 15 * 60 * 1000;
      const closeTime = openTime + 15 * 60 * 1000 - 1;
      let low = 84800, high = 85300, close = 85050;
      if (i === 14) { low = 84600; close = 84750; }
      if (i === 7) { high = 86200; close = 86050; }
      if (i === 1) { close = 85000; high = 85120; low = 84950; }
      candles15m.push({ openTime, closeTime, open: close - 20, high, low, close, volume: 1000 });
    }

    // 1h candles: wider ATR (~$500), wider major swing low at 83500, higher target at 88000
    const candles1h: Candle[] = [];
    for (let i = 25; i >= 1; i--) {
      const openTime = now - i * 60 * 60 * 1000;
      const closeTime = openTime + 60 * 60 * 1000 - 1;
      let low = 84200, high = 85800, close = 85100;
      if (i === 14) { low = 83500; close = 83900; }
      if (i === 7) { high = 88000; close = 87500; }
      if (i === 1) { close = 85000; high = 85400; low = 84700; }
      candles1h.push({ openTime, closeTime, open: close - 50, high, low, close, volume: 4000 });
    }

    const res15m = calculateMarketStructureLevels({
      symbol: 'BTCUSDT',
      timeframe: '15m',
      direction: 'UP',
      entryPrice: 85000,
      candles: candles15m
    });

    const res1h = calculateMarketStructureLevels({
      symbol: 'BTCUSDT',
      timeframe: '1h',
      direction: 'UP',
      entryPrice: 85000,
      candles: candles1h
    });

    assert(res15m.isValid && res1h.isValid, '7.1 Both 15m and 1h setups evaluated successfully');
    assert(
      res15m.stopLoss !== res1h.stopLoss,
      `7.2 15m Stop Loss ($${res15m.stopLoss}) differs from 1h Stop Loss ($${res1h.stopLoss})`
    );
    assert(
      res15m.takeProfit1 !== res1h.takeProfit1,
      `7.3 15m Take Profit ($${res15m.takeProfit1}) differs from 1h Take Profit ($${res1h.takeProfit1})`
    );
    assert(
      res15m.riskDistance < res1h.riskDistance,
      `7.4 15m risk distance ($${res15m.riskDistance}) is more localized than 1h risk distance ($${res1h.riskDistance})`
    );
  }

  // =========================================================================
  // TEST GROUP 8: 5-Minute Swing High and Swing Low Stop Loss Placement
  // =========================================================================
  console.log('\nTEST GROUP 8: 5-Minute Swing Low/High Stop Loss and Take Profit Behavior');
  {
    // Build 5-minute candles with clear swing low at 64250 and swing high target at 65500
    const candles5mLong: Candle[] = [];
    const now = Date.now();
    for (let i = 25; i >= 1; i--) {
      const openTime = now - i * 5 * 60 * 1000;
      const closeTime = openTime + 5 * 60 * 1000 - 1;
      let low = 64600, high = 65100, close = 64900;
      if (i === 15) { low = 64250; close = 64400; } // Previous 5m Swing Low
      if (i === 8) { high = 65500; close = 65350; }  // Target 5m Swing High
      if (i === 1) { close = 64900; high = 64950; low = 64820; } // Entry
      candles5mLong.push({ openTime, closeTime, open: close - 30, high, low, close, volume: 1500 });
    }

    const buyResult = calculateMarketStructureLevels({
      symbol: 'BTCUSDT',
      timeframe: '5m',
      direction: 'UP',
      entryPrice: 64900,
      candles: candles5mLong
    });

    assert(buyResult.isValid, '8.1 Buy signal on 5m candles is valid');
    assert(
      buyResult.stopLoss < 64250,
      `8.2 Buy stop loss ($${buyResult.stopLoss}) is anchored below the lowest point of the previous 5m swing low ($64,250)`
    );
    assert(
      buyResult.takeProfit1 === 65500,
      `8.3 Buy take profit 1 ($${buyResult.takeProfit1}) anchors to the structural swing high ($65,500)`
    );
    assert(
      buyResult.structureReference.swingLow === 64250,
      '8.4 Structure reference records exact swing low lowest point ($64,250)'
    );

    // Build 5-minute candles for SELL with clear swing high at 65800 and swing low target at 64100
    const candles5mShort: Candle[] = [];
    for (let i = 25; i >= 1; i--) {
      const openTime = now - i * 5 * 60 * 1000;
      const closeTime = openTime + 5 * 60 * 1000 - 1;
      let low = 64800, high = 65300, close = 65000;
      if (i === 15) { high = 65800; close = 65650; } // Previous 5m Swing High
      if (i === 8) { low = 64100; close = 64300; }   // Target 5m Swing Low
      if (i === 1) { close = 65000; high = 65120; low = 64950; } // Entry
      candles5mShort.push({ openTime, closeTime, open: close + 30, high, low, close, volume: 1500 });
    }

    const sellResult = calculateMarketStructureLevels({
      symbol: 'BTCUSDT',
      timeframe: '5m',
      direction: 'DOWN',
      entryPrice: 65000,
      candles: candles5mShort
    });

    assert(sellResult.isValid, '8.5 Sell signal on 5m candles is valid');
    assert(
      sellResult.stopLoss > 65800,
      `8.6 Sell stop loss ($${sellResult.stopLoss}) is at the top of the highest point of the 5-minute swing high ($65,800)`
    );
    assert(
      sellResult.takeProfit1 === 64100,
      `8.7 Sell take profit 1 ($${sellResult.takeProfit1}) anchors to the structural swing low ($64,100)`
    );
    assert(
      sellResult.structureReference.swingHigh === 65800,
      '8.8 Structure reference records exact swing high highest point ($65,800)'
    );

    // Test with fiveMinCandles supplied explicitly to a 15m scan
    const buyWith5mContext = calculateMarketStructureLevels({
      symbol: 'BTCUSDT',
      timeframe: '15m',
      direction: 'UP',
      entryPrice: 64900,
      candles: candles5mLong,
      fiveMinCandles: candles5mLong
    });
    assert(
      buyWith5mContext.stopLoss < 64250,
      `8.9 Multi-TF scan uses explicit 5m candles for swing low stop loss ($${buyWith5mContext.stopLoss})`
    );
  }

  console.log('\n======================================================');
  console.log(`STRUCTURE LEVEL SUITE RESULTS: ${passedTests} / ${totalTests} PASSED`);
  console.log('======================================================\n');
}

runStructureLevelTests().catch((err) => {
  console.error('Fatal error in structure level test suite:', err);
  process.exit(1);
});
