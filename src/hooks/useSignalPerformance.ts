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

export function useSignalPerformance(
  incomingSignals: ScannerSignalItem[],
  tickersMap: Map<string, TickerData>
) {
  // 1. Initial State loaded from localStorage
  const [signals, setSignals] = useState<ScannerSignalItem[]>(() => {
    return loadStoredSignals();
  });

  const signalsRef = useRef<ScannerSignalItem[]>(signals);
  signalsRef.current = signals;

  // 2. Merge incoming scanner signals whenever scanner updates
  useEffect(() => {
    if (!incomingSignals || incomingSignals.length === 0) return;

    setSignals((prev) => {
      const merged = mergeScannerSignals(prev, incomingSignals);
      saveStoredSignals(merged);
      return merged;
    });
  }, [incomingSignals]);

  // Synchronize when a signal is settled on chart
  useEffect(() => {
    const handleSettled = () => {
      setSignals(loadStoredSignals());
    };
    window.addEventListener('nwwt_signal_settled', handleSettled);
    return () => window.removeEventListener('nwwt_signal_settled', handleSettled);
  }, []);

  // 3. Monitor active signals using live market ticks
  // Throttle evaluation to avoid unnecessary renders on rapid ticks
  const lastEvalTimeRef = useRef<number>(0);

  useEffect(() => {
    const activeList = signalsRef.current.filter((s) => s.status === 'ACTIVE');
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

  // 4. Derived collections and metrics
  const activeSignals = useMemo(() => {
    return signals.filter((s) => s.status === 'ACTIVE');
  }, [signals]);

  const completedSignals = useMemo(() => {
    return signals.filter((s) => s.status !== 'ACTIVE');
  }, [signals]);

  const stats: SignalPerformanceStats = useMemo(() => {
    return calculatePerformanceStats(signals);
  }, [signals]);

  const clearHistory = useCallback(() => {
    // Retain only active signals, clear completed
    setSignals((prev) => {
      const kept = prev.filter((s) => s.status === 'ACTIVE');
      saveStoredSignals(kept);
      return kept;
    });
  }, []);

  return {
    signals,
    activeSignals,
    completedSignals,
    stats,
    clearHistory
  };
}
