/**
 * NWWT Professional Stop Loss and Take Profit Touch Engine
 *
 * Implements:
 * - Real-time price touch detection against Binance live price ticks & actual candle wicks
 * - Direction-aware logic (UP/Long vs DOWN/Short)
 * - Immediate detection when live price touches or crosses either level
 * - Accurate candle high and low wick inspection for in-progress and closed candles
 * - Conservative rule: If both TP and SL are touched in the same period, records LOSS
 * - Automatic and immediate removal of both TP and SL lines when either level is reached
 * - Persistent cleared signal registry ('nwwt_cleared_signal_lines') to prevent lines returning on zoom/pan/timeframe switch
 * - Strict isolation: Each signal manages its own levels without affecting other signals or manual user drawings
 */

import { Candle, ScannerSignalItem } from '../types.ts';

export interface SignalTouchResult {
  isTouched: boolean;
  touchedLevel: 'TP' | 'SL' | 'BOTH' | null;
  touchPrice: number;
  touchTimestamp: number;
  reason: string;
}

export const CLEARED_SIGNALS_STORAGE_KEY = 'nwwt_cleared_signal_lines';

/**
 * Loads the persistent set of signal IDs whose lines have been cleared
 */
export function loadClearedSignalIds(): Set<string> {
  try {
    const raw = localStorage.getItem(CLEARED_SIGNALS_STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch {
    return new Set();
  }
}

/**
 * Registers a signal ID as permanently cleared so its TP and SL lines never reappear
 */
export function addClearedSignalId(signalId: string): void {
  if (!signalId) return;
  try {
    const current = loadClearedSignalIds();
    current.add(signalId);
    // Keep max 500 recent IDs to avoid unbounded storage
    const trimmed = Array.from(current).slice(-500);
    localStorage.setItem(CLEARED_SIGNALS_STORAGE_KEY, JSON.stringify(trimmed));

    // Dispatch custom event to notify all active chart components in the current window
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('nwwt_signal_cleared', { detail: { signalId } }));
    }
  } catch (err) {
    console.warn('[SignalTouchEngine] Failed to save cleared signal ID:', err);
  }
}

/**
 * Checks whether a signal's Take Profit or Stop Loss has been touched or crossed.
 * Evaluates live Binance price ticks and actual candle high & low wicks.
 * Does NOT use 24-hour ticker extremes to prevent false touches.
 */
