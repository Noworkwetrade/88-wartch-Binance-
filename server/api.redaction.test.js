import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redactSingleAssetScan, ALLOWED_PUBLIC_KEYS } from './apiRedaction.js';

/**
 * Audit Denylist of internal diagnostics and algorithmic fields that must
 * NEVER leak into public scan responses.
 *
 * Adding a new forbidden key is a single-line addition to this array.
 */
const FORBIDDEN_INTERNAL_FIELDS = [
  'internalScore',
  'debugTrace',
  'regimeDetail',
  'qualityBreakdown',
  'validationPath',
  'rawCandles',
  'swingPoints',
  'structureInternals',
  'intelligenceTrace'
  // Add new forbidden keys here with a single line
];

test('Task 4 — Public API Redaction Tests', async (t) => {
  // Construct a dirty internal scan evaluation object laden with sensitive diagnostics
  const internalEvaluationPayload = {
    originalSignal: {
      id: 'sig-btc-internal-01',
      asset: 'BTCUSDT',
      timeframe: '15m',
      direction: 'UP',
      entryPrice: 64250.0,
      stopLoss: 63500.0,
      takeProfit1: 65750.0,
      takeProfit2: 66500.0,
      rewardRiskRatio: 2.0,
      confidence: 91,
      timestamp: 1728000000000,
      status: 'ACTIVE',
      // Internal fields that must NEVER appear in public response:
      internalScore: 98.4,
      debugTrace: ['candle_pattern_detected', 'liquidity_sweep_verified', 'risk_profile_passed'],
      regimeDetail: { regime: 'BULLISH_TREND', adx: 34.2, volRatio: 1.8 },
      qualityBreakdown: { structureScore: 9, momentumScore: 8, spreadScore: 10 },
      validationPath: 'root -> bos -> retest -> confirmed',
      rawCandles: [{ o: 64000, h: 64500, l: 63800, c: 64250, v: 500 }],
      swingPoints: [{ price: 63500, type: 'swing_low' }, { price: 65750, type: 'swing_high' }],
      structureInternals: { bosIndex: 42, chochConfirmed: true, obMitigated: false },
      intelligenceTrace: 'ai_filtered_pass_threshold_90'
    },
    // Top-level diagnostic properties that scanner internal pipeline produces
    internalScore: 98.4,
    debugTrace: ['scanner_service_tick', 'regime_check'],
    regimeDetail: { regime: 'BULLISH_TREND' },
    qualityBreakdown: { structure: 'high' },
    validationPath: '/strategy/retest',
    rawCandles: [64000, 64250],
    swingPoints: [63500, 65750],
    structureInternals: { active: true },
    intelligenceTrace: 'model_v8_internal_execution'
  };

  const publicResponse = redactSingleAssetScan(internalEvaluationPayload, {
    symbol: 'BTCUSDT',
    timeframe: '15m'
  });

  const serialized = JSON.stringify(publicResponse);

  await t.test('Public response keys match the authorized whitelist EXACTLY (strict key-set equality)', () => {
    // Strict schema test: sort both sides and deepEqual (no more, no fewer)
    const actualKeys = Object.keys(publicResponse).sort();
    const expectedKeys = Array.from(ALLOWED_PUBLIC_KEYS).sort();
    assert.deepEqual(
      actualKeys,
      expectedKeys,
      'Response keys must match the public whitelist EXACTLY — no extra keys, no missing keys'
    );

    // Required values verification
    assert.equal(publicResponse.symbol, 'BTCUSDT');
    assert.equal(publicResponse.timeframe, '15m');
    assert.equal(publicResponse.direction, 'UP');
    assert.equal(publicResponse.entry, 64250.0);
    assert.equal(publicResponse.stopLoss, 63500.0);
    assert.equal(publicResponse.takeProfit1, 65750.0);
    assert.equal(publicResponse.takeProfit2, 66500.0);
    assert.equal(publicResponse.rewardRisk, 2.0);
    // 'confidence' is an explicit user-facing heuristic indicator (0-100 integer) displayed
    // directly on user setup cards in the UI. It cannot be back-derived into proprietary internal quality
    // scores, structural sub-component metrics, or model weights.
    assert.equal(publicResponse.confidence, 91);
    assert.equal(publicResponse.status, 'ACTIVE');
    assert.ok(publicResponse.timestamp > 0);
  });

  await t.test('JSON.stringify(response) contains NONE of the forbidden denylist keys', () => {
    for (const forbiddenKey of FORBIDDEN_INTERNAL_FIELDS) {
      assert.ok(
        !serialized.includes(`"${forbiddenKey}"`),
        `FORBIDDEN KEY LEAK DETECTED: JSON.stringify(response) contains forbidden key '${forbiddenKey}'!`
      );
      assert.ok(
        !(forbiddenKey in publicResponse),
        `Public response object directly contains forbidden property '${forbiddenKey}'!`
      );
    }
  });

  await t.test('Redaction behaves safely when scan returns NO SETUP', () => {
    const noSetupPayload = {
      asset: 'ETHUSDT',
      timeframe: '1h',
      hasSetup: false,
      internalScore: 12.0,
      debugTrace: 'rejected_low_volume',
      rawCandles: []
    };

    const redacted = redactSingleAssetScan(noSetupPayload, {
      symbol: 'ETHUSDT',
      timeframe: '1h'
    });

    const noSetupSerialized = JSON.stringify(redacted);

    const actualNoSetupKeys = Object.keys(redacted).sort();
    const expectedKeys = Array.from(ALLOWED_PUBLIC_KEYS).sort();
    assert.deepEqual(
      actualNoSetupKeys,
      expectedKeys,
      'No-setup response keys must match the public whitelist EXACTLY'
    );

    for (const forbiddenKey of FORBIDDEN_INTERNAL_FIELDS) {
      assert.ok(
        !noSetupSerialized.includes(`"${forbiddenKey}"`),
        `Forbidden key '${forbiddenKey}' found in no-setup response`
      );
    }

    assert.equal(redacted.symbol, 'ETHUSDT');
    assert.equal(redacted.timeframe, '1h');
    assert.equal(redacted.status, 'NO_SETUP');
    assert.equal(redacted.direction, null);
    assert.equal(redacted.entry, null);
  });
});
