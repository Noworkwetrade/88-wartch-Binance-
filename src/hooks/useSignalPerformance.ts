/**
 * Hook for NWWT V8 Signal Performance Engine
 *
 * Automatically monitors all active technical scanner signals using live market data:
 * - Records WIN when TP is reached
 * - Records LOSS when SL is reached
 * - Conservative rule: If both TP and SL are hit, records LOSS
 * - Keeps watching until defined expiry period
 * - Persists all active and completed signals in localStorage
 * - Computes real-time statistics and TP rates across setup types, timeframes, and directions
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { ScannerSignalItem, SignalPerformanceStats, TickerData } from '../types.ts';
import {
  loadStoredSignals,
  saveStoredSignals,
  mergeScannerSignals,
  evaluateSignalsWithTicker,
  calculatePerformanceStats
} from '../utils/performanceEngine.ts';
import { loadClearedSignalIds } from '../utils/signalTouchEngine.ts';

export function useSignalPerformance(
  incomingSignals: ScannerSignalItem[],
  tickersMap: Map<string, TickerData>,
  incomingCompleted?: ScannerSignalItem[]
) {
  // 1. Initial State loaded from localStorage
  const [signals, setSignals] = useState<ScannerSignalItem[]>(() => {
    return loadStoredSignals();
  });

  const signalsRef = useRef<ScannerSignalItem[]>(signals);
  signalsRef.current = signals;

  // 2. Merge incoming scanner signals whenever scanner updates
  useEffect(() => {
    const listToMerge = [...(incomingSignals || []), ...(incomingCompleted || [])];
    if (listToMerge.length === 0) return;

    const currentSignals = signalsRef.current;
    const merged = mergeScannerSignals(currentSignals, listToMerge);
    saveStoredSignals(merged);
    setSignals(merged);
  }, [incomingSignals, incomingCompleted]);

  // Synchronize when a signal is settled or cleared on chart
  useEffect(() => {
    const handleSettled = () => {
      setSignals(loadStoredSignals());
    };
    window.addEventListener('nwwt_signal_settled', handleSettled);
    window.addEventListener('nwwt_signal_cleared', handleSettled);
    return () => {
      window.removeEventListener('nwwt_signal_settled', handleSettled);
      window.removeEventListener('nwwt_signal_cleared', handleSettled);
    };
  }, []);

  // 3. Monitor active signals using live market ticks
  // Throttle evaluation to avoid unnecessary renders on rapid ticks
  const lastEvalTimeRef = useRef<number>(0);

  useEffect(() => {
    const clearedSet = loadClearedSignalIds();
    const activeList = signalsRef.current.filter(
      (s) => s.status === 'ACTIVE' && !s.isTradeComplete && !s.tp1Hit && !clearedSet.has(s.id)
    );
    if (activeList.length === 0) return;

    const now = Date.now();
    // Evaluate at most once every 120ms
    if (now - lastEvalTimeRef.current < 120) return;
    lastEvalTimeRef.current = now;

    let anyChanged = false;
    let currentSignals = signalsRef.current;

    for (const active of activeList) {
      const ticker = tickersMap.get(active.asset);
      if (!ticker || ticker.lastPrice === '--') continue;

      const lastPrice = parseFloat(ticker.lastPrice);
      const res = evaluateSignalsWithTicker(currentSignals, active.asset, lastPrice);
      if (res.changed) {
        currentSignals = res.updatedSignals;
        anyChanged = true;
      }
    }

    if (anyChanged) {
      setSignals(currentSignals);
      saveStoredSignals(currentSignals);
    }
  }, [tickersMap]);

  // Periodic fallback check every 600ms to guarantee any active signal is evaluated against latest ticker prices
  useEffect(() => {
    const timer = setInterval(() => {
      const clearedSet = loadClearedSignalIds();
      const activeList = signalsRef.current.filter(
        (s) => s.status === 'ACTIVE' && !s.isTradeComplete && !s.tp1Hit && !clearedSet.has(s.id)
      );
      if (activeList.length === 0) return;

      let anyChanged = false;
      let currentSignals = signalsRef.current;

      for (const active of activeList) {
        const ticker = tickersMap.get(active.asset);
        if (!ticker || ticker.lastPrice === '--') continue;

        const lastPrice = parseFloat(ticker.lastPrice);
        const res = evaluateSignalsWithTicker(currentSignals, active.asset, lastPrice);
        if (res.changed) {
          currentSignals = res.updatedSignals;
          anyChanged = true;
        }
      }

      if (anyChanged) {
        setSignals(currentSignals);
        saveStoredSignals(currentSignals);
      }
    }, 600);

    return () => clearInterval(timer);
  }, [tickersMap]);

  // 4. Derived collections and metrics
  // STRICT REQUIREMENT: Active signals ONLY contain genuinely active, uncleared setups.
  // Any signal that reached TP or SL is immediately counted as win/loss and excluded from active signals!
  const activeSignals = useMemo(() => {
    const clearedSet = loadClearedSignalIds();
    return signals.filter(
      (s) => s.status === 'ACTIVE' && !s.isTradeComplete && !s.tp1Hit && !clearedSet.has(s.id)
    );
  }, [signals]);

  const completedSignals = useMemo(() => {
    const clearedSet = loadClearedSignalIds();
    return signals.filter(
      (s) => s.status !== 'ACTIVE' || s.isTradeComplete || s.tp1Hit || clearedSet.has(s.id)
    );
  }, [signals]);

  const stats: SignalPerformanceStats = useMemo(() => {
    return calculatePerformanceStats(signals);
  }, [signals]);

  const clearHistory = useCallback(() => {
    // Retain only genuinely active signals, clear completed
    const clearedSet = loadClearedSignalIds();
    const kept = signalsRef.current.filter((s) => s.status === 'ACTIVE' && !clearedSet.has(s.id));
    saveStoredSignals(kept);
    setSignals(kept);
  }, []);

  return {
    signals,
    activeSignals,
    completedSignals,
    stats,
    clearHistory
  };
}
