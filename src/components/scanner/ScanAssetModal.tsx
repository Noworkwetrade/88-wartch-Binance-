import React from 'react';
import {
  X,
  Search,
  Sparkles,
  TrendingUp,
  TrendingDown,
  ShieldAlert,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Layers,
  Activity,
  Target,
  ArrowRight
} from 'lucide-react';
import { formatPrice } from '../WatchlistTable.tsx';

export interface SingleAssetEvaluation {
  asset: string;
  timeframe: string;
  currentPrice: number;
  marketStructure: {
    regime: string;
    qualityGrade: string;
    qualityScore: number;
    isTradable: boolean;
    swingHigh?: number;
    swingLow?: number;
    support?: number;
    resistance?: number;
    summary: string;
  };
  formingSetup: {
    detected: boolean;
    type: string;
    description: string;
    ruleNote: string;
    status: string;
  };
  confirmedSetup: {
    isConfirmed: boolean;
    setupType: string;
    direction: 'UP' | 'DOWN' | null;
    confirmedAtCloseTime?: number;
  };
  strongestStrategy: {
    name: string;
    confidence: number;
    status: string;
  };
  action: 'BUY' | 'SELL' | 'NO SETUP';
  actionLabel: string;
  exactReason: string;
  rejectionOrAcceptanceStatus: string;
  tradeLevels?: {
    entryPrice: number;
    stopLoss: number;
    takeProfit1: number;
    takeProfit2?: number;
    rewardRiskRatio: number;
  } | null;
  htfConfirmation?: {
    enabled?: boolean;
    ruleMode?: 'lenient' | 'aligned' | 'strict';
    htfTimeframe?: string;
    htfRegime?: string;
    htfTrendDirection?: 'bullish' | 'bearish' | 'neutral';
    status: 'confirmed' | 'rejected' | 'neutral';
    reason: string;
    metrics?: {
      higherTfRegime?: string;
      higherTfTrend?: string;
      entryTimeframe: string;
    };
  } | null;
}

interface ScanAssetModalProps {
  isOpen: boolean;
  onClose: () => void;
  isLoading: boolean;
  evaluation: SingleAssetEvaluation | null;
  asset: string;
  timeframe: string;
  onRescan: () => void;
}

