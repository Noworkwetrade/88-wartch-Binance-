/**
 * NWWT Signal Touch & Trade Lifecycle Engine
 *
 * Implements strict trade lifecycle settlement:
 * 1. TP1 -> Reversal to SL: Permanently settles as WIN at TP1 (realizedR = tp1R, NOT -1R)
 * 2. SL before TP1: Settles as LOSS at SL (realizedR = -1R)
 * 3. Short / Bearish mirror: TP1 -> SL settles as WIN at TP1
 * 4. Wick ambiguity (Both TP1 and SL touched in same candle/tick): Conservative LOSS
 * 5. Completed signal cannot reappear in getActive() or subsequent scan cycles
 * 6. Persistent cleared-ID registry: Completed signal ID added to registry; subsequent updates are no-op
 */

export class SignalTouchEngine {
  constructor() {
    /** @type {Map<string, Object>} */
    this.signals = new Map();
    /** @type {Set<string>} */
    this.clearedIds = new Set();
  }

  /**
   * Registers a new signal for lifecycle tracking.
   * If signal ID is already cleared, registration is rejected (no-op).
   */
  registerSignal(signal) {
    if (!signal || !signal.id) return null;
    if (this.clearedIds.has(signal.id)) {
      return null;
    }
    const entry = signal.entry !== undefined ? signal.entry : signal.entryPrice;
    const tp1 = signal.takeProfit1 !== undefined ? signal.takeProfit1 : signal.takeProfit;
    const sl = signal.stopLoss;
    const tp2 = signal.takeProfit2 !== undefined ? signal.takeProfit2 : (signal.direction === 'DOWN' ? entry - Math.abs(entry - sl) * 2.5 : entry + Math.abs(entry - sl) * 2.5);
    const risk = Math.abs(entry - sl);
    const tp1Dist = Math.abs(tp1 - entry);
    const tp1R = risk > 0 ? parseFloat((tp1Dist / risk).toFixed(2)) : 1.0;

    const normalized = {
      ...signal,
      status: signal.status || 'active',
      outcome: signal.outcome || null,
      settledAtLevel: signal.settledAtLevel || null,
      tp1Hit: Boolean(signal.tp1Hit),
      tp2Hit: Boolean(signal.tp2Hit),
      isTradeComplete: Boolean(signal.isTradeComplete),
      realizedR: signal.realizedR !== undefined ? signal.realizedR : null,
      tp1R,
      entry,
      entryPrice: entry,
      stopLoss: sl,
      takeProfit1: tp1,
      takeProfit: tp1,
      takeProfit2: tp2,
      direction: signal.direction || 'UP'
    };

    this.signals.set(signal.id, normalized);
    return normalized;
  }

  /**
   * Returns all active, uncompleted signals
   */
  getActive() {
    return Array.from(this.signals.values()).filter(
      (s) => s.status === 'active' && !s.isTradeComplete && !this.clearedIds.has(s.id)
    );
  }

  /**
   * Returns all tracked signals
   */
  getAll() {
    return Array.from(this.signals.values());
  }

  /**
   * Returns the persistent set of cleared IDs
   */
  getClearedIds() {
    return new Set(this.clearedIds);
  }

  /**
   * Evaluates a live price tick against an active signal
   */
  evaluateTick(signalId, price, timestamp = Date.now()) {
    if (this.clearedIds.has(signalId)) {
      return null; // Cleared signals are never mutated
    }

    const signal = this.signals.get(signalId);
    if (!signal || signal.isTradeComplete || signal.status === 'completed') {
      return signal;
    }

    const isLong = signal.direction === 'UP' || signal.direction === 'LONG';
    const tp1 = signal.takeProfit1;
    const tp2 = signal.takeProfit2;
    const sl = signal.stopLoss;

    if (signal.tp1Hit) {
      // TP1 was already secured: check for TP2 completion or reversal to SL
      const tp2Hit = isLong ? price >= tp2 : price <= tp2;
      const slHit = isLong ? price <= sl : price >= sl;

      if (tp2Hit) {
        signal.tp2Hit = true;
        signal.status = 'completed';
        signal.outcome = 'win';
        signal.settledAtLevel = 'tp2';
        signal.isTradeComplete = true;
        signal.realizedR = signal.tp2R || (signal.tp1R * 1.6);
        signal.completedAt = timestamp;
        this.clearedIds.add(signal.id);
        return signal;
      }

      if (slHit) {
        // Documented behavior: trade hitting TP1 then reversing to SL settles as a WIN, not a loss!
        signal.status = 'completed';
        signal.outcome = 'win';
        signal.settledAtLevel = 'tp1';
        signal.isTradeComplete = true;
        signal.realizedR = signal.tp1R;
        signal.completedAt = timestamp;
        this.clearedIds.add(signal.id);
        return signal;
      }
    } else {
      // TP1 has not yet been hit
      const tp1Hit = isLong ? price >= tp1 : price <= tp1;
      const slHit = isLong ? price <= sl : price >= sl;

      // Ambiguity / conservative rule
      if (tp1Hit && slHit) {
        signal.status = 'completed';
        signal.outcome = 'loss';
        signal.settledAtLevel = 'sl';
        signal.isTradeComplete = true;
        signal.realizedR = -1.0;
        signal.completedAt = timestamp;
        this.clearedIds.add(signal.id);
        return signal;
      }

      if (tp1Hit) {
        // TP1 reached: Lock in outcome as WIN immediately, keep active to track TP2 or reversal
        signal.tp1Hit = true;
        signal.outcome = 'win';
        signal.settledAtLevel = 'tp1';
        signal.realizedR = signal.tp1R;
        signal.tp1HitTimestamp = timestamp;
        // Status remains active so subsequent ticks can track TP2 or SL reversal
        return signal;
      }

      if (slHit) {
        // Direct SL hit before TP1
        signal.status = 'completed';
        signal.outcome = 'loss';
        signal.settledAtLevel = 'sl';
        signal.isTradeComplete = true;
        signal.realizedR = -1.0;
        signal.completedAt = timestamp;
        this.clearedIds.add(signal.id);
        return signal;
      }
    }

    return signal;
  }

