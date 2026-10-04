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
  touchedLevel: 'TP1' | 'TP2' | 'TP' | 'SL' | 'BOTH' | null;
  touchPrice: number;
  touchTimestamp: number;
  reason: string;
  displayMessage?: string;
  isTradeComplete?: boolean;
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
 * Checks whether a signal's Take Profit (TP #1, TP #2) or Stop Loss has been touched or crossed.
 * Evaluates live Binance price ticks and actual candle high & low wicks.
 * Does NOT use 24-hour ticker extremes to prevent false touches.
 *
 * STRICT BEHAVIOR:
 * - TP #1: Immediately marks WIN and locks trade as a win with display "tp #1 hit | r:r 1.50 | win"
 * - TP #2: Marks trade as fully completed with display "tp #2 hit | trade complete"
 * - Reversal: If price reverses to SL after TP #1 is hit, trade permanently remains a WIN
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
    reason: '',
    isTradeComplete: false
  };

  if (!signal || !signal.entryPrice || !signal.stopLoss) {
    return noTouch;
  }
  // If trade is already completed or marked LOSS/EXPIRED, no further touches
  if (signal.isTradeComplete || signal.status === 'LOSS' || signal.status === 'EXPIRED') {
    return noTouch;
  }

  const isUp = signal.direction === 'UP';
  const now = Date.now();

  const tp1 = signal.takeProfit1 || signal.takeProfit;
  const risk = Math.abs(signal.entryPrice - signal.stopLoss);
  const tp2 = signal.takeProfit2 || (isUp ? signal.entryPrice + risk * 2.5 : signal.entryPrice - risk * 2.5);
  const sl = signal.stopLoss;

  const rrRatio = signal.rewardRiskRatio || (risk > 0 ? Math.abs(tp1 - signal.entryPrice) / risk : 1.50);
  const rrStr = rrRatio.toFixed(2);

  // 1. EVALUATE LIVE PRICE TICK (Instant Binance WebSocket price)
  if (currentPrice !== null && !isNaN(currentPrice) && currentPrice > 0) {
    if (signal.tp1Hit) {
      // TP #1 already achieved: watch for TP #2 or trailing/reversal to SL
      const tp2Hit = isUp ? currentPrice >= tp2 : currentPrice <= tp2;
      const slHit = isUp ? currentPrice <= sl : currentPrice >= sl;

      if (tp2Hit) {
        return {
          isTouched: true,
          touchedLevel: 'TP2',
          touchPrice: tp2,
          touchTimestamp: now,
          reason: `Take profit #2 reached at $${currentPrice.toFixed(2)}`,
          displayMessage: 'tp #2 hit | trade complete',
          isTradeComplete: true
        };
      }
      if (slHit) {
        return {
          isTouched: true,
          touchedLevel: 'SL',
          touchPrice: sl,
          touchTimestamp: now,
          reason: `Trade completed: Reversal to SL after TP #1 secured`,
          displayMessage: `tp #1 hit | r:r ${rrStr} | win`,
          isTradeComplete: true
        };
      }
    } else {
      // TP #1 has not yet been hit
      if (isUp) {
        const tp2Hit = currentPrice >= tp2;
        const tp1Hit = currentPrice >= tp1;
        const slHit = currentPrice <= sl;

        if (tp1Hit && slHit) {
          return {
            isTouched: true,
            touchedLevel: 'BOTH',
            touchPrice: sl,
            touchTimestamp: now,
            reason: `Conservative SL: Live price crossed both TP1 ($${tp1.toFixed(2)}) and SL ($${sl.toFixed(2)})`,
            isTradeComplete: true
          };
        }
        if (tp2Hit) {
          return {
            isTouched: true,
            touchedLevel: 'TP2',
            touchPrice: tp2,
            touchTimestamp: now,
            reason: `Take profit #2 reached at $${currentPrice.toFixed(2)}`,
            displayMessage: 'tp #2 hit | trade complete',
            isTradeComplete: true
          };
        }
        if (tp1Hit) {
          return {
            isTouched: true,
            touchedLevel: 'TP1',
            touchPrice: tp1,
            touchTimestamp: now,
            reason: `Take profit #1 reached at $${currentPrice.toFixed(2)}`,
            displayMessage: `tp #1 hit | r:r ${rrStr} | win`,
            isTradeComplete: false
          };
        }
        if (slHit) {
          return {
            isTouched: true,
            touchedLevel: 'SL',
            touchPrice: sl,
            touchTimestamp: now,
            reason: `Stop loss touched at $${currentPrice.toFixed(2)}`,
            isTradeComplete: true
          };
        }
      } else {
        // Short Position
        const tp2Hit = currentPrice <= tp2;
        const tp1Hit = currentPrice <= tp1;
        const slHit = currentPrice >= sl;

        if (tp1Hit && slHit) {
          return {
            isTouched: true,
            touchedLevel: 'BOTH',
            touchPrice: sl,
            touchTimestamp: now,
            reason: `Conservative SL: Live price crossed both TP1 ($${tp1.toFixed(2)}) and SL ($${sl.toFixed(2)})`,
            isTradeComplete: true
          };
        }
        if (tp2Hit) {
          return {
            isTouched: true,
            touchedLevel: 'TP2',
            touchPrice: tp2,
            touchTimestamp: now,
            reason: `Take profit #2 reached at $${currentPrice.toFixed(2)}`,
            displayMessage: 'tp #2 hit | trade complete',
            isTradeComplete: true
          };
        }
        if (tp1Hit) {
          return {
            isTouched: true,
            touchedLevel: 'TP1',
            touchPrice: tp1,
            touchTimestamp: now,
            reason: `Take profit #1 reached at $${currentPrice.toFixed(2)}`,
            displayMessage: `tp #1 hit | r:r ${rrStr} | win`,
            isTradeComplete: false
          };
        }
        if (slHit) {
          return {
            isTouched: true,
            touchedLevel: 'SL',
            touchPrice: sl,
            touchTimestamp: now,
            reason: `Stop loss touched at $${currentPrice.toFixed(2)}`,
            isTradeComplete: true
          };
        }
      }
    }
  }

  // 2. EVALUATE CANDLE HIGH AND LOW WICKS
  if (candles && candles.length > 0) {
    const signalStart = signal.timestamp ? signal.timestamp - 30000 : 0;
    const relevantCandles = candles
      .filter((c) => (c.closeTime || c.openTime + 60000) >= signalStart)
      .sort((a, b) => a.openTime - b.openTime);

    for (const candle of relevantCandles) {
      if (signal.tp1Hit) {
        const tp2Hit = isUp ? candle.high >= tp2 : candle.low <= tp2;
        const slHit = isUp ? candle.low <= sl : candle.high >= sl;

        if (tp2Hit) {
          return {
            isTouched: true,
            touchedLevel: 'TP2',
            touchPrice: tp2,
            touchTimestamp: candle.openTime,
            reason: `Take profit #2 reached on candle wick at $${tp2.toFixed(2)}`,
            displayMessage: 'tp #2 hit | trade complete',
            isTradeComplete: true
          };
        }
        if (slHit) {
          return {
            isTouched: true,
            touchedLevel: 'SL',
            touchPrice: sl,
            touchTimestamp: candle.openTime,
            reason: `Trade completed: Reversal to SL after TP #1 secured`,
            displayMessage: `tp #1 hit | r:r ${rrStr} | win`,
            isTradeComplete: true
          };
        }
      } else {
        if (isUp) {
          const tp2Hit = candle.high >= tp2;
          const tp1Hit = candle.high >= tp1;
          const slHit = candle.low <= sl;

          if (tp1Hit && slHit) {
            return {
              isTouched: true,
              touchedLevel: 'BOTH',
              touchPrice: sl,
              touchTimestamp: candle.openTime,
              reason: `Conservative SL: Candle wick high/low ($${candle.high.toFixed(2)} / $${candle.low.toFixed(2)}) touched both TP1 and SL`,
              isTradeComplete: true
            };
          }
          if (tp2Hit) {
            return {
              isTouched: true,
              touchedLevel: 'TP2',
              touchPrice: tp2,
              touchTimestamp: candle.openTime,
              reason: `Take profit #2 reached on candle wick high at $${candle.high.toFixed(2)}`,
              displayMessage: 'tp #2 hit | trade complete',
              isTradeComplete: true
            };
          }
          if (tp1Hit) {
            return {
              isTouched: true,
              touchedLevel: 'TP1',
              touchPrice: tp1,
              touchTimestamp: candle.openTime,
              reason: `Take profit #1 reached on candle wick high at $${candle.high.toFixed(2)}`,
              displayMessage: `tp #1 hit | r:r ${rrStr} | win`,
              isTradeComplete: false
            };
          }
          if (slHit) {
            return {
              isTouched: true,
              touchedLevel: 'SL',
              touchPrice: sl,
              touchTimestamp: candle.openTime,
              reason: `Stop loss reached on candle wick low at $${candle.low.toFixed(2)}`,
              isTradeComplete: true
            };
          }
        } else {
          // Short Position
          const tp2Hit = candle.low <= tp2;
          const tp1Hit = candle.low <= tp1;
          const slHit = candle.high >= sl;

          if (tp1Hit && slHit) {
            return {
              isTouched: true,
              touchedLevel: 'BOTH',
              touchPrice: sl,
              touchTimestamp: candle.openTime,
              reason: `Conservative SL: Candle wick high/low ($${candle.high.toFixed(2)} / $${candle.low.toFixed(2)}) touched both TP1 and SL`,
              isTradeComplete: true
            };
          }
          if (tp2Hit) {
            return {
              isTouched: true,
              touchedLevel: 'TP2',
              touchPrice: tp2,
              touchTimestamp: candle.openTime,
              reason: `Take profit #2 reached on candle wick low at $${candle.low.toFixed(2)}`,
              displayMessage: 'tp #2 hit | trade complete',
              isTradeComplete: true
            };
          }
          if (tp1Hit) {
            return {
              isTouched: true,
              touchedLevel: 'TP1',
              touchPrice: tp1,
              touchTimestamp: candle.openTime,
              reason: `Take profit #1 reached on candle wick low at $${candle.low.toFixed(2)}`,
              displayMessage: `tp #1 hit | r:r ${rrStr} | win`,
              isTradeComplete: false
            };
          }
          if (slHit) {
            return {
              isTouched: true,
              touchedLevel: 'SL',
              touchPrice: sl,
              touchTimestamp: candle.openTime,
              reason: `Stop loss reached on candle wick high at $${candle.high.toFixed(2)}`,
              isTradeComplete: true
            };
          }
        }
      }
    }
  }

  return noTouch;
}
