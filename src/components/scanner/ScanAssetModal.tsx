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
  ArrowRight,
  BarChart2
} from 'lucide-react';
import { formatPrice } from '../WatchlistTable.tsx';
import { ScannerSignalItem, Timeframe } from '../../types.ts';

export interface SingleAssetEvaluation {
  asset: string;
  timeframe: string;
  hasSetup?: boolean;
  action?: 'BUY' | 'SELL' | 'NO SETUP';
  message?: string;
  signal?: ScannerSignalItem | null;
  tradeLevels?: {
    entryPrice: number;
    stopLoss: number;
    takeProfit1: number;
    takeProfit2?: number;
    rewardRiskRatio: number;
  } | null;
}

interface ScanAssetModalProps {
  isOpen: boolean;
  onClose: () => void;
  isLoading: boolean;
  evaluation: SingleAssetEvaluation | null;
  signal?: ScannerSignalItem | null;
  asset: string;
  timeframe: string;
  onRescan: () => void;
  onSeeChart?: (asset: string, timeframe: string, signal?: ScannerSignalItem | null) => void;
}

export const ScanAssetModal: React.FC<ScanAssetModalProps> = ({
  isOpen,
  onClose,
  isLoading,
  evaluation,
  signal,
  asset,
  timeframe,
  onRescan,
  onSeeChart
}) => {
  if (!isOpen) return null;

  const action = evaluation?.action || 'NO SETUP';
  const cleanAsset = (asset || 'BTCUSDT').toUpperCase();
  const hasValidSetup = Boolean(
    (evaluation?.hasSetup || action === 'BUY' || action === 'SELL') &&
    evaluation?.tradeLevels
  );

  const handleSeeChart = () => {
    const targetAsset = evaluation?.asset || cleanAsset;
    const targetTimeframe = evaluation?.timeframe || timeframe;

    let signalItem: ScannerSignalItem | null = signal ? { ...signal } : null;
    if (!signalItem && evaluation?.tradeLevels) {
      const entryPrice = evaluation.tradeLevels.entryPrice;
      const stopLoss = evaluation.tradeLevels.stopLoss;
      const tp1 = evaluation.tradeLevels.takeProfit1;
      const tp2 = evaluation.tradeLevels.takeProfit2;
      const dir = (action === 'BUY' ? 'UP' : action === 'SELL' ? 'DOWN' : 'UP');
      const closeTime = Date.now();
      const setupType = dir === 'UP' ? 'Long Setup' : 'Short Setup';
      const id = `${targetAsset}-${targetTimeframe}-${dir.toLowerCase()}-${closeTime}`;

      signalItem = {
        id,
        asset: targetAsset,
        timeframe: targetTimeframe as Timeframe,
        direction: dir,
        setupType,
        signalPrice: entryPrice,
        entryPrice,
        takeProfit: tp1,
        takeProfit1: tp1,
        takeProfit2: tp2,
        stopLoss,
        invalidationLevel: stopLoss,
        confidence: 0,
        reason: '',
        timestamp: closeTime,
        confirmedCandleCloseTime: closeTime,
        rewardRiskRatio: evaluation.tradeLevels.rewardRiskRatio,
        riskDistance: Math.abs(entryPrice - stopLoss),
        targetDistance: Math.abs(tp1 - entryPrice),
        status: 'ACTIVE',
        expiryCandles: 20,
        expiryTimestamp: Date.now() + 20 * 15 * 60 * 1000
      };
    } else if (signalItem && evaluation?.tradeLevels) {
      signalItem.entryPrice = evaluation.tradeLevels.entryPrice || signalItem.entryPrice;
      signalItem.stopLoss = evaluation.tradeLevels.stopLoss || signalItem.stopLoss;
      signalItem.takeProfit1 = evaluation.tradeLevels.takeProfit1 || signalItem.takeProfit1;
      signalItem.takeProfit = signalItem.takeProfit1 || signalItem.takeProfit;
      if (evaluation.tradeLevels.takeProfit2) {
        signalItem.takeProfit2 = evaluation.tradeLevels.takeProfit2;
      }
      if (evaluation.tradeLevels.rewardRiskRatio) {
        signalItem.rewardRiskRatio = evaluation.tradeLevels.rewardRiskRatio;
      }
    }

    if (signalItem) {
      if (!signalItem.takeProfit1 && signalItem.takeProfit) {
        signalItem.takeProfit1 = signalItem.takeProfit;
      }
      if (!signalItem.takeProfit && signalItem.takeProfit1) {
        signalItem.takeProfit = signalItem.takeProfit1;
      }
    }

    onSeeChart?.(targetAsset, targetTimeframe, signalItem);
    onClose();
  };

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
              </div>
              <p className="text-[11px] text-slate-400 font-mono">
                Market Scanner
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleSeeChart}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-amber-500 hover:bg-amber-400 active:scale-95 text-black text-xs font-mono font-bold transition cursor-pointer shadow-sm"
              title="View this asset and its TP/SL levels on the interactive candlestick chart"
            >
              <BarChart2 className="w-3.5 h-3.5" />
              <span>See Chart</span>
            </button>
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
                Evaluating real-time market data...
              </p>
            </div>
          ) : evaluation && hasValidSetup && evaluation.tradeLevels ? (
            <div className="space-y-4">
              {/* Confirmed Trade Signal Details */}
              <div
                className={`p-4 rounded-xl border flex flex-col gap-3 ${
                  evaluation.action === 'BUY' || evaluation.signal?.direction === 'UP'
                    ? 'bg-emerald-950/20 border-emerald-500/40 shadow-lg shadow-emerald-950/20'
                    : 'bg-rose-950/20 border-rose-500/40 shadow-lg shadow-rose-950/20'
                }`}
              >
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-base font-bold text-white font-mono">{cleanAsset}</span>
                    <span className="px-2 py-0.5 rounded text-[11px] font-mono font-bold bg-[#141724] text-amber-400 border border-amber-500/30">
                      {timeframe}
                    </span>
                  </div>

                  {(evaluation.action === 'BUY' || evaluation.signal?.direction === 'UP') && (
                    <span className="flex items-center gap-1.5 px-3 py-1 rounded bg-emerald-500 text-black font-black text-sm tracking-wide">
                      <TrendingUp className="w-4 h-4" />
                      <span>BUY</span>
                    </span>
                  )}
                  {(evaluation.action === 'SELL' || evaluation.signal?.direction === 'DOWN') && (
                    <span className="flex items-center gap-1.5 px-3 py-1 rounded bg-rose-500 text-white font-black text-sm tracking-wide">
                      <TrendingDown className="w-4 h-4" />
                      <span>SELL</span>
                    </span>
                  )}
                </div>

                {/* Final Trade Levels */}
                <div className="p-3 rounded-lg bg-[#0a0c12] border border-[#1e2130] grid grid-cols-2 sm:grid-cols-4 gap-3 text-center font-mono">
                  <div className="p-2 rounded bg-[#10121a]">
                    <div className="text-[10px] text-slate-500 uppercase">Entry Price</div>
                    <div className="text-sm font-bold text-white mt-0.5">
                      ${formatPrice(evaluation.tradeLevels.entryPrice)}
                    </div>
                  </div>
                  <div className="p-2 rounded bg-[#10121a]">
                    <div className="text-[10px] text-emerald-400 uppercase font-semibold">Take Profit #1</div>
                    <div className="text-sm font-bold text-emerald-400 mt-0.5">
                      ${formatPrice(evaluation.tradeLevels.takeProfit1)}
                    </div>
                  </div>
                  {evaluation.tradeLevels.takeProfit2 ? (
                    <div className="p-2 rounded bg-[#10121a]">
                      <div className="text-[10px] text-emerald-400 uppercase font-semibold">Take Profit #2</div>
                      <div className="text-sm font-bold text-emerald-400 mt-0.5">
                        ${formatPrice(evaluation.tradeLevels.takeProfit2)}
                      </div>
                    </div>
                  ) : null}
                  <div className="p-2 rounded bg-[#10121a]">
                    <div className="text-[10px] text-rose-400 uppercase font-semibold">Stop Loss</div>
                    <div className="text-sm font-bold text-rose-400 mt-0.5">
                      ${formatPrice(evaluation.tradeLevels.stopLoss)}
                    </div>
                  </div>
                  <div className="p-2 rounded bg-[#10121a] col-span-2 sm:col-span-4 flex items-center justify-between px-4">
                    <span className="text-[11px] text-slate-400 uppercase">Risk to Reward:</span>
                    <span className="text-sm font-black text-amber-400">
                      1:{evaluation.tradeLevels.rewardRiskRatio.toFixed(2)}
                    </span>
                  </div>
                </div>

                <div className="flex justify-end pt-1">
                  <button
                    onClick={handleSeeChart}
                    className="px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 active:scale-95 text-black font-bold text-xs flex items-center gap-1.5 shadow-md transition cursor-pointer"
                  >
                    <BarChart2 className="w-4 h-4" />
                    <span>View Levels on Chart</span>
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="py-14 px-6 flex flex-col items-center justify-center gap-3 text-center">
              <div className="w-12 h-12 rounded-full bg-[#141724] border border-[#23273c] flex items-center justify-center text-slate-400">
                <ShieldAlert className="w-6 h-6 text-slate-400" />
              </div>
              <div className="font-mono font-bold text-sm sm:text-base text-slate-200 lowercase tracking-wide">
                no valid setup found
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-4 py-2.5 border-t border-[#1b1e2e] bg-[#0c0d13] flex items-center justify-between text-[11px] font-mono shrink-0">
          <span className="text-slate-500 hidden sm:inline">
            Educational market analysis. Never financial advice.
          </span>
          <div className="flex items-center gap-2 ml-auto">
            <button
              onClick={handleSeeChart}
              className="px-3 py-1 rounded bg-amber-500 hover:bg-amber-400 active:scale-95 text-black text-xs font-mono font-bold transition cursor-pointer shadow-sm flex items-center gap-1.5"
            >
              <BarChart2 className="w-3.5 h-3.5" />
              <span>See Chart</span>
            </button>
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
