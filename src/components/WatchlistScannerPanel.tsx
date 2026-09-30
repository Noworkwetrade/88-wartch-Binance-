/**
 * NWWT Watchlist Scanner & V8 Performance Engine Panel
 *
 * Scans the Binance Spot USDT watchlist using real closed candles.
 * Displays:
 * - Real-time technical signals ranked highest to lowest probability
 * - Mandatory Entry Price, Take Profit (TP), and Stop Loss (SL) on every signal
 * - Live market monitoring of active setups
 * - Automatic settlement into WIN (TP reached), LOSS (SL reached), or EXPIRED
 * - Conservative resolution if both TP and SL are hit in the same period
 * - Complete performance tracking: TP Rate %, Win/Loss counts, breakdowns by
 *   setup type, timeframe, direction, and asset
 * - Clicking any signal opens its live interactive chart
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
  X
} from 'lucide-react';
import { ScannerState, Timeframe, ScannerSignalItem, PendingRetestItem, SignalPerformanceStats } from '../types.ts';
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

  // Sub-tab view: 'signals' vs 'performance'
  const [activeSubTab, setActiveSubTab] = useState<'signals' | 'performance'>('signals');
  // Signals filter: 'all' | 'active' | 'completed'
  const [signalFilter, setSignalFilter] = useState<'all' | 'active' | 'completed'>('all');
  // Performance outcome filter
  const [historyFilter, setHistoryFilter] = useState<'all' | 'wins' | 'losses'>('all');

  // Scan Market (Single asset on active chart) state
  const [isScanningSpecificAsset, setIsScanningSpecificAsset] = useState<boolean>(false);
  const [scanMessage, setScanMessage] = useState<string | null>(null);

  /**
   * Scans the specific asset currently selected on the chart using live market data.
   * Does NOT scan a random asset. Does NOT switch the selected asset.
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
        if (data.result.signal) {
          setScanMessage(`Setup Identified on ${target}: ${data.result.signal.direction} (${data.result.signal.setupType})`);
        } else if (data.result.pendingRetest) {
          setScanMessage(`Retest Detected on ${target}: Pulling back to $${formatPrice(data.result.pendingRetest.targetLevel)}`);
        } else {
          setScanMessage(`Scan Complete on ${target} (${timeframe}): No confirmed setup. Waiting for break or retest.`);
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

  // Filter signals list based on selected filter
  const filteredSignals = useMemo(() => {
    let list = performanceSignals;
    if (signalFilter === 'active') {
      list = list.filter((s) => s.status === 'ACTIVE');
    } else if (signalFilter === 'completed') {
      list = list.filter((s) => s.status !== 'ACTIVE');
    }
    // Ranked highest probability/confidence first
    return [...list].sort((a, b) => {
      // Prioritize active signals over completed, then by confidence
      if (a.status === 'ACTIVE' && b.status !== 'ACTIVE') return -1;
      if (b.status === 'ACTIVE' && a.status !== 'ACTIVE') return 1;
      return (b.confidence || 0) - (a.confidence || 0);
    });
  }, [performanceSignals, signalFilter]);

  const latestSignal: ScannerSignalItem | null = filteredSignals.length > 0 ? filteredSignals[0] : null;

  // Filter completed signals in the performance tab
  const filteredCompleted = useMemo(() => {
    let list = performanceSignals.filter((s) => s.status !== 'ACTIVE');
    if (historyFilter === 'wins') {
      list = list.filter((s) => s.status === 'WIN');
    } else if (historyFilter === 'losses') {
      list = list.filter((s) => s.status === 'LOSS');
    }
    return list.sort((a, b) => (b.completedAt || b.timestamp) - (a.completedAt || a.timestamp));
  }, [performanceSignals, historyFilter]);

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

        {/* Timeframe Selector, Clear Scan Market Button, & Full Watchlist Refresh */}
        <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
          {/* Clear Scan Market Button - strictly scans currently selected chart asset without switching */}
          <button
            onClick={handleScanMarket}
            disabled={isScanningSpecificAsset || isScanning}
            className="flex items-center gap-1 px-2.5 py-1 rounded bg-amber-500 hover:bg-amber-400 active:scale-95 text-black font-mono font-bold text-[11px] shadow-sm transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
            title={`Scan technical structure & setups for currently selected chart asset (${selectedAsset || 'BTCUSDT'})`}
          >
            <Search className={`w-3 h-3 ${isScanningSpecificAsset ? 'animate-spin' : ''}`} />
            <span>Scan Market</span>
            <span className="text-[9.5px] bg-black/25 text-black px-1 rounded font-bold">
              {selectedAsset ? selectedAsset.replace(/USDT$/, '') : 'BTC'}
            </span>
          </button>

          <div className="flex items-center bg-[#12131a] p-0.5 rounded border border-[#20222d]">
            {SCANNER_TIMEFRAMES.map((tf) => (
              <button
                key={tf}
                onClick={() => {
                  onTimeframeChange(tf);
                  onTriggerScan(tf);
                }}
                className={`px-2 py-1 rounded text-[11px] font-mono font-medium transition cursor-pointer ${
                  timeframe === tf
                    ? 'bg-amber-500 text-black font-bold'
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
            className={`p-1.5 rounded bg-[#161822] hover:bg-[#202330] border border-[#2a2e3d] text-amber-400 transition cursor-pointer ${
              isScanning ? 'opacity-50 cursor-not-allowed' : 'active:scale-95'
            }`}
            title="Scan all watchlist pairs"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isScanning ? 'animate-spin' : ''}`} />
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

      {/* Sub-Tabs: Signals vs Performance */}
      <div className="flex items-center border-b border-[#181a24] bg-[#090a0f] p-1 shrink-0">
        <button
          onClick={() => setActiveSubTab('signals')}
          className={`flex-1 py-1.5 px-3 rounded text-xs font-mono font-bold flex items-center justify-center gap-1.5 transition cursor-pointer ${
            activeSubTab === 'signals'
              ? 'bg-[#181a24] text-white border border-[#2a2d3d] shadow-sm'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          <Layers className="w-3.5 h-3.5 text-amber-400" />
          <span>Signals</span>
          {performanceStats.activeCount > 0 && (
            <span className="text-[10px] px-1.5 py-0.2 rounded-full font-bold bg-amber-500/20 text-amber-400 border border-amber-500/30">
              {performanceStats.activeCount} live
            </span>
          )}
        </button>

        <button
          onClick={() => setActiveSubTab('performance')}
          className={`flex-1 py-1.5 px-3 rounded text-xs font-mono font-bold flex items-center justify-center gap-1.5 transition cursor-pointer ${
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
        {activeSubTab === 'signals' ? (
          <>
            {/* Signals Filter Pill Bar */}
            <div className="px-3 py-2 bg-[#0c0d12] flex items-center justify-between gap-2 border-b border-[#181a24]">
              <div className="flex items-center gap-1 text-[11px] font-mono">
                <button
                  onClick={() => setSignalFilter('all')}
                  className={`px-2 py-0.5 rounded transition cursor-pointer ${
                    signalFilter === 'all'
                      ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40 font-bold'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  All ({performanceSignals.length})
                </button>
                <button
                  onClick={() => setSignalFilter('active')}
                  className={`px-2 py-0.5 rounded transition cursor-pointer ${
                    signalFilter === 'active'
                      ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40 font-bold'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Active ({performanceStats.activeCount})
                </button>
                <button
                  onClick={() => setSignalFilter('completed')}
                  className={`px-2 py-0.5 rounded transition cursor-pointer ${
                    signalFilter === 'completed'
                      ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40 font-bold'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Completed ({performanceStats.completedCount})
                </button>
              </div>

              <span className="text-[10px] text-slate-500 font-mono">
                Ranked highest confluence
              </span>
            </div>

            {/* Prominent Latest Confirmed Signal Alert */}
            {latestSignal && signalFilter !== 'completed' ? (
              <div className="p-3 bg-[#0d0f17] border-b border-[#1f2230]">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] font-mono tracking-wider uppercase text-amber-400 font-bold flex items-center gap-1">
                    <Sparkles className="w-3 h-3 text-amber-400" />
                    Latest Technical Setup
                  </span>
                  <div className="flex items-center gap-1.5">
                    {latestSignal.status === 'ACTIVE' ? (
                      <span className="px-1.5 py-0.2 rounded text-[10px] font-mono font-bold bg-amber-500/15 text-amber-400 border border-amber-500/30 flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                        WATCHING LIVE
                      </span>
                    ) : latestSignal.status === 'WIN' ? (
                      <span className="px-1.5 py-0.2 rounded text-[10px] font-mono font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                        TP HIT
                      </span>
                    ) : latestSignal.status === 'LOSS' ? (
                      <span className="px-1.5 py-0.2 rounded text-[10px] font-mono font-bold bg-red-500/15 text-red-400 border border-red-500/30 flex items-center gap-1">
                        <XCircle className="w-3 h-3 text-red-400" />
                        SL HIT
                      </span>
                    ) : (
                      <span className="px-1.5 py-0.2 rounded text-[10px] font-mono font-bold bg-slate-800 text-slate-400 border border-slate-700">
                        EXPIRED
                      </span>
                    )}
                    <span className="text-[10px] text-slate-500 font-mono">{latestSignal.timeframe} TF</span>
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
                      <span className="font-bold text-white">{formatPrice(latestSignal.entryPrice || latestSignal.signalPrice)}</span>
                      <ArrowRight className="w-3.5 h-3.5 text-slate-500 group-hover:text-amber-400 transition transform group-hover:translate-x-0.5" />
                    </div>
                  </div>

                  {/* Mandatory V8 Targets Display: Entry, TP, SL */}
                  <div className="mt-2.5 p-2 rounded bg-[#0a0c12] border border-[#1e2130] grid grid-cols-3 gap-2 text-center font-mono">
                    <div>
                      <div className="text-[10px] text-slate-500 uppercase">Entry Price</div>
                      <div className="text-xs font-bold text-white">{formatPrice(latestSignal.entryPrice || latestSignal.signalPrice)}</div>
                    </div>
                    <div>
                      <div className="text-[10px] text-emerald-400 uppercase font-semibold">Target (TP)</div>
                      <div className="text-xs font-bold text-emerald-400">{formatPrice(latestSignal.takeProfit)}</div>
                    </div>
                    <div>
                      <div className="text-[10px] text-red-400 uppercase font-semibold">Stop (SL)</div>
                      <div className="text-xs font-bold text-red-400">{formatPrice(latestSignal.stopLoss)}</div>
                    </div>
                  </div>

                  <p className="text-xs text-slate-300 mt-2 leading-relaxed">
                    {latestSignal.reason}
                  </p>

                  <div className="mt-2.5 pt-2 border-t border-[#1a1d29] flex items-center justify-between text-[11px] font-mono text-slate-400">
                    <div className="flex items-center gap-1.5">
                      <Shield className="w-3 h-3 text-red-400" />
                      <span>SL: <strong className="text-red-400">{formatPrice(latestSignal.stopLoss)}</strong></span>
                    </div>
                    <span className="text-[10px] text-amber-400/80 font-semibold">
                      {latestSignal.confidence}% Confluence
                    </span>
                  </div>
                </div>
              </div>
            ) : null}

            {/* Confirmed Signals Section */}
            <div className="p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5 text-amber-400" />
                  Signals ({filteredSignals.length})
                </span>
                <span className="text-[10px] text-slate-500 font-mono">
                  Click opens asset chart
                </span>
              </div>

              {filteredSignals.length === 0 ? (
                <div className="p-5 text-center rounded border border-[#181a24] bg-[#0c0d12] text-slate-500 text-xs font-mono">
                  {isScanning
                    ? 'Scanning market candles across pairs...'
                    : `No ${signalFilter !== 'all' ? signalFilter : ''} signals on ${timeframe}. Waiting for structural breakout or retest.`}
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
                                isUp
                                  ? 'bg-emerald-500/15 text-emerald-400'
                                  : 'bg-red-500/15 text-red-400'
                              }`}
                            >
                              {isUp ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                              {s.direction}
                            </span>
                            <span className="text-[10px] font-mono text-slate-400 truncate max-w-[120px]">
                              {s.setupType}
                            </span>
                          </div>

                          {/* Status Badge */}
                          <div>
                            {s.status === 'ACTIVE' ? (
                              <span className="px-1.5 py-0.2 rounded text-[10px] font-mono font-bold bg-amber-500/15 text-amber-400 border border-amber-500/30 flex items-center gap-1">
                                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                                ACTIVE
                              </span>
                            ) : s.status === 'WIN' ? (
                              <span className="px-1.5 py-0.2 rounded text-[10px] font-mono font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 flex items-center gap-0.5">
                                <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                                WIN {s.pnlPercent ? `+${s.pnlPercent.toFixed(1)}%` : ''}
                              </span>
                            ) : s.status === 'LOSS' ? (
                              <span className="px-1.5 py-0.2 rounded text-[10px] font-mono font-bold bg-red-500/15 text-red-400 border border-red-500/30 flex items-center gap-0.5">
                                <XCircle className="w-3 h-3 text-red-400" />
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
                          <span>{s.timeframe} TF • {new Date(s.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                          <span className="text-amber-400/80 font-bold">{s.confidence}% Conf.</span>
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
        ) : (
          /* ========================================================================= */
          /* PERFORMANCE ANALYSIS TAB                                                  */
          /* ========================================================================= */
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

              <div className="flex items-baseline gap-3 my-1">
                <span className="font-mono font-black text-3xl text-emerald-400 tracking-tight">
                  {performanceStats.tpRate}%
                </span>
                <span className="text-xs font-mono text-slate-400">
                  ({performanceStats.winsCount} Wins / {performanceStats.lossesCount} Losses)
                </span>
              </div>

              {/* Progress bar */}
              <div className="w-full bg-[#1b1e2c] h-2 rounded-full overflow-hidden my-2 flex">
                <div
                  className="bg-emerald-500 h-full transition-all duration-500"
                  style={{ width: `${Math.min(100, performanceStats.tpRate)}%` }}
                />
                <div
                  className="bg-red-500 h-full transition-all duration-500"
                  style={{ width: `${Math.max(0, 100 - performanceStats.tpRate)}%` }}
                />
              </div>

              <div className="grid grid-cols-3 gap-2 mt-3 pt-2.5 border-t border-[#1c1f2e] text-center font-mono">
                <div>
                  <div className="text-[10px] text-slate-500">Active Watching</div>
                  <div className="text-sm font-bold text-amber-400">{performanceStats.activeCount}</div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-500">Avg Win PnL</div>
                  <div className="text-sm font-bold text-emerald-400">+{performanceStats.avgWinPercent}%</div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-500">Profit Factor</div>
                  <div className="text-sm font-bold text-white">{performanceStats.profitFactor}</div>
                </div>
              </div>
            </div>

            {/* Performance By Setup Type */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5 text-amber-400" />
                  Performance by Setup Type
                </span>
                <span className="text-[10px] text-slate-500 font-mono">Real historical outcomes</span>
              </div>

              <div className="space-y-1.5">
                {Object.keys(performanceStats.bySetupType).length === 0 ? (
                  <div className="p-3 text-center text-xs text-slate-500 font-mono bg-[#0c0d12] rounded border border-[#181a24]">
                    Awaiting settled signals to populate setup stats
                  </div>
                ) : (
                  Object.entries(performanceStats.bySetupType).map(([setup, data]) => (
                    <div
                      key={setup}
                      className="p-2.5 rounded bg-[#0d0e14] border border-[#1b1d28] flex items-center justify-between font-mono text-xs"
                    >
                      <div>
                        <div className="font-semibold text-white">{setup}</div>
                        <div className="text-[10px] text-slate-500">
                          {data.total} recorded ({data.wins}W / {data.losses}L • {data.active} active)
                        </div>
                      </div>

                      <div className="text-right">
                        <span
                          className={`px-2 py-0.5 rounded text-[11px] font-bold ${
                            data.tpRate >= 60
                              ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                              : data.tpRate > 0
                              ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
                              : 'bg-slate-800 text-slate-400'
                          }`}
                        >
                          {data.tpRate}% TP
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Performance by Timeframe & Direction Grid */}
            <div className="grid grid-cols-2 gap-2">
              {/* By Direction */}
              <div className="p-2.5 rounded bg-[#0c0d14] border border-[#1a1c27]">
                <div className="text-[11px] font-mono font-bold text-slate-300 mb-1.5 flex items-center gap-1">
                  <Compass className="w-3 h-3 text-amber-400" />
                  By Direction
                </div>
                <div className="space-y-1 font-mono text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-emerald-400 font-bold">UP Signals</span>
                    <span className="font-bold text-white">
                      {performanceStats.byDirection.UP.tpRate}% ({performanceStats.byDirection.UP.wins}W/{performanceStats.byDirection.UP.losses}L)
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-red-400 font-bold">DOWN Signals</span>
                    <span className="font-bold text-white">
                      {performanceStats.byDirection.DOWN.tpRate}% ({performanceStats.byDirection.DOWN.wins}W/{performanceStats.byDirection.DOWN.losses}L)
                    </span>
                  </div>
                </div>
              </div>

              {/* By Timeframe */}
              <div className="p-2.5 rounded bg-[#0c0d14] border border-[#1a1c27]">
                <div className="text-[11px] font-mono font-bold text-slate-300 mb-1.5 flex items-center gap-1">
                  <Clock className="w-3 h-3 text-amber-400" />
                  By Timeframe
                </div>
                <div className="space-y-1 font-mono text-xs">
                  {Object.entries(performanceStats.byTimeframe).slice(0, 3).map(([tf, d]) => (
                    <div key={tf} className="flex items-center justify-between">
                      <span className="text-slate-400 font-bold">{tf}</span>
                      <span className="font-semibold text-white">{d.tpRate}% ({d.wins}W/{d.losses}L)</span>
                    </div>
                  ))}
                  {Object.keys(performanceStats.byTimeframe).length === 0 && (
                    <div className="text-[10px] text-slate-500">Tracking...</div>
                  )}
                </div>
              </div>
            </div>

            {/* Completed Signals Log */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                  Settled Signal Results ({filteredCompleted.length})
                </span>

                <div className="flex items-center gap-1 text-[10px] font-mono">
                  <button
                    onClick={() => setHistoryFilter('all')}
                    className={`px-1.5 py-0.5 rounded cursor-pointer ${
                      historyFilter === 'all' ? 'bg-[#1e2232] text-white font-bold' : 'text-slate-500'
                    }`}
                  >
                    All
                  </button>
                  <button
                    onClick={() => setHistoryFilter('wins')}
                    className={`px-1.5 py-0.5 rounded cursor-pointer ${
                      historyFilter === 'wins' ? 'bg-emerald-500/20 text-emerald-400 font-bold' : 'text-slate-500'
                    }`}
                  >
                    Wins
                  </button>
                  <button
                    onClick={() => setHistoryFilter('losses')}
                    className={`px-1.5 py-0.5 rounded cursor-pointer ${
                      historyFilter === 'losses' ? 'bg-red-500/20 text-red-400 font-bold' : 'text-slate-500'
                    }`}
                  >
                    Losses
                  </button>
                </div>
              </div>

              {filteredCompleted.length === 0 ? (
                <div className="p-4 text-center rounded border border-[#181a24] bg-[#0c0d12] text-slate-500 text-xs font-mono">
                  No completed results match the filter. Active signals are being watched live.
                </div>
              ) : (
                <div className="space-y-1.5 max-h-96 lg:max-h-80 overflow-y-auto pr-1 overscroll-contain">
                  {filteredCompleted.map((item) => {
                    const isWin = item.status === 'WIN';
                    const isLoss = item.status === 'LOSS';

                    return (
                      <div
                        key={item.id}
                        onClick={() => onSelectAsset(item.asset)}
                        className="p-2 rounded bg-[#0b0c12] border border-[#171924] hover:border-slate-700 cursor-pointer transition flex items-center justify-between font-mono text-xs"
                      >
                        <div>
                          <div className="flex items-center gap-1.5">
                            <span className="font-bold text-white">{item.asset}</span>
                            <span
                              className={`text-[10px] font-bold px-1 rounded ${
                                item.direction === 'UP' ? 'text-emerald-400 bg-emerald-500/10' : 'text-red-400 bg-red-500/10'
                              }`}
                            >
                              {item.direction}
                            </span>
                            <span className="text-[10px] text-slate-400 truncate max-w-[100px]">
                              {item.setupType}
                            </span>
                          </div>
                          <div className="text-[10px] text-slate-500 mt-0.5">
                            {item.statusReason || `${item.status} settled`}
                          </div>
                        </div>

                        <div className="text-right">
                          <span
                            className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                              isWin
                                ? 'bg-emerald-500/15 text-emerald-400'
                                : isLoss
                                ? 'bg-red-500/15 text-red-400'
                                : 'bg-slate-800 text-slate-400'
                            }`}
                          >
                            {isWin ? 'TP HIT' : isLoss ? 'SL HIT' : 'EXPIRED'}
                            {item.pnlPercent ? ` (${item.pnlPercent > 0 ? '+' : ''}${item.pnlPercent.toFixed(1)}%)` : ''}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Clear History Action */}
            {onClearHistory && (
              <div className="pt-2 flex justify-end">
                <button
                  onClick={onClearHistory}
                  className="flex items-center gap-1 px-2.5 py-1 text-[10px] font-mono text-slate-500 hover:text-red-400 border border-[#1d202d] hover:border-red-500/40 rounded transition cursor-pointer"
                  title="Clear settled signal history (retains active signals)"
                >
                  <Trash2 className="w-3 h-3" />
                  <span>Clear Completed History</span>
                </button>
              </div>
            )}
          </div>
        )}

        {/* Clean Natural Footer - sits directly at the end of content without oversized empty container */}
        <div className="mt-4 px-3 py-3 border-t border-[#181920] bg-[#08090d] text-[10px] text-slate-500 flex items-center justify-between font-mono">
          <span>NWWT Structure Analysis</span>
          <span>Educational Market Data Only</span>
        </div>
      </div>
    </div>
  );
};

export default WatchlistScannerPanel;
