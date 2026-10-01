/**
 * NWWT Watchlist Scanner & 4-Model Research Intelligence Panel
 *
 * Implements:
 * 1. Signals Stream with AI Market Structure Validation (ALLOW, REJECT, WAIT)
 * 2. 4-Model Research Comparison Suite:
 *    - Original Strategy (Baseline)
 *    - Inverse Strategy (Counter Research)
 *    - AI Filtered Strategy (Intelligence Layer)
 *    - AI Filtered Inverse Strategy
 * 3. Walk-Forward Validation Engine (In-Sample 60% vs Out-of-Sample 40% forward test)
 * 4. Market Regime Detector Breakdowns (trending_up, trending_down, ranging, high/low vol, transition)
 * 5. Sample Size Reliability Safeguards (<10 trades flagged as preliminary)
 * 6. Responsive, compact mobile layout with zero clipped content and natural scrolling
 *
 * Educational market analysis only. Never provides automated trade execution.
 */

import React, { useState, useMemo } from 'react';
import {
  TrendingUp,
  TrendingDown,
  RefreshCw,
  Clock,
  ArrowRight,
  Shield,
  Layers,
  Sparkles,
  Target,
  BarChart3,
  Award,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Percent,
  Compass,
  Trash2,
  Search,
  X,
  Brain,
  Scale,
  GitCompare,
  Gauge,
  Activity,
  Zap,
  Info
} from 'lucide-react';
import {
  ScannerState,
  Timeframe,
  ScannerSignalItem,
  PendingRetestItem,
  SignalPerformanceStats,
  ModelTrackType,
  MarketRegime
} from '../types.ts';
import { formatPrice } from './WatchlistTable.tsx';

interface WatchlistScannerPanelProps {
  scannerState: ScannerState;
  selectedAsset: string | null;
  onSelectAsset: (symbol: string) => void;
  onTimeframeChange: (tf: Timeframe) => void;
  onTriggerScan: (tf?: Timeframe) => void;
  performanceSignals: ScannerSignalItem[];
  performanceStats: SignalPerformanceStats;
  onClearHistory?: () => void;
}

const SCANNER_TIMEFRAMES: Timeframe[] = ['15m', '1h', '4h'];