export function checkSignalTouch(
  signal: ScannerSignalItem,
  currentPrice: number | null,
  candles?: Candle[]
): SignalTouchResult {
  const noTouch: SignalTouchResult = {
    isTouched: false,
    touchedLevel: null,
    touchPrice: 0,
    touchTimestamp: 0,
    reason: ''
  };

  if (!signal || signal.status !== 'ACTIVE' || !signal.entryPrice || !signal.takeProfit || !signal.stopLoss) {
    return noTouch;
  }

  const isUp = signal.direction === 'UP';
  const now = Date.now();

  // 1. EVALUATE LIVE PRICE TICK (Instant Binance WebSocket price)
  if (currentPrice !== null && !isNaN(currentPrice) && currentPrice > 0) {
    if (isUp) {
      // Long / Buy Position
      const tpHit = currentPrice >= signal.takeProfit;
      const slHit = currentPrice <= signal.stopLoss;

      if (tpHit && slHit) {
        return {
          isTouched: true,
          touchedLevel: 'BOTH',
          touchPrice: signal.stopLoss,
          touchTimestamp: now,
          reason: `Conservative SL: Live price tick crossed both TP ($${signal.takeProfit.toFixed(2)}) and SL ($${signal.stopLoss.toFixed(2)})`
        };
      }
      if (tpHit) {
        return {
          isTouched: true,
          touchedLevel: 'TP',
          touchPrice: signal.takeProfit,
          touchTimestamp: now,
          reason: `Take Profit touched at $${currentPrice.toFixed(2)}`
        };
      }
      if (slHit) {
        return {
          isTouched: true,
          touchedLevel: 'SL',
          touchPrice: signal.stopLoss,
          touchTimestamp: now,
          reason: `Stop Loss touched at $${currentPrice.toFixed(2)}`
        };
      }
    } else {
      // Short / Sell Position
      const tpHit = currentPrice <= signal.takeProfit;
      const slHit = currentPrice >= signal.stopLoss;

      if (tpHit && slHit) {
        return {
          isTouched: true,
          touchedLevel: 'BOTH',
          touchPrice: signal.stopLoss,
          touchTimestamp: now,
          reason: `Conservative SL: Live price tick crossed both TP ($${signal.takeProfit.toFixed(2)}) and SL ($${signal.stopLoss.toFixed(2)})`
        };
      }
      if (tpHit) {
        return {
          isTouched: true,
          touchedLevel: 'TP',
          touchPrice: signal.takeProfit,
          touchTimestamp: now,
          reason: `Take Profit touched at $${currentPrice.toFixed(2)}`
        };
      }
      if (slHit) {
        return {
          isTouched: true,
          touchedLevel: 'SL',
          touchPrice: signal.stopLoss,
          touchTimestamp: now,
          reason: `Stop Loss touched at $${currentPrice.toFixed(2)}`
        };
      }
    }
  }

  // 2. EVALUATE CANDLE HIGH AND LOW WICKS
  // Inspect candles formed during or after signal creation (with a small 30s buffer for candle alignment)
  if (candles && candles.length > 0) {
    const signalStart = signal.timestamp ? signal.timestamp - 30000 : 0;
    const relevantCandles = candles
      .filter((c) => (c.closeTime || c.openTime + 60000) >= signalStart)
      .sort((a, b) => a.openTime - b.openTime);

    for (const candle of relevantCandles) {
      if (isUp) {
        // Long Position
        const tpHit = candle.high >= signal.takeProfit;
        const slHit = candle.low <= signal.stopLoss;

        if (tpHit && slHit) {
          return {
            isTouched: true,
            touchedLevel: 'BOTH',
            touchPrice: signal.stopLoss,
            touchTimestamp: candle.openTime,
            reason: `Conservative SL: Candle wick high/low ($${candle.high.toFixed(2)} / $${candle.low.toFixed(2)}) touched both TP and SL`
          };
        }
        if (tpHit) {
          return {
            isTouched: true,
            touchedLevel: 'TP',
            touchPrice: signal.takeProfit,
            touchTimestamp: candle.openTime,
            reason: `Take Profit reached on candle wick high at $${candle.high.toFixed(2)}`
          };
        }
        if (slHit) {
          return {
            isTouched: true,
            touchedLevel: 'SL',
            touchPrice: signal.stopLoss,
            touchTimestamp: candle.openTime,
            reason: `Stop Loss reached on candle wick low at $${candle.low.toFixed(2)}`
          };
        }
      } else {
        // Short Position
        const tpHit = candle.low <= signal.takeProfit;
        const slHit = candle.high >= signal.stopLoss;

        if (tpHit && slHit) {
          return {
            isTouched: true,
            touchedLevel: 'BOTH',
            touchPrice: signal.stopLoss,
            touchTimestamp: candle.openTime,
            reason: `Conservative SL: Candle wick high/low ($${candle.high.toFixed(2)} / $${candle.low.toFixed(2)}) touched both TP and SL`
          };
        }
        if (tpHit) {
          return {
            isTouched: true,
            touchedLevel: 'TP',
            touchPrice: signal.takeProfit,
            touchTimestamp: candle.openTime,
            reason: `Take Profit reached on candle wick low at $${candle.low.toFixed(2)}`
          };
        }
        if (slHit) {
          return {
            isTouched: true,
            touchedLevel: 'SL',
            touchPrice: signal.stopLoss,
            touchTimestamp: candle.openTime,
            reason: `Stop Loss reached on candle wick high at $${candle.high.toFixed(2)}`
          };
        }
      }
    }
  }

  return noTouch;
}
