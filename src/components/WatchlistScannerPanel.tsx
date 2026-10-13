/**
 * NWWT Watchlist Scanner & Signal Terminal
 *
 * Finished trading interface displaying real-time market signals,
 * active setups, settled outcomes, and clean trade levels.
 *
 * Educational market analysis only. Never provides automated trade execution.
 */

import React, { useState, useMemo, useEffect } from 'react';
import {
  TrendingUp,
  TrendingDown,
  RefreshCw,
  Clock,
  ArrowRight,
  Layers,
  Sparkles,
  CheckCircle2,
  Trash2,
  X
} from 'lucide-react';
import {
  ScannerState,
  Timeframe,
  ScannerSignalItem,
  SignalPerformanceStats
} from '../types.ts';
import { formatPrice } from './WatchlistTable.tsx';
import { loadClearedSignalIds } from '../utils/signalTouchEngine.ts';
import { isPermanentlyExcludedSymbol } from '../utils/marketStructureQuality.ts';
import { ScanAssetModal, SingleAssetEvaluation } from './scanner/ScanAssetModal.tsx';

interface WatchlistScannerPanelProps {
  scannerState: ScannerState;
  selectedAsset: string | null;
  onSelectAsset: (symbol: string, timeframe?: string, signal?: ScannerSignalItem | null) => void;
  onTimeframeChange: (tf: Timeframe) => void;
  onTriggerScan: (tf?: Timeframe) => void;
  onUpdateScannerConfig?: (config: {
    timeframe?: Timeframe;
    htfConfirmationEnabled?: boolean;
    htfTimeframe?: Timeframe;
    htfRuleMode?: 'lenient' | 'aligned' | 'strict';
  }) => void;
  performanceSignals: ScannerSignalItem[];
  activeSignals?: ScannerSignalItem[];
  completedSignals?: ScannerSignalItem[];
  performanceStats: SignalPerformanceStats;
  onClearHistory?: () => void;
}

const SCANNER_TIMEFRAMES: Timeframe[] = ['1m', '5m', '15m', '30m', '1h', '4h', '1d'];

function formatCandleCloseTime(timestamp?: number): string {
  if (!timestamp) return '--';
  const d = new Date(timestamp);
  const timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const utcStr = d.toISOString().slice(11, 19) + ' UTC';
  return `${timeStr} (${utcStr})`;
}