export const WatchlistScannerPanel: React.FC<WatchlistScannerPanelProps> = ({
  scannerState,
  selectedAsset,
  onSelectAsset,
  onTimeframeChange,
  onTriggerScan,
  performanceSignals,
  performanceStats,
  onClearHistory
}) => {
  const { status, timeframe, scannedCount, pendingRetests } = scannerState;
  const isScanning = status === 'scanning';

  // Sub-tab view: 'signals' | 'research' | 'performance'
  const [activeSubTab, setActiveSubTab] = useState<'signals' | 'research' | 'performance'>('signals');
  // Model filter for Signals tab: 'all' | 'ai_filtered' | 'original' | 'inverse' | 'ai_filtered_inverse'
  const [selectedModelFilter, setSelectedModelFilter] = useState<string>('ai_filtered');
  // Signals status filter: 'all' | 'active' | 'completed'
  const [signalFilter, setSignalFilter] = useState<'all' | 'active' | 'completed'>('all');
  // Performance outcome filter
  const [historyFilter, setHistoryFilter] = useState<'all' | 'wins' | 'losses'>('all');

  // Single asset on active chart scanning state
  const [isScanningSpecificAsset, setIsScanningSpecificAsset] = useState<boolean>(false);
  const [scanMessage, setScanMessage] = useState<string | null>(null);

  /**
   * Scans the specific asset currently selected on the chart using live market data.
   */
  const handleScanMarket = async () => {
    const target = selectedAsset || 'BTCUSDT';
    setIsScanningSpecificAsset(true);
    setScanMessage(`Scanning ${target} (${timeframe}) with live market candles...`);

    try {
      const res = await fetch('/api/scanner/scan-asset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol: target, timeframe })
      });
      const data = await res.json();
      if (data && data.result) {
        const r = data.result;
        if (r.signal) {
          const valStatus = r.signal.aiValidation?.status?.toUpperCase() || 'EVALUATED';
          setScanMessage(
            `Setup on ${target} (${timeframe}): ${r.signal.direction} [${valStatus}] - ${r.signal.setupType}`
          );
        } else if (r.pendingRetest) {
          setScanMessage(`Retest Detected on ${target}: Pulling back to $${formatPrice(r.pendingRetest.targetLevel)}`);
        } else {
          setScanMessage(`Scan Complete on ${target} (${timeframe}): No confirmed setup. Regime: ${r.regimeData?.regime || 'Ranging'}.`);
        }
      } else {
        setScanMessage(`Scan finished for ${target}.`);
      }
    } catch (err: any) {
      setScanMessage(`Scan error on ${target}: ${err.message || 'Check connection'}`);
    } finally {
      setIsScanningSpecificAsset(false);
      setTimeout(() => {
        setScanMessage(null);
      }, 7500);
    }
  };

  // Filter signals list based on selected model and status
  const filteredSignals = useMemo(() => {
    let list = performanceSignals;

    // Filter by research model
    if (selectedModelFilter !== 'all') {
      list = list.filter((s) => (s.modelType || 'original') === selectedModelFilter);
    }

    // Filter by status
    if (signalFilter === 'active') {
      list = list.filter((s) => s.status === 'ACTIVE');
    } else if (signalFilter === 'completed') {
      list = list.filter((s) => s.status !== 'ACTIVE');
    }

    return [...list].sort((a, b) => {
      if (a.status === 'ACTIVE' && b.status !== 'ACTIVE') return -1;
      if (b.status === 'ACTIVE' && a.status !== 'ACTIVE') return 1;
      return (b.confidence || 0) - (a.confidence || 0);
    });
  }, [performanceSignals, selectedModelFilter, signalFilter]);

  const latestSignal: ScannerSignalItem | null = filteredSignals.length > 0 ? filteredSignals[0] : null;

  // Filter completed signals in the performance tab
  const filteredCompleted = useMemo(() => {
    let list = performanceSignals.filter((s) => s.status !== 'ACTIVE');
    if (selectedModelFilter !== 'all') {
      list = list.filter((s) => (s.modelType || 'original') === selectedModelFilter);
    }
    if (historyFilter === 'wins') {
      list = list.filter((s) => s.status === 'WIN');
    } else if (historyFilter === 'losses') {
      list = list.filter((s) => s.status === 'LOSS');
    }
    return list.sort((a, b) => (b.completedAt || b.timestamp) - (a.completedAt || a.timestamp));
  }, [performanceSignals, selectedModelFilter, historyFilter]);

  // Models stats extraction from server or local
  const models = performanceStats.byModel || {
    original: performanceStats,
    inverse: performanceStats,
    ai_filtered: performanceStats,
    ai_filtered_inverse: performanceStats
  };

  const walkForward = performanceStats.walkForward;

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
              {scannedCount} pairs analyzed • Real-time structure scanning
            </div>
          </div>
        </div>

        {/* Timeframe Selector & Scan Market Button */}
        <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
          <button
            onClick={handleScanMarket}
            disabled={isScanningSpecificAsset || isScanning}
            className="flex items-center gap-1 px-2.5 py-1 rounded bg-amber-500 hover:bg-amber-400 active:scale-95 text-black font-mono font-bold text-[11px] shadow-sm transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
            title={`Scan technical structure & setups for currently selected chart asset (${selectedAsset || 'BTCUSDT'})`}
          >
            <Sparkles className={`w-3 h-3 ${isScanningSpecificAsset ? 'animate-spin' : ''}`} />
            <span>{isScanningSpecificAsset ? 'Scanning Asset...' : 'Scan Market'}</span>
          </button>

          <div className="flex items-center bg-[#13151f] rounded border border-[#202230] p-0.5">
            {SCANNER_TIMEFRAMES.map((tf) => (
              <button
                key={tf}
                onClick={() => onTimeframeChange(tf)}
                className={`px-2 py-0.5 text-[11px] font-mono font-bold rounded transition cursor-pointer ${
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
            className="p-1 rounded bg-[#13151f] hover:bg-[#1a1c2a] border border-[#202230] text-slate-300 hover:text-white transition disabled:opacity-40 cursor-pointer"
            title="Rescan market pairs"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isScanning ? 'animate-spin text-amber-400' : ''}`} />
          </button>
        </div>
      </div>

      {/* Scan Market Result Notification Banner */}
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

      {/* Top 3 Sub-Tabs Navigation */}
      <div className="flex items-center border-b border-[#181a24] bg-[#090a0f] p-1 shrink-0">
        <button
          onClick={() => setActiveSubTab('signals')}
          className={`flex-1 py-1.5 px-2 rounded text-xs font-mono font-bold flex items-center justify-center gap-1.5 transition cursor-pointer ${
            activeSubTab === 'signals'
              ? 'bg-[#181a24] text-white border border-[#2a2d3d] shadow-sm'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          <Layers className="w-3.5 h-3.5 text-amber-400" />
          <span>Signals</span>
          {performanceStats.activeCount > 0 && (
            <span className="text-[10px] px-1.5 py-0.2 rounded-full font-bold bg-amber-500/20 text-amber-400 border border-amber-500/30">
              {performanceStats.activeCount}
            </span>
          )}
        </button>

        <button
          onClick={() => setActiveSubTab('research')}
          className={`flex-1 py-1.5 px-2 rounded text-xs font-mono font-bold flex items-center justify-center gap-1.5 transition cursor-pointer ${
            activeSubTab === 'research'
              ? 'bg-[#181a24] text-white border border-[#2a2d3d] shadow-sm'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          <GitCompare className="w-3.5 h-3.5 text-sky-400" />
          <span>4-Model Research</span>
          <span className="text-[9px] px-1 rounded bg-sky-500/20 text-sky-300 border border-sky-500/30">
            Compare
          </span>
        </button>

        <button
          onClick={() => setActiveSubTab('performance')}
          className={`flex-1 py-1.5 px-2 rounded text-xs font-mono font-bold flex items-center justify-center gap-1.5 transition cursor-pointer ${
            activeSubTab === 'performance'
              ? 'bg-[#181a24] text-white border border-[#2a2d3d] shadow-sm'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          <BarChart3 className="w-3.5 h-3.5 text-emerald-400" />
          <span>Performance</span>
          <span className="text-[10px] px-1.5 py-0.2 rounded font-mono font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
            {performanceStats.tpRate}% TP
          </span>
        </button>
      </div>

      {/* Main Content Area - naturally scrollable without oversized empty box */}
      <div className="flex-1 overflow-y-auto pb-24 lg:pb-6 overscroll-contain">
        {/* ========================================================================= */}
        {/* 1. SIGNALS TAB                                                            */}
        {/* ========================================================================= */}
        {activeSubTab === 'signals' && (
          <>
            {/* Research Model Selector Strip */}
            <div className="px-3 py-2 bg-[#0c0d13] border-b border-[#181a24] flex flex-wrap items-center justify-between gap-1.5 text-[11px] font-mono">
              <div className="flex items-center gap-1 overflow-x-auto py-0.5 no-scrollbar">
                <span className="text-[10px] text-slate-500 uppercase mr-1">Model:</span>
                {[
                  { id: 'ai_filtered', label: 'AI Filtered', icon: Brain, badge: 'Intelligence' },
                  { id: 'original', label: 'Original', icon: Layers, badge: 'Baseline' },
                  { id: 'inverse', label: 'Inverse', icon: Scale, badge: 'Research' },
                  { id: 'ai_filtered_inverse', label: 'AI Inv', icon: GitCompare, badge: 'Filtered' },
                  { id: 'all', label: 'All Models', icon: Activity, badge: '' }
                ].map((m) => {
                  const Icon = m.icon;
                  const isSel = selectedModelFilter === m.id;
                  return (
                    <button
                      key={m.id}
                      onClick={() => setSelectedModelFilter(m.id)}
                      className={`px-2 py-1 rounded flex items-center gap-1 whitespace-nowrap transition cursor-pointer ${
                        isSel
                          ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 font-bold'
                          : 'bg-[#12141e] text-slate-400 hover:text-white border border-[#1e202e]'
                      }`}
                    >
                      <Icon className="w-3 h-3 shrink-0" />
                      <span>{m.label}</span>
                    </button>
                  );
                })}
              </div>

              {/* Status Filter Pills */}
              <div className="flex items-center gap-1">
                {(['all', 'active', 'completed'] as const).map((f) => (
                  <button
                    key={f}
                    onClick={() => setSignalFilter(f)}
                    className={`px-1.5 py-0.5 rounded text-[10px] uppercase transition cursor-pointer ${
                      signalFilter === f
                        ? 'bg-[#1f2233] text-white font-bold border border-[#2e3248]'
                        : 'text-slate-500 hover:text-slate-300'
                    }`}
                  >
                    {f}
                  </button>
                ))}
              </div>
            </div>

            {/* Prominent Latest Confirmed Signal Alert */}
            {latestSignal && signalFilter !== 'completed' && (
              <div className="p-3 bg-[#0d0f17] border-b border-[#1f2230]">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] font-mono tracking-wider uppercase text-amber-400 font-bold flex items-center gap-1">
                    <Sparkles className="w-3 h-3 text-amber-400" />
                    Latest Signal • {(latestSignal.modelType || 'original').replace(/_/g, ' ').toUpperCase()}
                  </span>
                  <div className="flex items-center gap-1.5">
                    {latestSignal.aiValidation && (
                      <span
                        className={`px-1.5 py-0.2 rounded text-[10px] font-mono font-bold border ${
                          latestSignal.aiValidation.status === 'allow'
                            ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40'
                            : latestSignal.aiValidation.status === 'reject'
                            ? 'bg-rose-500/20 text-rose-400 border-rose-500/40'
                            : 'bg-amber-500/20 text-amber-400 border-amber-500/40'
                        }`}
                      >
                        AI: {latestSignal.aiValidation.status.toUpperCase()}
                      </span>
                    )}

                    {latestSignal.status === 'ACTIVE' ? (
                      <span className="px-1.5 py-0.2 rounded text-[10px] font-mono font-bold bg-amber-500/15 text-amber-400 border border-amber-500/30 flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                        ACTIVE
                      </span>
                    ) : latestSignal.status === 'WIN' ? (
                      <span className="px-1.5 py-0.2 rounded text-[10px] font-mono font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                        TP REACHED
                      </span>
                    ) : latestSignal.status === 'LOSS' ? (
                      <span className="px-1.5 py-0.2 rounded text-[10px] font-mono font-bold bg-red-500/15 text-red-400 border border-red-500/30">
                        SL TOUCHED
                      </span>
                    ) : (
                      <span className="px-1.5 py-0.2 rounded text-[10px] font-mono text-slate-400 bg-slate-800">
                        EXPIRED
                      </span>
                    )}
                  </div>
                </div>

                <div
                  onClick={() => onSelectAsset(latestSignal.asset)}
                  className="p-3 rounded-lg bg-[#12141e] border border-[#25283a] hover:border-amber-500/50 cursor-pointer transition group"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-bold text-sm text-white group-hover:text-amber-400 transition">
                        {latestSignal.asset}
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded text-[11px] font-mono font-bold flex items-center gap-1 ${
                          latestSignal.direction === 'UP'
                            ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                            : 'bg-red-500/15 text-red-400 border border-red-500/30'
                        }`}
                      >
                        {latestSignal.direction === 'UP' ? (
                          <TrendingUp className="w-3.5 h-3.5" />
                        ) : (
                          <TrendingDown className="w-3.5 h-3.5" />
                        )}
                        {latestSignal.direction}
                      </span>
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-[#1b1e2c] text-slate-300 border border-[#2a2e42]">
                        {latestSignal.setupType}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 font-mono text-xs">
                      <span className="font-bold text-white">
                        {formatPrice(latestSignal.entryPrice || latestSignal.signalPrice)}
                      </span>
                      <ArrowRight className="w-3.5 h-3.5 text-slate-500 group-hover:text-amber-400 transition transform group-hover:translate-x-0.5" />
                    </div>
                  </div>

                  {/* Target Levels Display: Entry, TP, SL */}
                  <div className="mt-2.5 p-2 rounded bg-[#0a0c12] border border-[#1e2130] grid grid-cols-3 gap-2 text-center font-mono">
                    <div>
                      <div className="text-[10px] text-slate-500 uppercase">Entry Price</div>
                      <div className="text-xs font-bold text-white">
                        {formatPrice(latestSignal.entryPrice || latestSignal.signalPrice)}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] text-emerald-400 uppercase font-semibold">Take Profit</div>
                      <div className="text-xs font-bold text-emerald-400">
                        {formatPrice(latestSignal.takeProfit)}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] text-red-400 uppercase font-semibold">Stop Loss</div>
                      <div className="text-xs font-bold text-red-400">
                        {formatPrice(latestSignal.stopLoss)}
                      </div>
                    </div>
                  </div>

                  <p className="text-xs text-slate-300 mt-2 leading-relaxed">
                    {latestSignal.reason}
                  </p>

                  <div className="mt-2.5 pt-2 border-t border-[#1a1d29] flex items-center justify-between text-[11px] font-mono text-slate-400">
                    <div className="flex items-center gap-2">
                      {latestSignal.marketRegime && (
                        <span className="px-1.5 py-0.5 rounded text-[10px] bg-[#1a1d28] text-slate-300 border border-[#282c3d]">
                          {latestSignal.marketRegime.replace(/_/g, ' ')}
                        </span>
                      )}
                      <span>SL: <strong className="text-red-400">{formatPrice(latestSignal.stopLoss)}</strong></span>
                    </div>
                    <span className="text-[10px] text-amber-400/90 font-bold">
                      {latestSignal.confidence}% Confidence
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* Confirmed Signals List */}
            <div className="p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5 text-amber-400" />
                  Signals ({filteredSignals.length})
                </span>
                <span className="text-[10px] text-slate-500 font-mono">
                  {selectedModelFilter !== 'all' ? selectedModelFilter.replace(/_/g, ' ') : 'All models'}
                </span>
              </div>

              {filteredSignals.length === 0 ? (
                <div className="p-6 text-center rounded border border-[#181a24] bg-[#0c0d12] text-slate-500 text-xs font-mono">
                  {isScanning
                    ? 'Scanning market candles across pairs...'
                    : `No signals found under '${selectedModelFilter}' on ${timeframe}. Waiting for structural breakout or retest.`}
                </div>
              ) : (
                <div className="space-y-2">
                  {filteredSignals.map((s) => {
                    const isSelected = selectedAsset === s.asset;
                    const isUp = s.direction === 'UP';

                    return (
                      <div
                        key={s.id}
                        onClick={() => onSelectAsset(s.asset)}
                        className={`p-2.5 rounded-lg border transition cursor-pointer ${
                          isSelected
                            ? 'bg-[#151824] border-amber-500/60 shadow-md'
                            : 'bg-[#0d0e14] border-[#1a1c27] hover:border-slate-700 hover:bg-[#12141c]'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-bold text-xs text-white">
                              {s.asset}
                            </span>
                            <span
                              className={`px-1.5 py-0.2 rounded text-[10px] font-mono font-bold flex items-center gap-0.5 ${
                                isUp ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'
                              }`}
                            >
                              {isUp ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                              {s.direction}
                            </span>
                            <span className="text-[10px] font-mono text-slate-400 truncate max-w-[110px]">
                              {s.setupType}
                            </span>
                          </div>

                          <div className="flex items-center gap-1.5">
                            {s.aiValidation && (
                              <span
                                className={`px-1.5 py-0.2 rounded text-[9px] font-mono font-bold border ${
                                  s.aiValidation.status === 'allow'
                                    ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                                    : s.aiValidation.status === 'reject'
                                    ? 'bg-rose-500/15 text-rose-400 border-rose-500/30'
                                    : 'bg-amber-500/15 text-amber-400 border-amber-500/30'
                                }`}
                              >
                                {s.aiValidation.status.toUpperCase()}
                              </span>
                            )}

                            {s.status === 'ACTIVE' ? (
                              <span className="px-1.5 py-0.2 rounded text-[10px] font-mono font-bold bg-amber-500/15 text-amber-400 border border-amber-500/30 flex items-center gap-1">
                                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                                ACTIVE
                              </span>
                            ) : s.status === 'WIN' ? (
                              <span className="px-1.5 py-0.2 rounded text-[10px] font-mono font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                                WIN {s.pnlPercent ? `+${s.pnlPercent.toFixed(1)}%` : ''}
                              </span>
                            ) : s.status === 'LOSS' ? (
                              <span className="px-1.5 py-0.2 rounded text-[10px] font-mono font-bold bg-red-500/15 text-red-400 border border-red-500/30">
                                LOSS {s.pnlPercent ? `${s.pnlPercent.toFixed(1)}%` : ''}
                              </span>
                            ) : (
                              <span className="px-1.5 py-0.2 rounded text-[10px] font-mono text-slate-400 bg-slate-800">
                                EXPIRED
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Three-Column Price Grid: Entry, TP, SL */}
                        <div className="mt-2 p-1.5 rounded bg-[#08090d] border border-[#161822] grid grid-cols-3 gap-1 text-center font-mono text-[11px]">
                          <div>
                            <span className="text-[9px] text-slate-500 block">ENTRY</span>
                            <span className="font-semibold text-white">{formatPrice(s.entryPrice || s.signalPrice)}</span>
                          </div>
                          <div>
                            <span className="text-[9px] text-emerald-400 block font-semibold">TP</span>
                            <span className="font-semibold text-emerald-400">{formatPrice(s.takeProfit)}</span>
                          </div>
                          <div>
                            <span className="text-[9px] text-red-400 block font-semibold">SL</span>
                            <span className="font-semibold text-red-400">{formatPrice(s.stopLoss)}</span>
                          </div>
                        </div>

                        <p className="text-[11px] text-slate-300 mt-1.5 line-clamp-2 leading-relaxed">
                          {s.reason}
                        </p>

                        <div className="mt-1.5 pt-1 border-t border-[#161822] flex items-center justify-between text-[10px] font-mono text-slate-500">
                          <span className="flex items-center gap-1.5">
                            <span>{s.timeframe} TF</span>
                            {s.marketRegime && (
                              <span className="text-slate-400 capitalize">• {s.marketRegime.replace(/_/g, ' ')}</span>
                            )}
                          </span>
                          <span className="text-amber-400/90 font-bold">{s.confidence}% Conf.</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Pending Retest Setups Section */}
            <div className="p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                  <Target className="w-3.5 h-3.5 text-amber-400" />
                  Pending Retests ({pendingRetests.length})
                </span>
                <span className="text-[10px] text-slate-500 font-mono">
                  Pulling back to structure
                </span>
              </div>

              {pendingRetests.length === 0 ? (
                <div className="p-3 text-center rounded border border-[#181a24] bg-[#0c0d12] text-slate-500 text-xs font-mono">
                  No pending retest zones detected currently.
                </div>
              ) : (
                <div className="space-y-1.5">
                  {pendingRetests.map((p, idx) => {
                    const isSelected = selectedAsset === p.asset;
                    const isUp = p.direction === 'UP';

                    return (
                      <div
                        key={`${p.asset}-${idx}`}
                        onClick={() => onSelectAsset(p.asset)}
                        className={`p-2 rounded border transition cursor-pointer ${
                          isSelected
                            ? 'bg-[#151824] border-amber-500/60'
                            : 'bg-[#0d0e14] border-[#1a1c27] hover:border-slate-700 hover:bg-[#12141c]'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-bold text-xs text-white">{p.asset}</span>
                            <span
                              className={`text-[10px] font-mono font-semibold px-1 rounded ${
                                isUp ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'
                              }`}
                            >
                              Retest {p.direction}
                            </span>
                          </div>
                          <div className="text-[11px] font-mono text-slate-400">
                            Target: <strong className="text-white">{formatPrice(p.targetLevel)}</strong>
                          </div>
                        </div>
                        <p className="text-[11px] text-slate-400 mt-0.5 leading-snug">
                          {p.note}
                        </p>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        )}

        {/* ========================================================================= */}
        {/* 2. 4-MODEL RESEARCH COMPARISON DASHBOARD                                  */}
        {/* ========================================================================= */}
        {activeSubTab === 'research' && (
          <div className="p-3 space-y-4 font-mono">
            {/* Research Header Info */}
            <div className="p-3 rounded-lg bg-[#0e111a] border border-[#202538]">
              <div className="flex items-center gap-2 text-sky-400 font-bold text-xs mb-1">
                <GitCompare className="w-4 h-4" />
                <span>4-MODEL PARALLEL RESEARCH SUITE</span>
              </div>
              <p className="text-[11px] text-slate-400 leading-relaxed font-sans">
                Real-time parallel benchmarking across four independent strategy models on live market data.
                Designed for objective statistical observation and out-of-sample measurement without automated trade execution.
              </p>
            </div>

            {/* 4 Models Comparison Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {[
                {
                  key: 'ai_filtered',
                  title: 'AI Filtered Strategy',
                  badge: 'Intelligence Layer',
                  badgeColor: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
                  desc: 'Filters weak, overextended, or regime-mismatched setups before final signal generation.',
                  stats: models.ai_filtered
                },
                {
                  key: 'original',
                  title: 'Original Strategy',
                  badge: 'Baseline NWWT',
                  badgeColor: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
                  desc: 'Unfiltered structural setups based on pure technical rules.',
                  stats: models.original
                },
                {
                  key: 'inverse',
                  title: 'Inverse Strategy',
                  badge: 'Counter Research',
                  badgeColor: 'bg-indigo-500/20 text-indigo-400 border-indigo-500/30',
                  desc: 'Inverted direction and mirrored TP/SL geometry to test counter-trend hypothesis.',
                  stats: models.inverse
                },
                {
                  key: 'ai_filtered_inverse',
                  title: 'AI Filtered Inverse',
                  badge: 'Filtered Counter',
                  badgeColor: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
                  desc: 'Inverse setups that also pass structural confluence requirements.',
                  stats: models.ai_filtered_inverse
                }
              ].map((m) => {
                const s = m.stats || {
                  tpRate: 0,
                  winsCount: 0,
                  lossesCount: 0,
                  activeCount: 0,
                  profitFactor: 0,
                  expectancy: 0,
                  drawdown: 0,
                  maxLosingStreak: 0,
                  sampleSize: 0,
                  hasSufficientSample: false
                };

                const sampleCount = s.sampleSize || (s.winsCount + s.lossesCount) || 0;
                const hasSufficient = sampleCount >= 10;

                return (
                  <div
                    key={m.key}
                    className="p-3 rounded-lg bg-[#0e1018] border border-[#1d2030] hover:border-slate-700 transition flex flex-col justify-between"
                  >
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-xs font-bold text-white">{m.title}</span>
                        <span className={`text-[9px] px-1.5 py-0.5 rounded border ${m.badgeColor}`}>
                          {m.badge}
                        </span>
                      </div>
                      <p className="text-[10px] text-slate-400 leading-tight font-sans mb-3">
                        {m.desc}
                      </p>

                      {/* Main Metric: Win Rate & Profit Factor */}
                      <div className="grid grid-cols-2 gap-2 mb-2 p-2 rounded bg-[#07080d] border border-[#171926]">
                        <div>
                          <span className="text-[9px] text-slate-500 block">WIN RATE (TP)</span>
                          <span className="text-base font-bold text-white">
                            {s.tpRate}%
                          </span>
                          <span className="text-[10px] text-slate-500 block">
                            {s.winsCount}W / {s.lossesCount}L
                          </span>
                        </div>
                        <div>
                          <span className="text-[9px] text-slate-500 block">PROFIT FACTOR</span>
                          <span
                            className={`text-base font-bold ${
                              s.profitFactor >= 1.5
                                ? 'text-emerald-400'
                                : s.profitFactor >= 1.0
                                ? 'text-amber-400'
                                : 'text-slate-400'
                            }`}
                          >
                            {s.profitFactor}x
                          </span>
                          <span className="text-[10px] text-slate-500 block">
                            Exp: {s.expectancy !== undefined ? `${s.expectancy > 0 ? '+' : ''}${s.expectancy}%` : '--'}
                          </span>
                        </div>
                      </div>

                      {/* Secondary Statistics Grid */}
                      <div className="grid grid-cols-3 gap-1 text-center text-[10px] py-1 border-t border-[#171926]">
                        <div>
                          <span className="text-slate-500 block">Active</span>
                          <span className="text-amber-400 font-bold">{s.activeCount}</span>
                        </div>
                        <div>
                          <span className="text-slate-500 block">Max DD</span>
                          <span className="text-red-400 font-bold">
                            {s.drawdown ? `${s.drawdown}%` : '0%'}
                          </span>
                        </div>
                        <div>
                          <span className="text-slate-500 block">Max Streak</span>
                          <span className="text-slate-300 font-bold">{s.maxLosingStreak || 0}L</span>
                        </div>
                      </div>
                    </div>

                    {/* Sample Size Reliability Safeguard Badge */}
                    <div className="mt-2.5 pt-2 border-t border-[#171926] flex items-center justify-between text-[10px]">
                      <span className="text-slate-500">Sample: {sampleCount} trades</span>
                      {hasSufficient ? (
                        <span className="text-emerald-400 flex items-center gap-1 font-semibold">
                          <CheckCircle2 className="w-3 h-3" />
                          Valid Sample
                        </span>
                      ) : (
                        <span className="text-amber-400 flex items-center gap-1 font-semibold" title="Requires at least 10 completed trades before relying on statistical conclusions">
                          <AlertTriangle className="w-3 h-3" />
                          Preliminary (&lt;10)
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Walk-Forward Validation Section */}
            <div className="p-3.5 rounded-lg bg-[#0e111a] border border-[#22283d]">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold text-white flex items-center gap-1.5">
                  <Activity className="w-4 h-4 text-emerald-400" />
                  WALK-FORWARD VALIDATION (OUT-OF-SAMPLE TEST)
                </span>
                <span className="text-[10px] px-2 py-0.5 rounded bg-[#161a29] text-slate-300 border border-[#262c42]">
                  Strict Chronological Split
                </span>
              </div>

              <p className="text-[11px] text-slate-400 leading-relaxed font-sans mb-3">
                Splits completed signals chronologically into <strong>In-Sample Training (60%)</strong> and{' '}
                <strong>Out-of-Sample Forward Validation (40%)</strong>. Strictly prevents future candle data from influencing past decisions.
              </p>

              {walkForward && walkForward.isValid && walkForward.inSample && walkForward.outOfSample ? (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-2 text-center">
                    <div className="p-2.5 rounded bg-[#080a10] border border-[#191e2e]">
                      <span className="text-[10px] text-slate-500 block uppercase">In-Sample (Training 60%)</span>
                      <div className="text-base font-bold text-white my-0.5">
                        {walkForward.inSample.winRate}% TP Rate
                      </div>
                      <span className="text-[10px] text-slate-400 block">
                        PF: {walkForward.inSample.profitFactor}x • {walkForward.inSample.wins}W / {walkForward.inSample.losses}L (N={walkForward.inSample.count})
                      </span>
                    </div>

                    <div className="p-2.5 rounded bg-[#080a10] border border-[#191e2e]">
                      <span className="text-[10px] text-emerald-400 block uppercase">Out-of-Sample (Forward 40%)</span>
                      <div className="text-base font-bold text-emerald-400 my-0.5">
                        {walkForward.outOfSample.winRate}% TP Rate
                      </div>
                      <span className="text-[10px] text-slate-400 block">
                        PF: {walkForward.outOfSample.profitFactor}x • {walkForward.outOfSample.wins}W / {walkForward.outOfSample.losses}L (N={walkForward.outOfSample.count})
                      </span>
                    </div>
                  </div>

                  <div className="p-2 rounded bg-[#08090f] border border-[#171a26] flex items-center justify-between text-[11px]">
                    <span className="text-slate-400">Forward Validation Efficiency:</span>
                    <strong className="text-emerald-400">{walkForward.winRateEfficiency}%</strong>
                  </div>

                  <p className="text-[10px] text-slate-400 italic">
                    {walkForward.message}
                  </p>
                </div>
              ) : (
                <div className="p-4 text-center rounded bg-[#080a10] border border-[#191e2e] text-slate-500 text-xs">
                  <Clock className="w-4 h-4 mx-auto mb-1 text-slate-600" />
                  <span>Awaiting additional completed trades (need &gt;= 8 settled signals). Currently {walkForward?.sampleSize || 0} completed.</span>
                </div>
              )}
            </div>

            {/* Quick Action: Switch to AI Filtered View */}
            <div className="p-2.5 rounded bg-[#121522] border border-[#232840] flex items-center justify-between text-xs">
              <span className="text-slate-300 font-sans">View filtered active signals on chart:</span>
              <button
                onClick={() => {
                  setSelectedModelFilter('ai_filtered');
                  setActiveSubTab('signals');
                }}
                className="px-2.5 py-1 rounded bg-amber-500 hover:bg-amber-400 text-black font-bold text-[11px] transition cursor-pointer"
              >
                Inspect AI Filtered
              </button>
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* 3. PERFORMANCE ANALYSIS TAB                                               */}
        {/* ========================================================================= */}
        {activeSubTab === 'performance' && (
          <div className="p-3 space-y-4">
            {/* Top TP Rate Hero Card */}
            <div className="p-3.5 rounded-lg bg-gradient-to-br from-[#121624] to-[#0c0d14] border border-[#23273c] shadow-lg">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-mono uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                  <Award className="w-4 h-4 text-amber-400" />
                  Overall Take Profit (TP) Rate
                </span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/25">
                  Live Verified
                </span>
              </div>

              <div className="flex items-baseline gap-3 my-1 font-mono">
                <span className="text-3xl font-bold text-white tracking-tight">
                  {performanceStats.tpRate}%
                </span>
                <span className="text-xs text-slate-400">
                  ({performanceStats.winsCount} Wins / {performanceStats.lossesCount} Losses)
                </span>
              </div>

              {/* Progress Bar of Wins vs Losses */}
              <div className="w-full bg-[#1c1f2e] h-2 rounded-full overflow-hidden my-2 flex">
                <div
                  className="bg-emerald-500 h-full transition-all duration-500"
                  style={{ width: `${Math.min(100, Math.max(0, performanceStats.tpRate))}%` }}
                />
                <div
                  className="bg-red-500 h-full transition-all duration-500"
                  style={{ width: `${100 - Math.min(100, Math.max(0, performanceStats.tpRate))}%` }}
                />
              </div>

              {/* Statistical Metrics: Profit Factor, Expectancy, Drawdown */}
              <div className="grid grid-cols-4 gap-1 mt-3 pt-2.5 border-t border-[#1a1d2b] text-center font-mono">
                <div>
                  <span className="text-[10px] text-slate-500 block">PROFIT FACTOR</span>
                  <span className="text-xs font-bold text-emerald-400">
                    {performanceStats.profitFactor}x
                  </span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-500 block">EXPECTANCY</span>
                  <span className="text-xs font-bold text-white">
                    {performanceStats.expectancy !== undefined ? `${performanceStats.expectancy > 0 ? '+' : ''}${performanceStats.expectancy}%` : '--'}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-500 block">MAX DRAWDOWN</span>
                  <span className="text-xs font-bold text-red-400">
                    {performanceStats.drawdown ? `${performanceStats.drawdown}%` : '0%'}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-500 block">TOTAL SETTLED</span>
                  <span className="text-xs font-bold text-slate-300">
                    {performanceStats.completedCount}
                  </span>
                </div>
              </div>
            </div>

            {/* Breakdown by Market Regime */}
            {performanceStats.byRegime && Object.keys(performanceStats.byRegime).length > 0 && (
              <div className="p-3 rounded-lg bg-[#0d0e14] border border-[#1a1c27]">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-mono font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                    <Compass className="w-3.5 h-3.5 text-amber-400" />
                    Performance by Market Regime
                  </span>
                </div>

                <div className="space-y-1.5 font-mono">
                  {Object.entries(performanceStats.byRegime).map(([regime, data]) => {
                    const settled = data.wins + data.losses;
                    return (
                      <div
                        key={regime}
                        className="p-2 rounded bg-[#090a0f] border border-[#161822] flex items-center justify-between text-xs"
                      >
                        <span className="font-semibold text-slate-200 capitalize">
                          {regime.replace(/_/g, ' ')}
                        </span>
                        <div className="flex items-center gap-3 text-[11px]">
                          <span className="text-slate-400">{settled} settled</span>
                          <span className="text-emerald-400 font-bold">{data.tpRate}% TP</span>
                          <span className="text-slate-500 text-[10px]">
                            ({data.wins}W / {data.losses}L)
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Breakdown by Setup Type */}
            <div className="p-3 rounded-lg bg-[#0d0e14] border border-[#1a1c27]">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-mono font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                  <Target className="w-3.5 h-3.5 text-amber-400" />
                  Performance by Setup Type
                </span>
              </div>

              <div className="space-y-1.5 font-mono">
                {Object.entries(performanceStats.bySetupType).map(([setup, data]) => {
                  const settled = data.wins + data.losses;
                  return (
                    <div
                      key={setup}
                      className="p-2 rounded bg-[#090a0f] border border-[#161822] flex items-center justify-between text-xs"
                    >
                      <span className="font-semibold text-slate-200 truncate max-w-[170px]">
                        {setup}
                      </span>
                      <div className="flex items-center gap-3 text-[11px]">
                        <span className="text-slate-400">{settled} settled</span>
                        <span className="text-emerald-400 font-bold">{data.tpRate}% TP</span>
                        <span className="text-slate-500 text-[10px]">
                          ({data.wins}W / {data.losses}L)
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Direction Breakdown (UP vs DOWN) */}
            <div className="grid grid-cols-2 gap-2 font-mono">
              <div className="p-2.5 rounded-lg bg-[#0d0e14] border border-[#1a1c27]">
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="text-emerald-400 font-bold flex items-center gap-1">
                    <TrendingUp className="w-3.5 h-3.5" /> UP
                  </span>
                  <span className="text-white font-bold">{performanceStats.byDirection.UP.tpRate}%</span>
                </div>
                <div className="text-[10px] text-slate-400">
                  {performanceStats.byDirection.UP.wins} Wins / {performanceStats.byDirection.UP.losses} Losses
                </div>
              </div>

              <div className="p-2.5 rounded-lg bg-[#0d0e14] border border-[#1a1c27]">
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="text-red-400 font-bold flex items-center gap-1">
                    <TrendingDown className="w-3.5 h-3.5" /> DOWN
                  </span>
                  <span className="text-white font-bold">{performanceStats.byDirection.DOWN.tpRate}%</span>
                </div>
                <div className="text-[10px] text-slate-400">
                  {performanceStats.byDirection.DOWN.wins} Wins / {performanceStats.byDirection.DOWN.losses} Losses
                </div>
              </div>
            </div>

            {/* Historical Settled Trades List */}
            <div className="p-3 rounded-lg bg-[#0d0e14] border border-[#1a1c27]">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-mono font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-slate-400" />
                  Settled Historical Log ({filteredCompleted.length})
                </span>

                {onClearHistory && (
                  <button
                    onClick={onClearHistory}
                    className="text-[10px] font-mono text-slate-500 hover:text-red-400 flex items-center gap-1 transition cursor-pointer"
                    title="Clear stored historical records"
                  >
                    <Trash2 className="w-3 h-3" />
                    <span>Clear</span>
                  </button>
                )}
              </div>

              {filteredCompleted.length === 0 ? (
                <div className="p-4 text-center text-slate-500 font-mono text-xs">
                  No completed trades yet. Watching live market data for target touches.
                </div>
              ) : (
                <div className="space-y-1.5 font-mono max-h-[300px] overflow-y-auto pr-1">
                  {filteredCompleted.map((c) => (
                    <div
                      key={c.id}
                      className="p-2 rounded bg-[#090a0f] border border-[#161822] flex items-center justify-between text-xs"
                    >
                      <div>
                        <div className="flex items-center gap-1.5">
                          <span className="font-bold text-white">{c.asset}</span>
                          <span
                            className={`text-[10px] font-bold ${
                              c.direction === 'UP' ? 'text-emerald-400' : 'text-red-400'
                            }`}
                          >
                            {c.direction}
                          </span>
                          <span className="text-[10px] text-slate-500 truncate max-w-[120px]">
                            {c.setupType}
                          </span>
                        </div>
                        <div className="text-[10px] text-slate-500">
                          {c.completedAt
                            ? new Date(c.completedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                            : 'Settled'}
                        </div>
                      </div>

                      <div className="text-right">
                        <span
                          className={`font-bold block ${
                            c.status === 'WIN'
                              ? 'text-emerald-400'
                              : c.status === 'LOSS'
                              ? 'text-red-400'
                              : 'text-slate-400'
                          }`}
                        >
                          {c.status} {c.pnlPercent ? `${c.pnlPercent > 0 ? '+' : ''}${c.pnlPercent.toFixed(1)}%` : ''}
                        </span>
                        <span className="text-[10px] text-slate-500">
                          Exit: ${formatPrice(c.exitPrice || c.takeProfit)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