  /**
   * Evaluates a synthetic or real candle against an active signal
   */
  evaluateCandle(signalId, candle) {
    if (this.clearedIds.has(signalId)) {
      return null;
    }

    const signal = this.signals.get(signalId);
    if (!signal || signal.isTradeComplete || signal.status === 'completed') {
      return signal;
    }

    const isLong = signal.direction === 'UP' || signal.direction === 'LONG';
    const tp1 = signal.takeProfit1;
    const sl = signal.stopLoss;

    const tp1Hit = isLong ? candle.high >= tp1 : candle.low <= tp1;
    const slHit = isLong ? candle.low <= sl : candle.high >= sl;

    // RULE 4: Both TP1 and SL touched in the same tick/candle -> CONSERVATIVE LOSS
    if (tp1Hit && slHit) {
      signal.status = 'completed';
      signal.outcome = 'loss';
      signal.settledAtLevel = 'sl';
      signal.isTradeComplete = true;
      signal.realizedR = -1.0;
      signal.completedAt = candle.openTime || Date.now();
      this.clearedIds.add(signal.id);
      return signal;
    }

    if (signal.tp1Hit) {
      if (slHit) {
        signal.status = 'completed';
        signal.outcome = 'win';
        signal.settledAtLevel = 'tp1';
        signal.isTradeComplete = true;
        signal.realizedR = signal.tp1R;
        signal.completedAt = candle.openTime || Date.now();
        this.clearedIds.add(signal.id);
        return signal;
      }
    } else {
      if (tp1Hit) {
        signal.tp1Hit = true;
        signal.outcome = 'win';
        signal.settledAtLevel = 'tp1';
        signal.realizedR = signal.tp1R;
        return signal;
      }
      if (slHit) {
        signal.status = 'completed';
        signal.outcome = 'loss';
        signal.settledAtLevel = 'sl';
        signal.isTradeComplete = true;
        signal.realizedR = -1.0;
        signal.completedAt = candle.openTime || Date.now();
        this.clearedIds.add(signal.id);
        return signal;
      }
    }

    return signal;
  }

  /**
   * Simulates a scan cycle: tries to register candidate signals.
   * If a candidate ID has been cleared or is already completed, it is rejected.
   */
  runScanCycle(candidates = []) {
    const newlyAdded = [];
    for (const c of candidates) {
      if (!c || !c.id) continue;
      if (this.clearedIds.has(c.id)) {
        continue; // Strictly reject resurrecting cleared signal
      }
      const existing = this.signals.get(c.id);
      if (existing && (existing.isTradeComplete || existing.status === 'completed')) {
        continue;
      }
      if (!existing) {
        const registered = this.registerSignal(c);
        if (registered) newlyAdded.push(registered);
      }
    }
    return newlyAdded;
  }

  /**
   * Update signal: if ID is in cleared registry, update is a strict no-op.
   */
  updateSignal(signal) {
    if (!signal || !signal.id) return false;
    if (this.clearedIds.has(signal.id)) {
      return false; // Persistent cleared-ID registry: no-op
    }
    const existing = this.signals.get(signal.id);
    if (!existing) return false;
    if (existing.isTradeComplete || existing.status === 'completed') {
      return false;
    }
    this.signals.set(signal.id, { ...existing, ...signal });
    return true;
  }
}