export const WatchlistScannerPanel: React.FC<WatchlistScannerPanelProps> = ({
  scannerState,
  selectedAsset,
  onSelectAsset,
  onTimeframeChange,
  onTriggerScan,
  performanceSignals,
  activeSignals,
  completedSignals,
  onClearHistory
}) => {
  const { status, timeframe } = scannerState;
  const isScanning = status === 'scanning';

  // Signals View Mode: 'active' (default active scanner) | 'completed_history' (separate completed view)
  const [signalViewMode, setSignalViewMode] = useState<'active' | 'completed_history'>('active');
  // Outcome filter for completed history
  const [historyFilter, setHistoryFilter] = useState<'all' | 'wins' | 'losses'>('all');

  // Single asset scanning state
  const [isScanningSpecificAsset, setIsScanningSpecificAsset] = useState<boolean>(false);
  const [scanMessage, setScanMessage] = useState<string | null>(null);
  const [isScanModalOpen, setIsScanModalOpen] = useState<boolean>(false);
  const [singleAssetEvaluation, setSingleAssetEvaluation] = useState<SingleAssetEvaluation | null>(null);
  const [scannedSignal, setScannedSignal] = useState<ScannerSignalItem | null>(null);

  // Synchronize when a signal is cleared or settled
  const [clearedSignalIds, setClearedSignalIds] = useState<Set<string>>(loadClearedSignalIds);

  useEffect(() => {
    const handleSync = () => {
      setClearedSignalIds(loadClearedSignalIds());
    };
    window.addEventListener('nwwt_signal_cleared', handleSync);
    window.addEventListener('nwwt_signal_settled', handleSync);
    return () => {
      window.removeEventListener('nwwt_signal_cleared', handleSync);
      window.removeEventListener('nwwt_signal_settled', handleSync);
    };
  }, []);

  /**
   * Scans the specific asset currently selected on the chart.
   */
  const handleScanMarket = async () => {
    const target = selectedAsset || 'BTCUSDT';
    if (isPermanentlyExcludedSymbol(target)) {
      setScanMessage(`${target} is not available for scanning.`);
      return;
    }
    setIsScanningSpecificAsset(true);
    setScanMessage(`Scanning ${target} (${timeframe})...`);

    try {
      const res = await fetch('/api/scanner/scan-asset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol: target, timeframe })
      });
      const data = await res.json();
      const directSignal = data && data.direction ? {
        id: `scan-${data.symbol}-${data.timeframe}-${data.timestamp}`,
        asset: data.symbol,
        timeframe: data.timeframe,
        direction: data.direction,
        setupType: data.direction === 'UP' ? 'Long Setup' : 'Short Setup',
        entryPrice: data.entry,
        signalPrice: data.entry,
        stopLoss: data.stopLoss,
        takeProfit1: data.takeProfit1,
        takeProfit2: data.takeProfit2,
        rewardRiskRatio: data.rewardRisk,
        confidence: data.confidence,
        timestamp: data.timestamp,
        status: data.status || 'ACTIVE'
      } : null;

      const evalData = data && data.result ? data.result : {
        asset: data?.symbol || target,
        timeframe: data?.timeframe || timeframe,
        hasSetup: Boolean(directSignal),
        action: directSignal ? (directSignal.direction === 'UP' ? 'BUY' : 'SELL') : 'NO SETUP',
        signal: directSignal
      };

      if (directSignal || (data && data.result)) {
        const activeSig = directSignal || data.result?.signal || null;
        setScannedSignal(activeSig);
        setSingleAssetEvaluation(evalData);
        setIsScanModalOpen(true);
        if (activeSig) {
          setScanMessage(
            `Signal on ${target} (${timeframe}): ${activeSig.direction === 'UP' ? 'BUY' : 'SELL'}`
          );
        } else {
          setScanMessage('no valid setup found');
        }
      } else {
        setScanMessage('no valid setup found');
      }
    } catch {
      setScanMessage(`no valid setup found`);
    } finally {
      setIsScanningSpecificAsset(false);
      setTimeout(() => {
        setScanMessage(null);
      }, 6000);
    }
  };

  // STRICT ACTIVE SIGNALS LIST: Genuinely active signals only.
  // When TP or SL is hit, trade is counted as win/loss and deleted from active signals list.
  const activeSignalsList = useMemo(() => {
    const clearedSet = loadClearedSignalIds();
    const list = (activeSignals || performanceSignals).filter(
      (s) =>
        !isPermanentlyExcludedSymbol(s.asset) &&
        s.status === 'ACTIVE' &&
        !s.isTradeComplete &&
        !s.tp1Hit &&
        !s.tp2Hit &&
        !clearedSet.has(s.id) &&
        !clearedSignalIds.has(s.id)
    );

    // Deduplicate identical underlying setups
    const seen = new Set<string>();
    const deduplicated = list.filter((s) => {
      const key = `${s.asset}-${s.timeframe}-${s.confirmedCandleCloseTime || s.timestamp}-${s.direction}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    return [...deduplicated].sort((a, b) => {
      const timeA = a.confirmedCandleCloseTime || a.timestamp || 0;
      const timeB = b.confirmedCandleCloseTime || b.timestamp || 0;
      return timeB - timeA;
    });
  }, [performanceSignals, activeSignals, clearedSignalIds]);

  const latestActiveSignal: ScannerSignalItem | null = activeSignalsList.length > 0 ? activeSignalsList[0] : null;

  // STRICT COMPLETED SIGNALS LIST: Available for separate completed history inspection.
  const completedHistoryList = useMemo(() => {
    const clearedSet = loadClearedSignalIds();
    let list = (completedSignals || performanceSignals).filter(
      (s) =>
        !isPermanentlyExcludedSymbol(s.asset) &&
        (s.status !== 'ACTIVE' || s.isTradeComplete || s.tp1Hit || s.tp2Hit || clearedSet.has(s.id) || clearedSignalIds.has(s.id))
    );

    if (historyFilter === 'wins') {
      list = list.filter((s) => s.status === 'WIN');
    } else if (historyFilter === 'losses') {
      list = list.filter((s) => s.status === 'LOSS');
    }

    return [...list].sort((a, b) => (b.completedAt || b.timestamp || 0) - (a.completedAt || a.timestamp || 0));
  }, [performanceSignals, completedSignals, historyFilter, clearedSignalIds]);

  return (
    <div className="flex flex-col h-full bg-[#0a0a0c] text-white select-none overflow-hidden">
      {/* Top Scanner Status Bar */}
      <div className="p-3 border-b border-[#181920] bg-[#0c0d12] flex flex-wrap items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-6 h-6 rounded bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 font-bold text-xs">
            ⚡
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-xs tracking-wider text-white">NWWT SCANNER</span>
              <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-[#14161f] border border-[#222533] text-[10px]">
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    isScanning ? 'bg-amber-400 animate-pulse' : 'bg-emerald-400'
                  }`}
                />
                <span className="text-slate-300 font-mono capitalize">
                  {isScanning ? 'Scanning...' : 'Live Ready'}
                </span>
              </div>
            </div>
            <div className="text-[10px] text-slate-500 font-mono">
              Market structure scanner
            </div>
          </div>
        </div>

        {/* Timeframe Selector & Prominent Scanner Button (Black and Gold) */}
        <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
          <button
            onClick={handleScanMarket}
            disabled={isScanningSpecificAsset || isScanning}
            className="flex items-center gap-2 px-4 py-2 sm:px-5 sm:py-2.5 rounded-lg bg-gradient-to-r from-amber-400 via-amber-500 to-amber-400 hover:from-amber-300 hover:to-amber-400 active:scale-[0.98] text-black font-mono font-black text-xs sm:text-sm shadow-lg shadow-amber-500/25 border border-amber-300/50 ring-2 ring-amber-400/40 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap min-h-[42px]"
            title={`Scan setup for ${selectedAsset || 'BTCUSDT'}`}
          >
            <Sparkles className={`w-4 h-4 shrink-0 ${isScanningSpecificAsset ? 'animate-spin' : ''}`} />
            <span>{isScanningSpecificAsset ? 'Scanning Asset...' : 'Scan Asset'}</span>
            <span className="text-[11px] bg-black/25 text-black px-2 py-0.5 rounded font-extrabold">
              {(selectedAsset || 'BTCUSDT').replace(/USDT$/, '')}
            </span>
          </button>

          <div className="flex items-center bg-[#13151f] rounded border border-[#202230] p-0.5 min-h-[38px]">
            {SCANNER_TIMEFRAMES.map((tf) => (
              <button
                key={tf}
                onClick={() => onTimeframeChange(tf)}
                className={`px-2 py-1 text-[11px] font-mono font-bold rounded transition cursor-pointer ${
                  timeframe === tf
                    ? 'bg-amber-500 text-black shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {tf}
              </button>
            ))}
          </div>

          <button
            onClick={() => onTriggerScan(timeframe)}
            disabled={isScanning}
            className="p-2 min-h-[38px] min-w-[38px] flex items-center justify-center rounded-lg bg-[#13151f] hover:bg-[#1a1c2a] border border-[#202230] hover:border-amber-500/40 text-slate-300 hover:text-white transition disabled:opacity-40 cursor-pointer"
            title="Rescan market pairs"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isScanning ? 'animate-spin text-amber-400' : ''}`} />
          </button>
        </div>
      </div>

      {/* Scan Result Notification Banner */}
      {scanMessage && (
        <div className="px-3 py-1.5 bg-[#141724] border-b border-amber-500/30 text-amber-300 text-[11px] font-mono flex items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-1.5 overflow-hidden">
            <Sparkles className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <span className="truncate">{scanMessage}</span>
          </div>
          <button
            onClick={() => setScanMessage(null)}
            className="text-slate-400 hover:text-white shrink-0 p-0.5"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto pb-24 lg:pb-6 overscroll-contain">
        {/* View Switcher: Active Scanner vs Completed History */}
        <div className="px-3 py-2 bg-[#0c0d13] border-b border-[#181a24] flex items-center justify-between gap-1.5 text-[11px] font-mono">
          <span className="text-[11px] text-slate-400 font-bold uppercase tracking-wider flex items-center gap-1.5">
            <Layers className="w-3.5 h-3.5 text-amber-400" />
            <span>Trade Signals</span>
          </span>

          <div className="flex items-center bg-[#13151f] rounded border border-[#202230] p-0.5">
            <button
              onClick={() => setSignalViewMode('active')}
              className={`px-2.5 py-0.5 text-[10px] font-mono font-bold rounded transition cursor-pointer flex items-center gap-1 ${
                signalViewMode === 'active'
                  ? 'bg-amber-500 text-black shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              <span>Active ({activeSignalsList.length})</span>
            </button>
            <button
              onClick={() => setSignalViewMode('completed_history')}
              className={`px-2.5 py-0.5 text-[10px] font-mono font-bold rounded transition cursor-pointer flex items-center gap-1 ${
                signalViewMode === 'completed_history'
                  ? 'bg-amber-500 text-black shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Clock className="w-3 h-3" />
              <span>History ({completedHistoryList.length})</span>
            </button>
          </div>
        </div>

        {/* ========================================================================= */}
        {/* VIEW A: ACTIVE SCANNER VIEW                                               */}
        {/* ========================================================================= */}
        {signalViewMode === 'active' && (
          <>
            {/* Newest Highlighted Trade Card */}
            {latestActiveSignal && (
              <div className="p-3 border-b border-[#181a24] bg-gradient-to-b from-[#11131c] to-[#0d0e14]">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono font-bold text-amber-400 flex items-center gap-1">
                      <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                      NEWEST SIGNAL
                    </span>
                    <span className="px-1.5 py-0.2 rounded text-[10px] font-mono font-bold bg-amber-500/15 text-amber-400 border border-amber-500/30 flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                      ACTIVE
                    </span>
                  </div>
                </div>

                <div
                  onClick={() => onSelectAsset(latestActiveSignal.asset, latestActiveSignal.timeframe, latestActiveSignal)}
                  className="p-3 rounded-lg bg-[#141724] border-2 border-amber-400/80 ring-2 ring-amber-400/30 shadow-[0_0_20px_rgba(245,158,11,0.22)] hover:border-amber-400 cursor-pointer transition group"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-bold text-sm text-white group-hover:text-amber-400 transition">
                        {latestActiveSignal.asset}
                      </span>
                      <span className="px-1.5 py-0.2 rounded text-[10px] font-mono font-bold bg-[#1d2030] text-amber-400 border border-amber-500/30">
                        {latestActiveSignal.timeframe}
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded text-[11px] font-mono font-bold flex items-center gap-1 ${
                          latestActiveSignal.direction === 'UP'
                            ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                            : 'bg-rose-500/20 text-rose-400 border border-rose-500/40'
                        }`}
                      >
                        {latestActiveSignal.direction === 'UP' ? (
                          <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
                        ) : (
                          <TrendingDown className="w-3.5 h-3.5 text-rose-400" />
                        )}
                        {latestActiveSignal.direction === 'UP' ? 'BUY' : 'SELL'}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 font-mono text-xs">
                      <span className="font-bold text-white">
                        ${formatPrice(latestActiveSignal.entryPrice || latestActiveSignal.signalPrice)}
                      </span>
                      <ArrowRight className="w-3.5 h-3.5 text-slate-500 group-hover:text-amber-400 transition transform group-hover:translate-x-0.5" />
                    </div>
                  </div>

                  {/* Target Levels Display: Entry, TP #1, TP #2, SL */}
                  <div className="mt-2.5 p-2 rounded bg-[#0a0c12] border border-[#1e2130] grid grid-cols-2 sm:grid-cols-4 gap-2 text-center font-mono">
                    <div>
                      <div className="text-[10px] text-slate-500 uppercase">Entry</div>
                      <div className="text-xs font-bold text-white">
                        ${formatPrice(latestActiveSignal.entryPrice || latestActiveSignal.signalPrice)}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] text-emerald-400 uppercase font-semibold flex items-center justify-center gap-1">
                        <span>TP #1</span>
                        {latestActiveSignal.tp1Hit && <span className="text-[9px] bg-emerald-500/20 text-emerald-300 px-1 rounded">HIT</span>}
                      </div>
                      <div className="text-xs font-bold text-emerald-400">
                        ${formatPrice(latestActiveSignal.takeProfit1 || latestActiveSignal.takeProfit)}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] text-emerald-400 uppercase font-semibold flex items-center justify-center gap-1">
                        <span>TP #2</span>
                        {latestActiveSignal.tp2Hit && <span className="text-[9px] bg-emerald-500/20 text-emerald-300 px-1 rounded">HIT</span>}
                      </div>
                      <div className="text-xs font-bold text-emerald-400">
                        {latestActiveSignal.takeProfit2 ? `$${formatPrice(latestActiveSignal.takeProfit2)}` : '--'}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] text-rose-400 uppercase font-semibold">Stop Loss</div>
                      <div className="text-xs font-bold text-rose-400">
                        ${formatPrice(latestActiveSignal.stopLoss)}
                      </div>
                    </div>
                  </div>

                  {latestActiveSignal.displayMessage && (
                    <div className="mt-2 px-2.5 py-1 rounded bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-mono font-bold flex items-center gap-1.5">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>{latestActiveSignal.displayMessage}</span>
                    </div>
                  )}

                  <div className="mt-2.5 pt-2 border-t border-[#1a1d29] flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono text-slate-400">
                    <span className="flex items-center gap-1 text-slate-400">
                      <Clock className="w-3 h-3 text-slate-500" />
                      Confirmed Close: <strong className="text-slate-200">{formatCandleCloseTime(latestActiveSignal.confirmedCandleCloseTime || latestActiveSignal.timestamp)}</strong>
                    </span>
                    <span className="text-indigo-300 text-[10px]">
                      1:{(latestActiveSignal.rewardRiskRatio || (Math.abs((latestActiveSignal.takeProfit1 || latestActiveSignal.takeProfit) - latestActiveSignal.entryPrice) / (Math.abs(latestActiveSignal.entryPrice - latestActiveSignal.stopLoss) || 1))).toFixed(2)} R:R
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* Confirmed Active Signals List */}
            <div className="p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5 text-amber-400" />
                  Active Signals ({activeSignalsList.length})
                </span>
                <span className="text-[10px] text-slate-500 font-mono">
                  Live Trade Setups
                </span>
              </div>

              {activeSignalsList.length === 0 ? (
                <div className="p-6 text-center rounded border border-[#181a24] bg-[#0c0d12] text-slate-500 text-xs font-mono">
                  {isScanning
                    ? 'Scanning market pairs...'
                    : `No active signals on ${timeframe}. Waiting for valid setup.`}
                </div>
              ) : (
                <div className="space-y-2">
                  {activeSignalsList.map((s) => {
                    const isSelected = selectedAsset === s.asset;
                    const isUp = s.direction === 'UP';
                    const isNewest = latestActiveSignal && s.id === latestActiveSignal.id;

                    return (
                      <div
                        key={s.id}
                        onClick={() => onSelectAsset(s.asset, s.timeframe, s)}
                        className={`p-2.5 rounded-lg border transition cursor-pointer ${
                          isNewest
                            ? 'bg-[#151928] border-2 border-amber-400/80 ring-2 ring-amber-400/30 shadow-[0_0_18px_rgba(245,158,11,0.22)]'
                            : isSelected
                            ? 'bg-[#151824] border-amber-500/60 shadow-md'
                            : 'bg-[#0d0e14] border-[#1a1c27] hover:border-slate-700 hover:bg-[#12141c]'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-bold text-xs text-white">
                              {s.asset}
                            </span>
                            <span className="px-1.5 py-0.2 rounded text-[10px] font-mono font-bold bg-[#161822] text-amber-400 border border-amber-500/20">
                              {s.timeframe}
                            </span>
                            <span
                              className={`px-1.5 py-0.2 rounded text-[10px] font-mono font-bold flex items-center gap-0.5 ${
                                isUp
                                  ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                                  : 'bg-rose-500/15 text-rose-400 border border-rose-500/30'
                              }`}
                            >
                              {isUp ? <TrendingUp className="w-3 h-3 text-emerald-400" /> : <TrendingDown className="w-3 h-3 text-rose-400" />}
                              {isUp ? 'BUY' : 'SELL'}
                            </span>
                          </div>

                          <div className="flex items-center gap-1.5">
                            {isNewest && (
                              <span className="px-1.5 py-0.2 rounded text-[9px] font-mono font-bold bg-amber-400/25 text-amber-300 border border-amber-400/50 flex items-center gap-1 shadow-sm">
                                <Sparkles className="w-2.5 h-2.5 text-amber-400" />
                                NEWEST
                              </span>
                            )}

                            <span className="px-1.5 py-0.2 rounded text-[10px] font-mono font-bold bg-amber-500/15 text-amber-400 border border-amber-500/30 flex items-center gap-1">
                              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                              ACTIVE
                            </span>
                          </div>
                        </div>

                        {/* Four-Column Price Grid: Entry, TP #1, TP #2, SL */}
                        <div className="mt-2 p-1.5 rounded bg-[#08090d] border border-[#161822] grid grid-cols-2 sm:grid-cols-4 gap-1 text-center font-mono text-[11px]">
                          <div>
                            <span className="text-[9px] text-slate-500 block">ENTRY</span>
                            <span className="font-semibold text-white">${formatPrice(s.entryPrice || s.signalPrice)}</span>
                          </div>
                          <div>
                            <span className="text-[9px] text-emerald-400 block font-semibold flex items-center justify-center gap-0.5">
                              <span>TP #1</span>
                              {s.tp1Hit && <span className="text-[8px] bg-emerald-500/20 text-emerald-300 px-0.5 rounded">HIT</span>}
                            </span>
                            <span className="font-semibold text-emerald-400">${formatPrice(s.takeProfit1 || s.takeProfit)}</span>
                          </div>
                          <div>
                            <span className="text-[9px] text-emerald-400 block font-semibold flex items-center justify-center gap-0.5">
                              <span>TP #2</span>
                              {s.tp2Hit && <span className="text-[8px] bg-emerald-500/20 text-emerald-300 px-0.5 rounded">HIT</span>}
                            </span>
                            <span className="font-semibold text-emerald-400">
                              {s.takeProfit2 ? `$${formatPrice(s.takeProfit2)}` : '--'}
                            </span>
                          </div>
                          <div>
                            <span className="text-[9px] text-rose-400 block font-semibold">STOP LOSS</span>
                            <span className="font-semibold text-rose-400">${formatPrice(s.stopLoss)}</span>
                          </div>
                        </div>

                        {s.displayMessage && (
                          <div className="mt-1.5 px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-[11px] font-mono font-bold flex items-center gap-1">
                            <CheckCircle2 className="w-3 h-3 shrink-0" />
                            <span>{s.displayMessage}</span>
                          </div>
                        )}

                        <div className="mt-1.5 pt-1 border-t border-[#161822] flex flex-wrap items-center justify-between gap-1 text-[10px] font-mono text-slate-400">
                          <span className="flex items-center gap-1 text-slate-400">
                            <Clock className="w-2.5 h-2.5 text-slate-500" />
                            Confirmed: <strong className="text-slate-200">{formatCandleCloseTime(s.confirmedCandleCloseTime || s.timestamp)}</strong>
                          </span>
                          <span className="text-indigo-300">
                            1:{(s.rewardRiskRatio || (Math.abs((s.takeProfit1 || s.takeProfit) - s.entryPrice) / (Math.abs(s.entryPrice - s.stopLoss) || 1))).toFixed(2)} R:R
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        )}

        {/* ========================================================================= */}
        {/* VIEW B: COMPLETED HISTORY VIEW                                            */}
        {/* ========================================================================= */}
        {signalViewMode === 'completed_history' && (
          <div className="p-3 space-y-3">
            <div className="flex items-center justify-between pb-2 border-b border-[#181a24]">
              <div>
                <span className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-slate-400" />
                  Completed Signals ({completedHistoryList.length})
                </span>
                <span className="text-[10px] text-slate-500 font-mono block">
                  Settled trades removed from active list
                </span>
              </div>

              <div className="flex items-center gap-1 text-xs">
                {(['all', 'wins', 'losses'] as const).map((hf) => (
                  <button
                    key={hf}
                    onClick={() => setHistoryFilter(hf)}
                    className={`px-2 py-0.5 rounded text-[10px] font-mono uppercase transition cursor-pointer ${
                      historyFilter === hf
                        ? 'bg-[#202436] text-white font-bold border border-[#303650]'
                        : 'text-slate-500 hover:text-slate-300'
                    }`}
                  >
                    {hf}
                  </button>
                ))}

                {onClearHistory && (
                  <button
                    onClick={onClearHistory}
                    className="ml-1 p-1 rounded hover:bg-red-500/10 text-slate-500 hover:text-red-400 transition cursor-pointer"
                    title="Clear completed history"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>

            {completedHistoryList.length === 0 ? (
              <div className="p-6 text-center rounded border border-[#181a24] bg-[#0c0d12] text-slate-500 text-xs font-mono">
                No completed signals in history matching the filter. Active signals are monitored against live market prices.
              </div>
            ) : (
              <div className="space-y-2">
                {completedHistoryList.map((c) => {
                  const isWin = c.status === 'WIN';
                  const isLoss = c.status === 'LOSS';
                  const isUp = c.direction === 'UP';

                  return (
                    <div
                      key={c.id}
                      onClick={() => onSelectAsset(c.asset)}
                      className="p-2.5 rounded-lg border border-[#1a1c27] bg-[#0c0d13] hover:border-slate-700 cursor-pointer transition font-mono text-xs"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-white">{c.asset}</span>
                          <span className="px-1.5 py-0.2 rounded text-[10px] bg-[#161822] text-slate-300">
                            {c.timeframe}
                          </span>
                          <span
                            className={`px-1.5 py-0.2 rounded text-[10px] font-bold ${
                              isUp ? 'text-emerald-400 bg-emerald-500/10' : 'text-rose-400 bg-rose-500/10'
                            }`}
                          >
                            {isUp ? 'BUY' : 'SELL'}
                          </span>
                        </div>

                        <div>
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
                              isWin
                                ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                                : isLoss
                                ? 'bg-rose-500/15 text-rose-400 border-rose-500/30'
                                : 'bg-slate-800 text-slate-400 border-slate-700'
                            }`}
                          >
                            {isWin ? `✓ TP HIT ${c.pnlPercent ? `+${Math.abs(c.pnlPercent).toFixed(1)}%` : ''}` : isLoss ? `✕ SL HIT ${c.pnlPercent ? `-${Math.abs(c.pnlPercent).toFixed(1)}%` : ''}` : 'EXPIRED'}
                          </span>
                        </div>
                      </div>

                      <div className="mt-1.5 p-1.5 rounded bg-[#07080c] border border-[#141620] grid grid-cols-3 gap-1 text-center text-[10px]">
                        <div>
                          <span className="text-slate-500 block">ENTRY</span>
                          <span className="text-slate-300 font-semibold">${formatPrice(c.entryPrice)}</span>
                        </div>
                        <div>
                          <span className="text-slate-500 block">EXIT</span>
                          <span className={`font-semibold ${isWin ? 'text-emerald-400' : isLoss ? 'text-rose-400' : 'text-slate-300'}`}>
                            ${formatPrice(c.exitPrice || (isWin ? c.takeProfit : c.stopLoss))}
                          </span>
                        </div>
                        <div>
                          <span className="text-slate-500 block">TARGET TP / SL</span>
                          <span className="text-slate-400">${formatPrice(c.takeProfit)} / ${formatPrice(c.stopLoss)}</span>
                        </div>
                      </div>

                      <div className="mt-1.5 pt-1 border-t border-[#141620] flex items-center justify-between text-[10px] text-slate-500">
                        <span>Confirmed: {formatCandleCloseTime(c.confirmedCandleCloseTime || c.timestamp)}</span>
                        <span>Settled: {c.completedAt ? new Date(c.completedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Done'}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Single Asset Evaluation Modal */}
      <ScanAssetModal
        isOpen={isScanModalOpen}
        onClose={() => setIsScanModalOpen(false)}
        isLoading={isScanningSpecificAsset}
        evaluation={singleAssetEvaluation}
        signal={scannedSignal}
        asset={selectedAsset || 'BTCUSDT'}
        timeframe={timeframe}
        onRescan={handleScanMarket}
        onSeeChart={(asset, tf, sig) => {
          onSelectAsset(asset, tf, sig);
          setIsScanModalOpen(false);
        }}
      />
    </div>
  );
};

export default WatchlistScannerPanel;
