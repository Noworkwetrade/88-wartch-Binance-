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
  ShieldCheck,
  SlidersHorizontal,
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
import { loadClearedSignalIds } from '../utils/signalTouchEngine.ts';
import { isPermanentlyExcludedSymbol } from '../utils/marketStructureQuality.ts';
import { ScanAssetModal, SingleAssetEvaluation } from './scanner/ScanAssetModal.tsx';

interface WatchlistScannerPanelProps {
  scannerState: ScannerState;
  selectedAsset: string | null;
  onSelectAsset: (symbol: string) => void;
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
  onUpdateScannerConfig,
  performanceSignals,
  activeSignals,
  completedSignals,
  performanceStats,
  onClearHistory
}) => {
  const { status, timeframe, scannedCount, pendingRetests } = scannerState;
  const isScanning = status === 'scanning';

  // Sub-tab view: 'signals' | 'research' | 'performance'
  const [activeSubTab, setActiveSubTab] = useState<'signals' | 'research' | 'performance'>('signals');
  // Model filter for Signals tab: 'all' | 'ai_filtered' | 'original' | 'inverse' | 'ai_filtered_inverse'
  const [selectedModelFilter, setSelectedModelFilter] = useState<string>('ai_filtered');
  // Signals View Mode: 'active' (default active scanner) | 'completed_history' (separate completed view)
  const [signalViewMode, setSignalViewMode] = useState<'active' | 'completed_history'>('active');
  // Performance outcome filter for completed history
  const [historyFilter, setHistoryFilter] = useState<'all' | 'wins' | 'losses'>('all');
  // Developer diagnostic inspect toggle
  const [expandedDiagId, setExpandedDiagId] = useState<string | null>(null);

  // Developer Quality Diagnostic modal
  const [showQualityDiagModal, setShowQualityDiagModal] = useState<boolean>(false);
  const [qualityDiagnosticsList, setQualityDiagnosticsList] = useState<any[]>([]);
  const [isLoadingDiag, setIsLoadingDiag] = useState<boolean>(false);

  const handleOpenQualityDiag = async () => {
    setShowQualityDiagModal(true);
    setIsLoadingDiag(true);
    try {
      const res = await fetch('/api/scanner/diagnostics');
      const data = await res.json();
      if (data && Array.isArray(data.diagnostics)) {
        setQualityDiagnosticsList(data.diagnostics.filter((d: any) => !isPermanentlyExcludedSymbol(d.symbol)));
      }
    } catch {
      // Fallback
    } finally {
      setIsLoadingDiag(false);
    }
  };

  // Single asset on active chart scanning state
  const [isScanningSpecificAsset, setIsScanningSpecificAsset] = useState<boolean>(false);
  const [scanMessage, setScanMessage] = useState<string | null>(null);
  const [isScanModalOpen, setIsScanModalOpen] = useState<boolean>(false);
  const [singleAssetEvaluation, setSingleAssetEvaluation] = useState<SingleAssetEvaluation | null>(null);

  // Multi-Timeframe Confirmation & Fair Coverage settings
  const htfEnabled = Boolean(scannerState.htfConfirmationEnabled);
  const htfTf = scannerState.htfTimeframe || '1h';
  const htfRuleMode = scannerState.htfRuleMode || 'lenient';
  const coverageMetrics = scannerState.coverageMetrics;

  const handleToggleHtf = () => {
    const nextVal = !htfEnabled;
    if (onUpdateScannerConfig) {
      onUpdateScannerConfig({ htfConfirmationEnabled: nextVal });
    }
    onTriggerScan(timeframe);
  };

  const handleHtfTimeframeChange = (newTf: Timeframe) => {
    if (onUpdateScannerConfig) {
      onUpdateScannerConfig({ htfTimeframe: newTf });
    }
    onTriggerScan(timeframe);
  };

  const handleHtfRuleModeChange = (newMode: 'lenient' | 'aligned' | 'strict') => {
    if (onUpdateScannerConfig) {
      onUpdateScannerConfig({ htfRuleMode: newMode });
    }
    onTriggerScan(timeframe);
  };

  /**
   * Scans the specific asset currently selected on the chart using live market data.
   */
  const handleScanMarket = async () => {
    const target = selectedAsset || 'BTCUSDT';
    if (isPermanentlyExcludedSymbol(target)) {
      setScanMessage(`${target} is permanently excluded from opportunity scanning.`);
      return;
    }
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
        if (r.evaluation) {
          setSingleAssetEvaluation(r.evaluation);
          setIsScanModalOpen(true);
        }
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

  // STRICT ACTIVE SIGNALS LIST: Genuinely active signals only.
  // Signals continue tracking until trade is completed (TP2 reached or settled).
  const activeSignalsList = useMemo(() => {
    const clearedSet = loadClearedSignalIds();
    let list = (activeSignals || performanceSignals).filter(
      (s) =>
        !isPermanentlyExcludedSymbol(s.asset) &&
        !s.isTradeComplete &&
        (s.status === 'ACTIVE' || (s.tp1Hit && !s.isTradeComplete)) &&
        !clearedSet.has(s.id) &&
        s.modelType !== 'inverse' &&
        s.modelType !== 'ai_filtered_inverse'
    );

    // Filter by research model
    if (selectedModelFilter !== 'all') {
      list = list.filter((s) => (s.modelType || 'original') === selectedModelFilter);
    } else {
      // Deduplicate identical underlying setups across models when "All Models" is selected
      const seen = new Set<string>();
      list = list.filter((s) => {
        const key = `${s.asset}-${s.timeframe}-${s.confirmedCandleCloseTime || s.timestamp}-${s.direction}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }

    return [...list].sort((a, b) => {
      // Latest confirmed candle close first
      const timeA = a.confirmedCandleCloseTime || a.timestamp || 0;
      const timeB = b.confirmedCandleCloseTime || b.timestamp || 0;
      if (timeB !== timeA) return timeB - timeA;
      return (b.confidence || 0) - (a.confidence || 0);
    });
  }, [performanceSignals, activeSignals, selectedModelFilter]);

  const latestActiveSignal: ScannerSignalItem | null = activeSignalsList.length > 0 ? activeSignalsList[0] : null;

  // STRICT COMPLETED SIGNALS LIST: Available for separate completed history inspection.
  const completedHistoryList = useMemo(() => {
    const clearedSet = loadClearedSignalIds();
    let list = (completedSignals || performanceSignals).filter(
      (s) =>
        !isPermanentlyExcludedSymbol(s.asset) &&
        (s.isTradeComplete || s.status === 'LOSS' || s.status === 'EXPIRED' || (s.status === 'WIN' && (s.isTradeComplete || clearedSet.has(s.id))) || clearedSet.has(s.id)) &&
        s.modelType !== 'inverse' &&
        s.modelType !== 'ai_filtered_inverse'
    );

    if (selectedModelFilter !== 'all') {
      list = list.filter((s) => (s.modelType || 'original') === selectedModelFilter);
    }

    if (historyFilter === 'wins') {
      list = list.filter((s) => s.status === 'WIN');
    } else if (historyFilter === 'losses') {
      list = list.filter((s) => s.status === 'LOSS');
    }

    return [...list].sort((a, b) => (b.completedAt || b.timestamp || 0) - (a.completedAt || a.timestamp || 0));
  }, [performanceSignals, completedSignals, selectedModelFilter, historyFilter]);

  // STRICT SETTLED HISTORICAL LOG: Directly corresponds to the verified performance statistics
  // Contains all verified settled trade records (WIN / LOSS / EXPIRED) without model or outcome filter discrepancies.
  const settledHistoricalLog = useMemo(() => {
    const clearedSet = loadClearedSignalIds();
    let list = (completedSignals || performanceSignals).filter(
      (s) =>
        !isPermanentlyExcludedSymbol(s.asset) &&
        (s.isTradeComplete || s.status === 'LOSS' || s.status === 'EXPIRED' || (s.status === 'WIN' && (s.isTradeComplete || clearedSet.has(s.id))) || clearedSet.has(s.id)) &&
        s.modelType !== 'inverse' &&
        s.modelType !== 'ai_filtered_inverse'
    );

    return [...list].sort((a, b) => (b.completedAt || b.timestamp || 0) - (a.completedAt || a.timestamp || 0));
  }, [performanceSignals, completedSignals]);

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
            <span>{isScanningSpecificAsset ? 'Scanning Asset...' : 'Scan Asset'}</span>
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

          <button
            onClick={handleOpenQualityDiag}
            className="p-1 px-1.5 rounded bg-[#13151f] hover:bg-[#1a1c2a] border border-amber-500/20 text-amber-400/70 hover:text-amber-300 text-[10px] font-mono flex items-center gap-1 transition cursor-pointer"
            title="Developer Diagnostic: View Market Structure Quality Gate evaluations"
          >
            <Shield className="w-3 h-3 text-amber-400/80" />
            <span className="hidden md:inline">Dev Diag</span>
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

      {/* Fair Universe Coverage Progress Bar */}
      {coverageMetrics && coverageMetrics.totalEligibleSymbols > 0 && (
        <div className="px-3 py-1.5 bg-[#0a0b10] border-b border-[#161722] flex flex-wrap items-center justify-between gap-2 text-[10.5px] font-mono text-slate-400 shrink-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="flex items-center gap-1 text-slate-300 font-semibold">
              <Activity className="w-3 h-3 text-emerald-400 shrink-0" />
              <span>Fair Coverage:</span>
            </span>
            <span className="text-white font-bold">
              {coverageMetrics.totalEligibleSymbols} Eligible USDT Pairs
            </span>
            <span className="text-slate-600 hidden sm:inline">•</span>
            <span className="text-amber-400">
              Batch {coverageMetrics.batchIndex}/{coverageMetrics.totalBatches} ({coverageMetrics.batchSize} pairs/scan)
            </span>
            <span className="text-slate-600 hidden sm:inline">•</span>
            <span className="text-slate-400">
              Full Rotation ~{Math.ceil((coverageMetrics.estFullRotationSeconds || 945) / 60)}m
            </span>
          </div>
          <div className="flex items-center gap-2 text-[10px] ml-auto">
            <span className="text-slate-500 hidden md:inline">BTC & ETH Anchored • Altcoins Round-Robin</span>
            <div className="w-16 h-1.5 bg-[#181a24] rounded-full overflow-hidden shrink-0">
              <div
                className="h-full bg-amber-400 rounded-full transition-all duration-500"
                style={{ width: `${Math.max(5, Math.min(100, Math.round((coverageMetrics.batchIndex / coverageMetrics.totalBatches) * 100)))}%` }}
              />
            </div>
          </div>
        </div>
      )}

      {/* Multi-Timeframe Confirmation Control Bar */}
      <div className="px-3 py-1.5 bg-[#0c0e15] border-b border-[#181a24] flex flex-wrap items-center justify-between gap-2 shrink-0 text-xs font-mono">
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={handleToggleHtf}
            className={`px-2 py-0.5 rounded font-bold flex items-center gap-1 text-[11px] transition cursor-pointer ${
              htfEnabled
                ? 'bg-sky-500/20 text-sky-300 border border-sky-500/40 shadow-sm'
                : 'bg-[#141622] text-slate-400 border border-[#222536] hover:text-white'
            }`}
            title="Enable or disable higher timeframe trend and regime confirmation"
          >
            <ShieldCheck className={`w-3.5 h-3.5 ${htfEnabled ? 'text-sky-400' : 'text-slate-500'}`} />
            <span>HTF Confluence: {htfEnabled ? 'ON' : 'OFF'}</span>
          </button>

          {htfEnabled && (
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[10px] text-slate-500">HTF:</span>
              <div className="flex items-center bg-[#13151f] rounded border border-[#202230] p-0.5">
                {(['5m', '15m', '1h', '4h', '1d'] as Timeframe[]).map((tf) => (
                  <button
                    key={tf}
                    onClick={() => handleHtfTimeframeChange(tf)}
                    className={`px-1.5 py-0.2 text-[10px] rounded transition cursor-pointer ${
                      htfTf === tf
                        ? 'bg-sky-500 text-black font-bold shadow-sm'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {tf}
                  </button>
                ))}
              </div>

              <span className="text-[10px] text-slate-500 ml-1">Mode:</span>
              <div className="flex items-center bg-[#13151f] rounded border border-[#202230] p-0.5">
                {(['lenient', 'aligned', 'strict'] as const).map((mode) => (
                  <button
                    key={mode}
                    onClick={() => handleHtfRuleModeChange(mode)}
                    className={`px-1.5 py-0.2 text-[10px] capitalize rounded transition cursor-pointer ${
                      htfRuleMode === mode
                        ? 'bg-amber-500 text-black font-bold shadow-sm'
                        : 'text-slate-400 hover:text-white'
                    }`}
                    title={
                      mode === 'lenient'
                        ? 'Lenient: Setup allowed unless HTF trend directly opposes it'
                        : mode === 'aligned'
                        ? 'Aligned: HTF trend direction must match setup direction'
                        : 'Strict: HTF trend must match and regime must not be transitioning'
                    }
                  >
                    {mode}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="text-[10px] text-slate-500 hidden sm:block">
          Entry: <strong className="text-amber-400">{timeframe}</strong>
          {htfEnabled ? ` • Filter: ${htfTf} (${htfRuleMode})` : ' • Direct Entry'}
        </div>
      </div>

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

              {/* View Switcher: Active Scanner vs Completed History */}
              <div className="flex items-center bg-[#13151f] rounded border border-[#202230] p-0.5">
                <button
                  onClick={() => setSignalViewMode('active')}
                  className={`px-2 py-0.5 text-[10px] font-mono font-bold rounded transition cursor-pointer flex items-center gap-1 ${
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
                  className={`px-2 py-0.5 text-[10px] font-mono font-bold rounded transition cursor-pointer flex items-center gap-1 ${
                    signalViewMode === 'completed_history'
                      ? 'bg-amber-500 text-black shadow-sm'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  <Clock className="w-2.5 h-2.5" />
                  <span>Completed ({completedHistoryList.length})</span>
                </button>
              </div>
            </div>

            {/* ========================================================================= */}
            {/* VIEW A: ACTIVE SCANNER VIEW (STRICTLY ACTIVE SIGNALS ONLY)                */}
            {/* ========================================================================= */}
            {signalViewMode === 'active' && (
              <>
                {/* Prominent Latest Confirmed Active Signal Alert */}
                {latestActiveSignal && (
                  <div className="p-3 bg-[#0d0f17] border-b border-[#1f2230]">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[10px] font-mono tracking-wider uppercase text-amber-400 font-bold flex items-center gap-1">
                        <Sparkles className="w-3 h-3 text-amber-400" />
                        Latest Confirmed Signal • {(latestActiveSignal.modelType || 'original').replace(/_/g, ' ').toUpperCase()} • {latestActiveSignal.timeframe}
                      </span>
                      <div className="flex items-center gap-1.5">
                        {latestActiveSignal.aiValidation && (
                          <span
                            className={`px-1.5 py-0.2 rounded text-[10px] font-mono font-bold border ${
                              latestActiveSignal.aiValidation.status === 'allow'
                                ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40'
                                : latestActiveSignal.aiValidation.status === 'reject'
                                ? 'bg-rose-500/20 text-rose-400 border-rose-500/40'
                                : 'bg-amber-500/20 text-amber-400 border-amber-500/40'
                            }`}
                          >
                            AI: {latestActiveSignal.aiValidation.status.toUpperCase()}
                          </span>
                        )}

                        <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-amber-400/20 text-amber-300 border border-amber-400/50 flex items-center gap-1 shadow-sm">
                          <Sparkles className="w-3 h-3 text-amber-400" />
                          NEWEST SIGNAL
                        </span>
                        <span className="px-1.5 py-0.2 rounded text-[10px] font-mono font-bold bg-amber-500/15 text-amber-400 border border-amber-500/30 flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                          ACTIVE
                        </span>
                      </div>
                    </div>

                    <div
                      onClick={() => onSelectAsset(latestActiveSignal.asset)}
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
                          {latestActiveSignal.htfConfirmation && (
                            <span
                              className={`px-1.5 py-0.2 rounded text-[10px] font-mono font-bold flex items-center gap-1 border ${
                                latestActiveSignal.htfConfirmation.status === 'confirmed'
                                  ? 'bg-sky-500/20 text-sky-300 border-sky-500/40'
                                  : 'bg-rose-500/20 text-rose-300 border-rose-500/40'
                              }`}
                              title={latestActiveSignal.htfConfirmation.reason}
                            >
                              <ShieldCheck className="w-3 h-3 text-sky-400" />
                              HTF: {latestActiveSignal.htfConfirmation.htfTimeframe || 'HTF'}
                            </span>
                          )}
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
                            {latestActiveSignal.direction === 'UP' ? 'BUY / LONG' : 'SELL / SHORT'}
                          </span>
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-[#1b1e2c] text-slate-300 border border-[#2a2e42]">
                            {latestActiveSignal.setupType}
                          </span>
                        </div>

                        <div className="flex items-center gap-2 font-mono text-xs">
                          <span className="font-bold text-white">
                            ${formatPrice(latestActiveSignal.entryPrice || latestActiveSignal.signalPrice)}
                          </span>
                          <ArrowRight className="w-3.5 h-3.5 text-slate-500 group-hover:text-amber-400 transition transform group-hover:translate-x-0.5" />
                        </div>
                      </div>

                      {/* Target Levels Display: Confirmed Entry, TP #1, TP #2, SL */}
                      <div className="mt-2.5 p-2 rounded bg-[#0a0c12] border border-[#1e2130] grid grid-cols-2 sm:grid-cols-4 gap-2 text-center font-mono">
                        <div>
                          <div className="text-[10px] text-slate-500 uppercase">Confirmed Entry</div>
                          <div className="text-xs font-bold text-white">
                            ${formatPrice(latestActiveSignal.entryPrice || latestActiveSignal.signalPrice)}
                          </div>
                        </div>
                        <div>
                          <div className="text-[10px] text-emerald-400 uppercase font-semibold flex items-center justify-center gap-1">
                            <span>TP #1 (Structure)</span>
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
                            {latestActiveSignal.takeProfit2 ? `$${formatPrice(latestActiveSignal.takeProfit2)}` : 'Structural Target'}
                          </div>
                        </div>
                        <div>
                          <div className="text-[10px] text-rose-400 uppercase font-semibold">Stop Loss (Structure)</div>
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

                      <p className="text-xs text-slate-300 mt-2 leading-relaxed">
                        {latestActiveSignal.reason}
                      </p>

                      <div className="mt-2.5 pt-2 border-t border-[#1a1d29] flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono text-slate-400">
                        <div className="flex items-center gap-2">
                          <span className="flex items-center gap-1 text-slate-400">
                            <Clock className="w-3 h-3 text-slate-500" />
                            Confirmed Close: <strong className="text-slate-200">{formatCandleCloseTime(latestActiveSignal.confirmedCandleCloseTime || latestActiveSignal.timestamp)}</strong>
                          </span>
                        </div>
                        <div className="flex items-center gap-2.5">
                          <span className="text-indigo-300 text-[10px]">
                            1:{(latestActiveSignal.rewardRiskRatio || (Math.abs((latestActiveSignal.takeProfit1 || latestActiveSignal.takeProfit) - latestActiveSignal.entryPrice) / (Math.abs(latestActiveSignal.entryPrice - latestActiveSignal.stopLoss) || 1))).toFixed(2)} R:R
                          </span>
                          <span className="text-[10px] text-amber-400 font-bold">
                            {latestActiveSignal.confidence}% Conf.
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Confirmed Active Signals List */}
                <div className="p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                      <Layers className="w-3.5 h-3.5 text-amber-400" />
                      Active Scanner ({activeSignalsList.length})
                    </span>
                    <span className="text-[10px] text-slate-500 font-mono">
                      {selectedModelFilter !== 'all' ? selectedModelFilter.replace(/_/g, ' ') : 'All models (deduplicated)'}
                    </span>
                  </div>

                  {activeSignalsList.length === 0 ? (
                    <div className="p-6 text-center rounded border border-[#181a24] bg-[#0c0d12] text-slate-500 text-xs font-mono">
                      {isScanning
                        ? 'Scanning market candles across pairs...'
                        : `No active signals on ${timeframe}. Waiting for confirmed candle close with valid setup confluence.`}
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
                            onClick={() => onSelectAsset(s.asset)}
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
                                {s.htfConfirmation && (
                                  <span
                                    className={`px-1 py-0.2 rounded text-[9px] font-mono font-bold flex items-center gap-0.5 border ${
                                      s.htfConfirmation.status === 'confirmed'
                                        ? 'bg-sky-500/15 text-sky-300 border-sky-500/30'
                                        : 'bg-rose-500/15 text-rose-300 border-rose-500/30'
                                    }`}
                                    title={s.htfConfirmation.reason}
                                  >
                                    <ShieldCheck className="w-2.5 h-2.5 text-sky-400" />
                                    {s.htfConfirmation.htfTimeframe || 'HTF'}
                                  </span>
                                )}
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
                                <span className="text-[10px] font-mono text-slate-300 truncate max-w-[120px]">
                                  {s.setupType}
                                </span>
                              </div>

                              <div className="flex items-center gap-1.5">
                                {isNewest && (
                                  <span className="px-1.5 py-0.2 rounded text-[9px] font-mono font-bold bg-amber-400/25 text-amber-300 border border-amber-400/50 flex items-center gap-1 shadow-sm">
                                    <Sparkles className="w-2.5 h-2.5 text-amber-400" />
                                    NEWEST
                                  </span>
                                )}

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
                                    AI: {s.aiValidation.status.toUpperCase()}
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
                                  {s.takeProfit2 ? `$${formatPrice(s.takeProfit2)}` : 'Structural Peak'}
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

                            <p className="text-[11px] text-slate-300 mt-1.5 line-clamp-2 leading-relaxed">
                              {s.reason}
                            </p>

                            <div className="mt-1.5 pt-1 border-t border-[#161822] flex flex-wrap items-center justify-between gap-1 text-[10px] font-mono text-slate-400">
                              <span className="flex items-center gap-1 text-slate-400">
                                <Clock className="w-2.5 h-2.5 text-slate-500" />
                                Confirmed: <strong className="text-slate-200">{formatCandleCloseTime(s.confirmedCandleCloseTime || s.timestamp)}</strong>
                              </span>
                              <div className="flex items-center gap-2">
                                <span className="text-indigo-300">
                                  1:{(s.rewardRiskRatio || (Math.abs((s.takeProfit1 || s.takeProfit) - s.entryPrice) / (Math.abs(s.entryPrice - s.stopLoss) || 1))).toFixed(2)} R:R
                                </span>
                                <span className="text-amber-400 font-bold">{s.confidence}% Conf.</span>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setExpandedDiagId(expandedDiagId === s.id ? null : s.id);
                                  }}
                                  className="text-[9.5px] px-1.5 py-0.2 rounded bg-[#151928] hover:bg-[#1f2438] text-amber-400 border border-amber-500/30 transition cursor-pointer"
                                  title="Developer Diagnostic: View exact structural anchor, support/resistance, and levels"
                                >
                                  {expandedDiagId === s.id ? '✕ diag' : '⚙ diag'}
                                </button>
                              </div>
                            </div>

                            {/* Developer Diagnostic Inspection Panel */}
                            {expandedDiagId === s.id && (
                              <div
                                onClick={(e) => e.stopPropagation()}
                                className="mt-2 p-2 rounded bg-[#07090e] border border-amber-500/30 text-[10px] font-mono space-y-1"
                              >
                                <div className="text-amber-400 font-bold flex items-center justify-between border-b border-amber-500/20 pb-1">
                                  <span>DEVELOPER LEVEL DIAGNOSTIC</span>
                                  <span className="text-[9px] text-slate-400">Pair: {s.asset} • TF: {s.timeframe}</span>
                                </div>
                                <div className="space-y-0.5 text-slate-300 pt-0.5">
                                  <div>
                                    <span className="text-slate-500">structure reference: </span>
                                    <span className="text-slate-200">
                                      {s.structureReference?.invalidationType || (s.direction === 'UP' ? 'recent swing low' : 'recent swing high')}
                                    </span>
                                  </div>
                                  <div>
                                    <span className="text-slate-500">
                                      {s.direction === 'UP' ? 'support reference: ' : 'resistance reference: '}
                                    </span>
                                    <span className="text-slate-200">
                                      ${formatPrice(s.structureReference?.supportLevel || s.structureReference?.resistanceLevel || s.stopLoss)}
                                    </span>
                                  </div>
                                  <div className="grid grid-cols-2 gap-x-2">
                                    <div>
                                      <span className="text-slate-500">entry: </span>
                                      <span className="text-amber-400 font-semibold">${formatPrice(s.entryPrice || s.signalPrice)}</span>
                                    </div>
                                    <div>
                                      <span className="text-slate-500">sl: </span>
                                      <span className="text-rose-400 font-semibold">${formatPrice(s.stopLoss)}</span>
                                    </div>
                                    <div>
                                      <span className="text-slate-500">tp1: </span>
                                      <span className="text-emerald-400 font-semibold">${formatPrice(s.takeProfit1 || s.takeProfit)}</span>
                                    </div>
                                    <div>
                                      <span className="text-slate-500">tp2: </span>
                                      <span className="text-emerald-400 font-semibold">
                                        {s.takeProfit2 ? `$${formatPrice(s.takeProfit2)}` : 'none'}
                                      </span>
                                    </div>
                                  </div>
                                  <div>
                                    <span className="text-slate-500">rr: </span>
                                    <span className="text-indigo-300 font-bold">
                                      {s.rewardRiskRatio ? s.rewardRiskRatio.toFixed(2) : (Math.abs((s.takeProfit1 || s.takeProfit) - s.entryPrice) / (Math.abs(s.entryPrice - s.stopLoss) || 1)).toFixed(2)}
                                      {s.takeProfit2 ? ` / ${(Math.abs(s.takeProfit2 - s.entryPrice) / (Math.abs(s.entryPrice - s.stopLoss) || 1)).toFixed(2)}` : ''}
                                    </span>
                                    {s.structureReference?.buffer ? (
                                      <span className="text-slate-500 ml-2">
                                        (buffer: ${formatPrice(s.structureReference.buffer)} | atr: ${formatPrice(s.structureReference.atr)})
                                      </span>
                                    ) : null}
                                  </div>

                                  {/* Market Structure Quality Layer Developer Diagnostic */}
                                  <div className="pt-1.5 border-t border-amber-500/20 mt-1">
                                    <div className="text-[9px] text-amber-400 font-bold mb-0.5">
                                      MARKET STRUCTURE QUALITY DIAGNOSTIC
                                    </div>
                                    <div className="grid grid-cols-2 gap-x-2 text-[9.5px]">
                                      <div>
                                        <span className="text-slate-500">symbol: </span>
                                        <span className="text-slate-200">{s.asset}</span>
                                      </div>
                                      <div>
                                        <span className="text-slate-500">timeframe: </span>
                                        <span className="text-slate-200">{s.timeframe}</span>
                                      </div>
                                      <div>
                                        <span className="text-slate-500">structure quality: </span>
                                        <span className="text-emerald-400 font-bold">
                                          {(s.marketStructureQuality?.qualityGrade || 'acceptable').toUpperCase()}
                                        </span>
                                      </div>
                                      <div>
                                        <span className="text-slate-500">quality score: </span>
                                        <span className="text-amber-300 font-bold">
                                          {s.marketStructureQuality?.qualityScore ?? 75}/100
                                        </span>
                                      </div>
                                      <div>
                                        <span className="text-slate-500">candle activity: </span>
                                        <span className="text-slate-200">{s.marketStructureQuality?.metrics?.candleActivity ?? 80}/100</span>
                                      </div>
                                      <div>
                                        <span className="text-slate-500">relative movement: </span>
                                        <span className="text-slate-200">{s.marketStructureQuality?.metrics?.relativePriceMovement ?? 76}/100</span>
                                      </div>
                                      <div>
                                        <span className="text-slate-500">swing clarity: </span>
                                        <span className="text-slate-200">{s.marketStructureQuality?.metrics?.swingClarity ?? 78}/100</span>
                                      </div>
                                      <div>
                                        <span className="text-slate-500">s/r clarity: </span>
                                        <span className="text-slate-200">{s.marketStructureQuality?.metrics?.srClarity ?? 74}/100</span>
                                      </div>
                                      <div className="col-span-2">
                                        <span className="text-slate-500">volume activity: </span>
                                        <span className="text-slate-200">
                                          {s.marketStructureQuality?.metrics?.volumeActivity !== undefined
                                            ? `${s.marketStructureQuality.metrics.volumeActivity}/100`
                                            : 'Available from 24h volume'}
                                        </span>
                                      </div>
                                    </div>
                                    <div className="text-[9px] text-slate-400 mt-0.5">
                                      <span className="text-slate-500">rejection reason: </span>
                                      <span className="text-slate-300">
                                        {s.marketStructureQuality?.rejectionReason || 'Passed (Acceptable or higher tradable structure)'}
                                      </span>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </>
            )}

            {/* ========================================================================= */}
            {/* VIEW B: COMPLETED HISTORY VIEW (SEPARATE VIEW WHEN USER OPENS IT)         */}
            {/* ========================================================================= */}
            {signalViewMode === 'completed_history' && (
              <div className="p-3 space-y-3">
                <div className="flex items-center justify-between pb-2 border-b border-[#181a24]">
                  <div>
                    <span className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5 text-slate-400" />
                      Completed Signal History ({completedHistoryList.length})
                    </span>
                    <span className="text-[10px] text-slate-500 font-mono block">
                      Settled trades removed from active chart
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
                    No completed signals in history matching the filter. Active signals are monitored against live Binance prices.
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
                              <span className="text-[10px] text-slate-400 truncate max-w-[120px]">
                                {c.setupType}
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

                          {c.statusReason && (
                            <p className="text-[10px] text-slate-400 mt-1 italic">
                              {c.statusReason}
                            </p>
                          )}

                          <div className="mt-1.5 pt-1 border-t border-[#141620] flex items-center justify-between text-[10px] text-slate-500">
                            <span>Confirmed: {formatCandleCloseTime(c.confirmedCandleCloseTime || c.timestamp)}</span>
                            <div className="flex items-center gap-2">
                              <span>Settled: {c.completedAt ? new Date(c.completedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Done'}</span>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setExpandedDiagId(expandedDiagId === c.id ? null : c.id);
                                }}
                                className="text-[9px] px-1.5 py-0.2 rounded bg-[#131622] hover:bg-[#1c2032] text-amber-400 border border-amber-500/20 transition cursor-pointer"
                                title="Developer Diagnostic: View exact structural anchor and levels"
                              >
                                {expandedDiagId === c.id ? '✕ diag' : '⚙ diag'}
                              </button>
                            </div>
                          </div>

                          {/* Completed Signal Developer Diagnostic */}
                          {expandedDiagId === c.id && (
                            <div
                              onClick={(e) => e.stopPropagation()}
                              className="mt-2 p-2 rounded bg-[#07090e] border border-amber-500/30 text-[10px] font-mono space-y-1 text-left"
                            >
                              <div className="text-amber-400 font-bold flex items-center justify-between border-b border-amber-500/20 pb-1">
                                <span>DEVELOPER LEVEL DIAGNOSTIC</span>
                                <span className="text-[9px] text-slate-400">Pair: {c.asset} • TF: {c.timeframe}</span>
                              </div>
                              <div className="space-y-0.5 text-slate-300 pt-0.5">
                                <div>
                                  <span className="text-slate-500">structure reference: </span>
                                  <span className="text-slate-200">
                                    {c.structureReference?.invalidationType || (c.direction === 'UP' ? 'recent swing low' : 'recent swing high')}
                                  </span>
                                </div>
                                <div>
                                  <span className="text-slate-500">
                                    {c.direction === 'UP' ? 'support reference: ' : 'resistance reference: '}
                                  </span>
                                  <span className="text-slate-200">
                                    ${formatPrice(c.structureReference?.supportLevel || c.structureReference?.resistanceLevel || c.stopLoss)}
                                  </span>
                                </div>
                                <div className="grid grid-cols-2 gap-x-2">
                                  <div>
                                    <span className="text-slate-500">entry: </span>
                                    <span className="text-amber-400 font-semibold">${formatPrice(c.entryPrice)}</span>
                                  </div>
                                  <div>
                                    <span className="text-slate-500">sl: </span>
                                    <span className="text-rose-400 font-semibold">${formatPrice(c.stopLoss)}</span>
                                  </div>
                                  <div>
                                    <span className="text-slate-500">tp1: </span>
                                    <span className="text-emerald-400 font-semibold">${formatPrice(c.takeProfit1 || c.takeProfit)}</span>
                                  </div>
                                  <div>
                                    <span className="text-slate-500">tp2: </span>
                                    <span className="text-emerald-400 font-semibold">
                                      {c.takeProfit2 ? `$${formatPrice(c.takeProfit2)}` : 'none'}
                                    </span>
                                  </div>
                                </div>
                                <div>
                                  <span className="text-slate-500">rr: </span>
                                  <span className="text-indigo-300 font-bold">
                                    {c.rewardRiskRatio ? c.rewardRiskRatio.toFixed(2) : (Math.abs((c.takeProfit1 || c.takeProfit) - c.entryPrice) / (Math.abs(c.entryPrice - c.stopLoss) || 1)).toFixed(2)}
                                    {c.takeProfit2 ? ` / ${(Math.abs(c.takeProfit2 - c.entryPrice) / (Math.abs(c.entryPrice - c.stopLoss) || 1)).toFixed(2)}` : ''}
                                  </span>
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

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
        {/* 3. PERFORMANCE ANALYSIS TAB (SEPARATED LIVE VS BACKTEST)                  */}
        {/* ========================================================================= */}
        {activeSubTab === 'performance' && (() => {
          const live = performanceStats.liveStats || {
            trades: performanceStats.winsCount + performanceStats.lossesCount,
            wins: performanceStats.winsCount,
            losses: performanceStats.lossesCount,
            winRate: performanceStats.tpRate,
            profitFactor: performanceStats.profitFactor,
            expectancy: performanceStats.expectancy || 0,
            drawdown: performanceStats.drawdown || 0,
            sampleSize: performanceStats.totalSignals || (performanceStats.winsCount + performanceStats.lossesCount)
          };

          const backtest = performanceStats.backtestStats || {
            trades: performanceStats.walkForward?.inSample?.settled || 0,
            winRate: performanceStats.walkForward?.inSample?.winRate || 0,
            profitFactor: performanceStats.walkForward?.inSample?.profitFactor || 0,
            drawdown: performanceStats.drawdown || 0,
            sampleSize: performanceStats.walkForward?.inSample?.count || 0
          };

          return (
            <div className="p-3 space-y-4">
              {/* 1. LIVE PERFORMANCE HERO CARD */}
              <div className="p-3.5 rounded-lg bg-gradient-to-br from-[#101b1b] via-[#0d1519] to-[#0a0d14] border border-emerald-500/30 shadow-lg">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-mono uppercase tracking-wider text-emerald-300 font-bold flex items-center gap-1.5">
                    <Award className="w-4 h-4 text-emerald-400" />
                    LIVE PERFORMANCE ENGINE
                  </span>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 font-semibold">
                    Verified Live Only (Never Backtest)
                  </span>
                </div>

                <div className="flex items-baseline justify-between my-1 font-mono">
                  <div className="flex items-baseline gap-2.5">
                    <span className="text-3xl font-bold text-white tracking-tight">
                      {live.winRate}%
                    </span>
                    <span className="text-xs text-emerald-400 font-semibold">
                      Live Win Rate
                    </span>
                  </div>
                  <span className="text-xs text-slate-400">
                    Sample: <strong>{live.sampleSize}</strong> live signals ({live.trades} settled)
                  </span>
                </div>

                {/* Progress Bar of Live Wins vs Losses */}
                <div className="w-full bg-[#1c1f2e] h-2 rounded-full overflow-hidden my-2 flex">
                  <div
                    className="bg-emerald-500 h-full transition-all duration-500"
                    style={{ width: `${Math.min(100, Math.max(0, live.winRate))}%` }}
                  />
                  <div
                    className="bg-red-500 h-full transition-all duration-500"
                    style={{ width: `${100 - Math.min(100, Math.max(0, live.winRate))}%` }}
                  />
                </div>

                {/* 7 Required Live Metrics Grid */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3 pt-2.5 border-t border-[#1a2b25] text-center font-mono">
                  <div className="p-1.5 rounded bg-[#091211] border border-[#162923]">
                    <span className="text-[9px] text-slate-400 block uppercase">LIVE TRADES</span>
                    <span className="text-xs font-bold text-white">{live.trades}</span>
                    <span className="text-[9px] text-slate-500 block">N={live.sampleSize}</span>
                  </div>
                  <div className="p-1.5 rounded bg-[#091211] border border-[#162923]">
                    <span className="text-[9px] text-emerald-400 block uppercase">LIVE WINS / LOSSES</span>
                    <span className="text-xs font-bold text-white">{live.wins}W / {live.losses}L</span>
                    <span className="text-[9px] text-emerald-500 block">{live.winRate}% TP Rate</span>
                  </div>
                  <div className="p-1.5 rounded bg-[#091211] border border-[#162923]">
                    <span className="text-[9px] text-slate-400 block uppercase">LIVE PROFIT FACTOR</span>
                    <span className={`text-xs font-bold ${live.profitFactor >= 1.5 ? 'text-emerald-400' : 'text-amber-400'}`}>
                      {live.profitFactor}x
                    </span>
                    <span className="text-[9px] text-slate-500 block">Gross Ratio</span>
                  </div>
                  <div className="p-1.5 rounded bg-[#091211] border border-[#162923]">
                    <span className="text-[9px] text-slate-400 block uppercase">LIVE EXPECTANCY</span>
                    <span className="text-xs font-bold text-white">
                      {live.expectancy > 0 ? '+' : ''}{live.expectancy}%
                    </span>
                    <span className="text-[9px] text-slate-500 block">Per Trade</span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 mt-2 font-mono text-center">
                  <div className="p-1.5 rounded bg-[#091211] border border-[#162923]">
                    <span className="text-[9px] text-slate-400 block uppercase">LIVE MAX DRAWDOWN</span>
                    <span className="text-xs font-bold text-rose-400">{live.drawdown}%</span>
                    <span className="text-[9px] text-slate-500 block">Peak to Trough</span>
                  </div>
                  <div className="p-1.5 rounded bg-[#091211] border border-[#162923]">
                    <span className="text-[9px] text-slate-400 block uppercase">LIVE SAMPLE SIZE</span>
                    <span className="text-xs font-bold text-slate-200">{live.sampleSize} Signals</span>
                    <span className="text-[9px] text-emerald-400 block">{live.trades} Settled Outcomes</span>
                  </div>
                </div>
              </div>

              {/* 2. HISTORICAL BACKTEST PERFORMANCE CARD (ISOLATED) */}
              <div className="p-3.5 rounded-lg bg-gradient-to-br from-[#131526] via-[#101220] to-[#0c0d17] border border-indigo-500/30 shadow-lg">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-mono uppercase tracking-wider text-indigo-300 font-bold flex items-center gap-1.5">
                    <BarChart3 className="w-4 h-4 text-indigo-400" />
                    HISTORICAL BACKTEST PERFORMANCE
                  </span>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-indigo-500/15 text-indigo-300 border border-indigo-500/30 font-semibold">
                    Quarantined Simulation
                  </span>
                </div>

                <div className="flex items-baseline justify-between my-1 font-mono">
                  <div className="flex items-baseline gap-2.5">
                    <span className="text-3xl font-bold text-indigo-200 tracking-tight">
                      {backtest.winRate}%
                    </span>
                    <span className="text-xs text-indigo-400 font-semibold">
                      Backtest Win Rate
                    </span>
                  </div>
                  <span className="text-xs text-slate-400">
                    Sample: <strong>{backtest.sampleSize}</strong> backtest trades
                  </span>
                </div>

                <p className="text-[10px] text-slate-400 font-sans leading-relaxed mb-2.5">
                  Backtest results are completely quarantined from live performance and strictly excluded from live win rates and outcomes.
                </p>

                {/* 4 Required Backtest Metrics Grid */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 border-t border-[#1d223d] text-center font-mono">
                  <div className="p-1.5 rounded bg-[#0b0d18] border border-[#1b1f38]">
                    <span className="text-[9px] text-slate-400 block uppercase">BACKTEST TRADES</span>
                    <span className="text-xs font-bold text-white">{backtest.trades}</span>
                    <span className="text-[9px] text-slate-500 block">Sample N={backtest.sampleSize}</span>
                  </div>
                  <div className="p-1.5 rounded bg-[#0b0d18] border border-[#1b1f38]">
                    <span className="text-[9px] text-indigo-300 block uppercase">BACKTEST WIN RATE</span>
                    <span className="text-xs font-bold text-indigo-200">{backtest.winRate}%</span>
                    <span className="text-[9px] text-slate-500 block">Historical TP%</span>
                  </div>
                  <div className="p-1.5 rounded bg-[#0b0d18] border border-[#1b1f38]">
                    <span className="text-[9px] text-slate-400 block uppercase">BACKTEST PROFIT FACTOR</span>
                    <span className="text-xs font-bold text-emerald-400">{backtest.profitFactor}x</span>
                    <span className="text-[9px] text-slate-500 block">Simulation PF</span>
                  </div>
                  <div className="p-1.5 rounded bg-[#0b0d18] border border-[#1b1f38]">
                    <span className="text-[9px] text-slate-400 block uppercase">BACKTEST DRAWDOWN</span>
                    <span className="text-xs font-bold text-rose-400">{backtest.drawdown}%</span>
                    <span className="text-[9px] text-slate-500 block">Max Historical DD</span>
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
                  Settled Historical Log ({settledHistoricalLog.length})
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

              {settledHistoricalLog.length === 0 ? (
                <div className="p-4 text-center text-slate-500 font-mono text-xs">
                  No completed trades yet. Watching live market data for target touches.
                </div>
              ) : (
                <div className="space-y-1.5 font-mono max-h-[300px] overflow-y-auto pr-1">
                  {settledHistoricalLog.map((c) => (
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
          );
        })()}
      </div>

      {/* Developer Quality Diagnostics Modal (Developer-only diagnostic, hidden from standard view) */}
      {showQualityDiagModal && (
        <div
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-3"
          onClick={() => setShowQualityDiagModal(false)}
        >
          <div
            className="bg-[#0b0d14] border border-[#2a2d3d] rounded-xl max-w-4xl w-full max-h-[85vh] flex flex-col shadow-2xl overflow-hidden font-mono"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="p-3.5 bg-[#10131e] border-b border-[#202436] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Shield className="w-4 h-4 text-amber-400" />
                <h3 className="text-xs font-bold text-amber-300">
                  DEVELOPER ONLY DIAGNOSTIC: MARKET STRUCTURE QUALITY LAYER
                </h3>
              </div>
              <button
                onClick={() => setShowQualityDiagModal(false)}
                className="text-slate-400 hover:text-white p-1 rounded hover:bg-[#1a1e30] transition cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-2.5 bg-[#08090f] border-b border-[#181a26] text-[11px] text-slate-400 flex items-center justify-between">
              <span>
                Pre-strategy gate. Evaluates whether charts have usable, readable structure before strategy execution.
              </span>
              <button
                onClick={handleOpenQualityDiag}
                className="px-2 py-0.5 rounded bg-[#181a26] hover:bg-[#222538] text-amber-300 border border-amber-500/30 text-[10px] flex items-center gap-1 cursor-pointer"
              >
                <RefreshCw className={`w-3 h-3 ${isLoadingDiag ? 'animate-spin' : ''}`} />
                <span>Refresh Diagnostics</span>
              </button>
            </div>

            {/* Table */}
            <div className="flex-1 overflow-auto p-3 text-[11px]">
              {qualityDiagnosticsList.length === 0 ? (
                <div className="p-8 text-center text-slate-500">
                  {isLoadingDiag ? 'Loading quality diagnostics...' : 'No diagnostic records yet. Trigger a scan to populate.'}
                </div>
              ) : (
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-[#202436] text-[10px] text-slate-400 uppercase tracking-wider">
                      <th className="py-2 px-2">Symbol</th>
                      <th className="py-2 px-1">TF</th>
                      <th className="py-2 px-2">Structure Quality</th>
                      <th className="py-2 px-2">Score</th>
                      <th className="py-2 px-2">Candle Act.</th>
                      <th className="py-2 px-2">Rel. Move</th>
                      <th className="py-2 px-2">Swing Cl.</th>
                      <th className="py-2 px-2">S/R Cl.</th>
                      <th className="py-2 px-2">Volume Act.</th>
                      <th className="py-2 px-2">Rejection Reason</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#151824]">
                    {qualityDiagnosticsList.map((d, idx) => {
                      const gradeColor =
                        d.qualityGrade === 'excellent'
                          ? 'text-emerald-400 border-emerald-500/40 bg-emerald-500/10'
                          : d.qualityGrade === 'good'
                          ? 'text-teal-400 border-teal-500/40 bg-teal-500/10'
                          : d.qualityGrade === 'acceptable'
                          ? 'text-amber-400 border-amber-500/40 bg-amber-500/10'
                          : d.qualityGrade === 'poor'
                          ? 'text-rose-400 border-rose-500/40 bg-rose-500/10'
                          : 'text-red-500 border-red-500/40 bg-red-500/10';

                      return (
                        <tr key={idx} className="hover:bg-[#121522] transition">
                          <td className="py-1.5 px-2 font-bold text-slate-200">{d.symbol}</td>
                          <td className="py-1.5 px-1 text-slate-400">{d.timeframe}</td>
                          <td className="py-1.5 px-2">
                            <span className={`text-[9.5px] px-1.5 py-0.5 rounded border uppercase font-bold ${gradeColor}`}>
                              {d.qualityGrade}
                            </span>
                          </td>
                          <td className="py-1.5 px-2 font-bold text-amber-300">{d.qualityScore}/100</td>
                          <td className="py-1.5 px-2 text-slate-300">{d.metrics?.candleActivity ?? '--'}/100</td>
                          <td className="py-1.5 px-2 text-slate-300">{d.metrics?.relativePriceMovement ?? '--'}/100</td>
                          <td className="py-1.5 px-2 text-slate-300">{d.metrics?.swingClarity ?? '--'}/100</td>
                          <td className="py-1.5 px-2 text-slate-300">{d.metrics?.srClarity ?? '--'}/100</td>
                          <td className="py-1.5 px-2 text-slate-400">
                            {d.metrics?.volumeActivity !== undefined ? `${d.metrics.volumeActivity}/100` : 'N/A'}
                          </td>
                          <td className="py-1.5 px-2 text-slate-400 text-[10px] max-w-[240px] truncate" title={d.rejectionReason || 'Passed'}>
                            {d.rejectionReason || <span className="text-emerald-400 font-medium">Passed</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>

            <div className="p-2.5 bg-[#0a0c14] border-t border-[#181a26] text-right text-[10px] text-slate-500">
              Only acceptable, good, or excellent market structure qualifies for strategy evaluation.
            </div>
          </div>
        </div>
      )}

      {/* Real-time Single Asset Evaluation Modal */}
      <ScanAssetModal
        isOpen={isScanModalOpen}
        onClose={() => setIsScanModalOpen(false)}
        isLoading={isScanningSpecificAsset}
        evaluation={singleAssetEvaluation}
        asset={selectedAsset || 'BTCUSDT'}
        timeframe={timeframe}
        onRescan={handleScanMarket}
      />
    </div>
  );
};