export const ScanAssetModal: React.FC<ScanAssetModalProps> = ({
  isOpen,
  onClose,
  isLoading,
  evaluation,
  asset,
  timeframe,
  onRescan
}) => {
  if (!isOpen) return null;

  const isConfirmed = evaluation?.confirmedSetup?.isConfirmed ?? false;
  const action = evaluation?.action || 'NO SETUP';
  const cleanAsset = (asset || 'BTCUSDT').toUpperCase();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150">
      <div
        className="bg-[#0b0c13] border border-[#23273c] rounded-xl w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden font-sans text-slate-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#1b1e2e] bg-[#0f111a] shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-400">
              <Search className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-mono font-bold text-sm text-white">{cleanAsset}</span>
                <span className="px-1.5 py-0.2 rounded text-[10px] font-mono font-semibold bg-[#1a1d2d] text-amber-400 border border-[#292e48]">
                  {timeframe}
                </span>
                <span className="text-xs font-mono text-slate-400">
                  ${evaluation?.currentPrice ? formatPrice(evaluation.currentPrice) : '...'}
                </span>
              </div>
              <p className="text-[11px] text-slate-400 font-mono">
                Live Binance Market Data • Real-Time Strategy Evaluation
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={onRescan}
              disabled={isLoading}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-[#171a29] hover:bg-[#20243a] text-slate-300 hover:text-white border border-[#2a2f47] text-xs font-mono font-semibold transition cursor-pointer disabled:opacity-50"
              title="Perform fresh real-time scan"
            >
              <Sparkles className={`w-3.5 h-3.5 text-amber-400 ${isLoading ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">{isLoading ? 'Scanning...' : 'Scan Again'}</span>
            </button>
            <button
              onClick={onClose}
              className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-800/60 transition cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3.5 font-mono text-xs">
          {isLoading ? (
            <div className="py-16 flex flex-col items-center justify-center gap-3 text-center">
              <div className="relative">
                <div className="w-10 h-10 border-2 border-amber-500/20 border-t-amber-500 rounded-full animate-spin" />
                <Sparkles className="w-4 h-4 text-amber-400 absolute inset-0 m-auto" />
              </div>
              <div className="font-bold text-sm text-white">Scanning {cleanAsset} in Real-Time</div>
              <p className="text-xs text-slate-400 max-w-sm">
                Fetching live closed Binance candlesticks, running market structure quality layers, and evaluating all integrated strategies...
              </p>
            </div>
          ) : evaluation ? (
            <>
              {/* Top Banner: Action & Status */}
              <div
                className={`p-3.5 rounded-lg border flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                  action === 'BUY'
                    ? 'bg-emerald-950/30 border-emerald-500/40'
                    : action === 'SELL'
                    ? 'bg-rose-950/30 border-rose-500/40'
                    : 'bg-[#12141e] border-[#222536]'
                }`}
              >
                <div>
                  <div className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">
                    Scan Decision & Signal Action
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    {action === 'BUY' && (
                      <span className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-emerald-500 text-black font-black text-sm tracking-wide">
                        <TrendingUp className="w-4 h-4" />
                        <span>BUY</span>
                        <span className="text-[10px] bg-black/20 px-1 rounded font-bold">CONFIRMED</span>
                      </span>
                    )}
                    {action === 'SELL' && (
                      <span className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-rose-500 text-white font-black text-sm tracking-wide">
                        <TrendingDown className="w-4 h-4" />
                        <span>SELL</span>
                        <span className="text-[10px] bg-black/30 px-1 rounded font-bold">CONFIRMED</span>
                      </span>
                    )}
                    {action === 'NO SETUP' && (
                      <span className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-[#1c202e] text-slate-300 font-bold text-sm border border-[#2d3249]">
                        <ShieldAlert className="w-4 h-4 text-slate-400" />
                        <span>NO VALID SETUP FOUND</span>
                      </span>
                    )}
                    <span className="text-[11px] text-slate-400 hidden sm:inline">
                      {isConfirmed ? 'All strategy rules satisfied on closed candle' : 'No trade signal generated'}
                    </span>
                  </div>
                </div>

                {/* Trade Levels if confirmed */}
                {evaluation.tradeLevels && (
                  <div className="flex items-center gap-2 sm:gap-3 bg-[#0d0e16]/80 p-2 rounded border border-[#202336] text-[11px]">
                    <div>
                      <div className="text-[9px] text-slate-500 uppercase">Entry</div>
                      <div className="font-bold text-white">${formatPrice(evaluation.tradeLevels.entryPrice)}</div>
                    </div>
                    <div>
                      <div className="text-[9px] text-rose-400 uppercase">Stop Loss</div>
                      <div className="font-bold text-rose-400">${formatPrice(evaluation.tradeLevels.stopLoss)}</div>
                    </div>
                    <div>
                      <div className="text-[9px] text-emerald-400 uppercase">Take Profit 1</div>
                      <div className="font-bold text-emerald-400">${formatPrice(evaluation.tradeLevels.takeProfit1)}</div>
                    </div>
                    {evaluation.tradeLevels.takeProfit2 && (
                      <div>
                        <div className="text-[9px] text-emerald-400 uppercase">TP 2</div>
                        <div className="font-bold text-emerald-400">${formatPrice(evaluation.tradeLevels.takeProfit2)}</div>
                      </div>
                    )}
                    <div>
                      <div className="text-[9px] text-amber-400 uppercase">R:R</div>
                      <div className="font-bold text-amber-400">1:{evaluation.tradeLevels.rewardRiskRatio.toFixed(2)}</div>
                    </div>
                  </div>
                )}
              </div>

              {/* 1. Current Market Structure */}
              <div className="p-3 rounded-lg bg-[#0e1018] border border-[#1e2133] space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-slate-300 font-bold">
                    <Layers className="w-3.5 h-3.5 text-amber-400" />
                    <span>1. Current Market Structure</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span
                      className={`px-1.5 py-0.2 rounded text-[10px] font-bold ${
                        evaluation.marketStructure.qualityGrade === 'EXCELLENT'
                          ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                          : evaluation.marketStructure.qualityGrade === 'GOOD'
                          ? 'bg-teal-500/20 text-teal-300 border border-teal-500/40'
                          : evaluation.marketStructure.qualityGrade === 'ACCEPTABLE'
                          ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                          : 'bg-rose-500/20 text-rose-400 border border-rose-500/40'
                      }`}
                    >
                      {evaluation.marketStructure.qualityGrade} ({evaluation.marketStructure.qualityScore}/100)
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] pt-1">
                  <div className="p-1.5 rounded bg-[#131522] border border-[#1f2235]">
                    <div className="text-[9.5px] text-slate-500 uppercase">Market Regime</div>
                    <div className="font-bold text-slate-200 truncate">{evaluation.marketStructure.regime}</div>
                  </div>
                  <div className="p-1.5 rounded bg-[#131522] border border-[#1f2235]">
                    <div className="text-[9.5px] text-slate-500 uppercase">Swing High</div>
                    <div className="font-bold text-slate-200">
                      {evaluation.marketStructure.swingHigh ? `$${formatPrice(evaluation.marketStructure.swingHigh)}` : 'N/A'}
                    </div>
                  </div>
                  <div className="p-1.5 rounded bg-[#131522] border border-[#1f2235]">
                    <div className="text-[9.5px] text-slate-500 uppercase">Swing Low</div>
                    <div className="font-bold text-slate-200">
                      {evaluation.marketStructure.swingLow ? `$${formatPrice(evaluation.marketStructure.swingLow)}` : 'N/A'}
                    </div>
                  </div>
                  <div className="p-1.5 rounded bg-[#131522] border border-[#1f2235]">
                    <div className="text-[9.5px] text-slate-500 uppercase">Quality Filter</div>
                    <div
                      className={`font-bold ${
                        evaluation.marketStructure.isTradable ? 'text-emerald-400' : 'text-rose-400'
                      }`}
                    >
                      {evaluation.marketStructure.isTradable ? 'Passed (Tradable)' : 'Rejected (Untradable)'}
                    </div>
                  </div>
                </div>
                <div className="text-[11px] text-slate-400 bg-[#121420] p-2 rounded border border-[#1c1f2e]">
                  {evaluation.marketStructure.summary}
                </div>
              </div>

              {/* 2. Currently Forming Setup */}
              <div className="p-3 rounded-lg bg-[#0e1018] border border-[#1e2133] space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-slate-300 font-bold">
                    <Activity className="w-3.5 h-3.5 text-amber-400" />
                    <span>2. Currently Forming Setup (In-Progress Candle)</span>
                  </div>
                  <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-amber-500/10 text-amber-300 border border-amber-500/30 flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    <span>{evaluation.formingSetup.status}</span>
                  </span>
                </div>

                <div className="text-[11px] text-slate-300 bg-[#131522] p-2 rounded border border-[#1f2235] space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-slate-500 uppercase text-[9.5px]">Open Bar Observation:</span>
                    <span className="font-semibold text-slate-200">{evaluation.formingSetup.type}</span>
                  </div>
                  <p className="text-slate-400">{evaluation.formingSetup.description}</p>
                </div>

                {/* Important Strict Rule Callout */}
                <div className="p-2 rounded bg-amber-950/25 border border-amber-500/30 flex items-start gap-2 text-[10.5px] text-amber-200/90">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-bold text-amber-300">STRICT PROTOCOL: </span>
                    <span>{evaluation.formingSetup.ruleNote}</span>
                  </div>
                </div>
              </div>

              {/* 3. Confirmed Setup */}
              <div className="p-3 rounded-lg bg-[#0e1018] border border-[#1e2133] space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-slate-300 font-bold">
                    <CheckCircle2
                      className={`w-3.5 h-3.5 ${isConfirmed ? 'text-emerald-400' : 'text-slate-500'}`}
                    />
                    <span>3. Confirmed Setup (Closed Candle Only)</span>
                  </div>
                  <span
                    className={`px-1.5 py-0.2 rounded text-[10px] font-bold ${
                      isConfirmed
                        ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                        : 'bg-slate-800 text-slate-400 border border-slate-700'
                    }`}
                  >
                    {isConfirmed ? 'CONFIRMED' : 'NO CONFIRMED SETUP'}
                  </span>
                </div>

                <div className="p-2 rounded bg-[#131522] border border-[#1f2235] flex items-center justify-between text-[11px]">
                  <div>
                    <span className="text-slate-500 text-[9.5px] uppercase block">Setup Type</span>
                    <span className="font-bold text-white">{evaluation.confirmedSetup.setupType}</span>
                  </div>
                  {evaluation.confirmedSetup.direction && (
                    <div className="text-right">
                      <span className="text-slate-500 text-[9.5px] uppercase block">Confirmed Direction</span>
                      <span
                        className={`font-black ${
                          evaluation.confirmedSetup.direction === 'UP' ? 'text-emerald-400' : 'text-rose-400'
                        }`}
                      >
                        {evaluation.confirmedSetup.direction}
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {/* 4. Strongest Existing Strategy */}
              <div className="p-3 rounded-lg bg-[#0e1018] border border-[#1e2133] space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-slate-300 font-bold">
                    <Target className="w-3.5 h-3.5 text-amber-400" />
                    <span>4. Strongest Existing Strategy</span>
                  </div>
                  <span
                    className={`px-1.5 py-0.2 rounded text-[10px] font-bold ${
                      evaluation.strongestStrategy.confidence > 0
                        ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                        : 'bg-slate-800 text-slate-400 border border-slate-700'
                    }`}
                  >
                    {evaluation.strongestStrategy.status}
                  </span>
                </div>

                <div className="p-2 rounded bg-[#131522] border border-[#1f2235] flex items-center justify-between text-[11px]">
                  <div>
                    <span className="text-slate-500 text-[9.5px] uppercase block">Strategy</span>
                    <span className="font-bold text-white">{evaluation.strongestStrategy.name}</span>
                  </div>
                  {evaluation.strongestStrategy.confidence > 0 && (
                    <div className="text-right">
                      <span className="text-slate-500 text-[9.5px] uppercase block">Confidence Level</span>
                      <span className="font-black text-amber-400">{evaluation.strongestStrategy.confidence}%</span>
                    </div>
                  )}
                </div>
              </div>

              {/* 5. Exact Reason Setup Accepted or Rejected */}
              <div className="p-3 rounded-lg bg-[#0e1018] border border-[#1e2133] space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-slate-300 font-bold">
                    <ShieldAlert
                      className={`w-3.5 h-3.5 ${isConfirmed ? 'text-emerald-400' : 'text-amber-400'}`}
                    />
                    <span>5. Exact Reason (Accepted or Rejected)</span>
                  </div>
                  <span
                    className={`px-1.5 py-0.2 rounded text-[10px] font-bold ${
                      isConfirmed
                        ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                        : 'bg-rose-500/20 text-rose-400 border border-rose-500/40'
                    }`}
                  >
                    {evaluation.rejectionOrAcceptanceStatus}
                  </span>
                </div>

                <div className="p-2.5 rounded bg-[#131522] border border-[#1f2235] text-[11px] leading-relaxed text-slate-300">
                  {evaluation.exactReason}
                </div>
              </div>

              {/* 6. Higher Timeframe (HTF) Multi-Timeframe Context */}
              <div className="p-3 rounded-lg bg-[#0e1018] border border-[#1e2133] space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-slate-300 font-bold">
                    <Layers className="w-3.5 h-3.5 text-sky-400" />
                    <span>6. Multi-Timeframe Confluence (HTF)</span>
                  </div>
                  {evaluation.htfConfirmation ? (
                    <span
                      className={`px-1.5 py-0.2 rounded text-[10px] font-bold ${
                        evaluation.htfConfirmation.status === 'confirmed'
                          ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                          : 'bg-rose-500/20 text-rose-400 border border-rose-500/40'
                      }`}
                    >
                      {evaluation.htfConfirmation.status === 'confirmed'
                        ? `CONFIRMED BY ${evaluation.htfConfirmation.htfTimeframe || 'HTF'}`
                        : `BLOCKED BY ${evaluation.htfConfirmation.htfTimeframe || 'HTF'}`}
                    </span>
                  ) : (
                    <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-slate-800 text-slate-400 border border-slate-700">
                      HTF DISABLED (ENTRY TF ONLY)
                    </span>
                  )}
                </div>

                <div className="p-2.5 rounded bg-[#131522] border border-[#1f2235] text-[11px] space-y-1.5 font-mono">
                  {evaluation.htfConfirmation ? (
                    <>
                      <div className="flex items-center justify-between text-slate-300">
                        <span className="text-slate-500">Higher Timeframe:</span>
                        <span className="text-white font-bold">{evaluation.htfConfirmation.htfTimeframe || 'Auto'}</span>
                      </div>
                      <div className="flex items-center justify-between text-slate-300">
                        <span className="text-slate-500">HTF Market Regime:</span>
                        <span className="text-amber-400 font-bold capitalize">{evaluation.htfConfirmation.htfRegime || 'ranging'}</span>
                      </div>
                      <div className="flex items-center justify-between text-slate-300">
                        <span className="text-slate-500">HTF Trend Direction:</span>
                        <span className={`font-bold uppercase ${evaluation.htfConfirmation.htfTrendDirection === 'bullish' ? 'text-emerald-400' : evaluation.htfConfirmation.htfTrendDirection === 'bearish' ? 'text-rose-400' : 'text-slate-400'}`}>
                          {evaluation.htfConfirmation.htfTrendDirection || 'neutral'}
                        </span>
                      </div>
                      <div className="mt-1 pt-1.5 border-t border-[#1f2235] text-slate-300 text-[10.5px]">
                        {evaluation.htfConfirmation.reason}
                      </div>
                    </>
                  ) : (
                    <div className="text-slate-400 text-[10.5px]">
                      Higher Timeframe confirmation is currently disabled in scanner settings. Entry setup is evaluated strictly on the confirmed {evaluation.timeframe} candlestick chart.
                    </div>
                  )}
                </div>
              </div>
            </>
          ) : (
            <div className="py-12 text-center text-slate-500">
              No evaluation data available. Click "Scan Again" to run a scan.
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-4 py-2.5 border-t border-[#1b1e2e] bg-[#0c0d13] flex items-center justify-between text-[11px] font-mono shrink-0">
          <span className="text-slate-500 hidden sm:inline">
            Educational market structure analysis. Never financial advice.
          </span>
          <div className="flex items-center gap-2 ml-auto">
            <button
              onClick={onClose}
              className="px-3 py-1 rounded bg-[#161826] hover:bg-[#202336] text-slate-300 hover:text-white border border-[#262a40] text-xs font-mono font-medium transition cursor-pointer"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ScanAssetModal;
