/**
 * Public API Redaction Utilities
 *
 * Ensures that internal diagnostics, score calculations, debug traces,
 * market structure internals, and raw candle series are strictly stripped
 * from all public responses.
 */

export const ALLOWED_PUBLIC_KEYS = new Set([
  'symbol',
  'timeframe',
  'direction',
  'entry',
  'stopLoss',
  'takeProfit1',
  'takeProfit2',
  'rewardRisk',
  // 'confidence' is an explicit user-facing heuristic indicator (0-100 integer) displayed
  // on public setup cards in the UI for trader readability. It is a bounded display metric
  // and cannot be back-derived into proprietary internal quality scores, structural weights,
  // or underlying model diagnostics.
  'confidence',
  'timestamp',
  'status'
]);

/**
 * Redacts a single-asset scan result to the strictly authorized public schema.
 *
 * Allowed fields ONLY:
 * - symbol
 * - timeframe
 * - direction
 * - entry
 * - stopLoss
 * - takeProfit1
 * - takeProfit2
 * - rewardRisk
 * - confidence (if user-facing)
 * - timestamp
 * - status
 */
export function redactSingleAssetScan(scanResult, fallbackParams = {}) {
  if (!scanResult) {
    return {
      symbol: fallbackParams.symbol || 'BTCUSDT',
      timeframe: fallbackParams.timeframe || '15m',
      direction: null,
      entry: null,
      stopLoss: null,
      takeProfit1: null,
      takeProfit2: null,
      rewardRisk: null,
      confidence: null,
      timestamp: Date.now(),
      status: 'NO_SETUP'
    };
  }

  // Find candidate signal from possible result shapes
  const signal =
    scanResult.originalSignal ||
    scanResult.aiFilteredSignal ||
    scanResult.signal ||
    (scanResult.entry || scanResult.entryPrice ? scanResult : null);

  const sym =
    signal?.asset ||
    signal?.symbol ||
    scanResult?.asset ||
    scanResult?.symbol ||
    fallbackParams?.symbol ||
    'BTCUSDT';

  const tf =
    signal?.timeframe ||
    scanResult?.timeframe ||
    fallbackParams?.timeframe ||
    '15m';

  const hasSetup = Boolean(signal && (signal.entryPrice || signal.entry) && signal.direction);

  const publicResponse = {
    symbol: sym,
    timeframe: tf,
    direction: hasSetup ? signal.direction : null,
    entry: hasSetup ? (signal.entryPrice ?? signal.entry ?? null) : null,
    stopLoss: hasSetup ? (signal.stopLoss ?? null) : null,
    takeProfit1: hasSetup ? (signal.takeProfit1 ?? signal.takeProfit ?? null) : null,
    takeProfit2: hasSetup ? (signal.takeProfit2 ?? null) : null,
    rewardRisk: hasSetup ? (signal.rewardRiskRatio ?? signal.rewardRisk ?? null) : null,
    confidence: hasSetup ? (signal.confidence ?? null) : null,
    timestamp: (signal && signal.timestamp) || scanResult.timestamp || Date.now(),
    status: hasSetup ? (signal.status || 'ACTIVE') : 'NO_SETUP'
  };

  // Redaction defense-in-depth: delete any key that is not in the explicit whitelist
  for (const key of Object.keys(publicResponse)) {
    if (!ALLOWED_PUBLIC_KEYS.has(key)) {
      delete publicResponse[key];
    }
  }

  return publicResponse;
}
