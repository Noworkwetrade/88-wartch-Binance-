/**
 * NWWT Market Structure & Confluence Scanner Component
 *
 * Reads real market conditions from connected chart data:
 * - Market Structure (HH, HL, LH, LL)
 * - Trend Condition
 * - Key Support & Resistance zones
 * - Structure Breaks (BOS) & Change of Character (CHoCH)
 * - Breakout and Break-and-Retest validation
 * - Price-Volume relationship
 * - Candlestick patterns
 *
 * Output: UP | DOWN | NO SETUP (Educational market viewing only)
 */

import React, { useState, useMemo } from 'react';
import {
  Activity,
  ChevronDown,
  ChevronUp,
  Layers,
  Sparkles,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  RefreshCw,
  Info,
  CheckCircle2,
  XCircle,
  HelpCircle,
  Volume2,
  Crosshair
} from 'lucide-react';
import { ChartScannerProps, ScannerAnalysisResult } from './types.ts';
import { useScannerReader } from './useScannerReader.ts';
import { runChartScan } from './scannerEngine.ts';
import { formatPrice } from '../WatchlistTable.tsx';

export const ChartScanner: React.FC<ChartScannerProps> = (props) => {
  const [isExpanded, setIsExpanded] = useState<boolean>(true);
  const [manualScanTrigger, setManualScanTrigger] = useState<number>(0);

  const targetAsset = props.asset || props.symbol || '';
  const scannerData = useScannerReader({
    asset: targetAsset,
    timeframe: props.timeframe,
    candles: props.candles,
    volume: props.volume,
    marketStructure: props.marketStructure,
    currentPrice: props.currentPrice,
    ticker: props.ticker
  });

  const scanResult: ScannerAnalysisResult = useMemo(() => {
    return runChartScan(
      scannerData.asset,
      scannerData.timeframe,
      scannerData.candles,
      scannerData.volume,
      scannerData.marketStructure,
      scannerData.currentPrice
    );
  }, [
    scannerData.asset,
    scannerData.timeframe,
    scannerData.candles,
    scannerData.volume,
    scannerData.marketStructure,
    scannerData.currentPrice,
    manualScanTrigger
  ]);

  const decision = scanResult.decision;
  const isUp = decision.signal === 'UP';
  const isDown = decision.signal === 'DOWN';
  const isNoSetup = decision.signal === 'NO SETUP';

  const signalBadgeColor = isUp
    ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/40'
    : isDown
    ? 'bg-red-500/15 text-red-400 border-red-500/40'
    : 'bg-[#181a20] text-slate-400 border-slate-700/60';

  const qualityBadgeColor =
    decision.setupQuality === 'HIGH'
      ? 'bg-amber-500/15 text-amber-400 border-amber-500/30'
      : decision.setupQuality === 'MODERATE'
      ? 'bg-blue-500/15 text-blue-300 border-blue-500/30'
      : decision.setupQuality === 'LOW'
      ? 'bg-slate-800 text-slate-400 border-slate-700'
      : 'bg-slate-900 text-slate-500 border-slate-800';

  return (
    <div className="border-t border-[#1e2029] bg-[#0c0d12] text-slate-200 transition-all select-none">
      {/* Header Bar */}
      <div
        onClick={() => setIsExpanded((prev) => !prev)}
        className="px-3.5 py-2.5 flex items-center justify-between cursor-pointer hover:bg-[#12141c] transition-colors"
      >
        <div className="flex items-center gap-2.5">
          <div className="w-5 h-5 rounded bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400">
            <span className="text-[10px] font-black tracking-tight">NW</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="font-bold text-xs tracking-wider text-white">NWWT STRUCTURE SCANNER</span>
            <span className="text-[10px] text-slate-500 font-mono hidden sm:inline">
              {scannerData.asset} • {scannerData.timeframe}
            </span>
          </div>

          {/* Quick Signal Display */}
          <div className="flex items-center gap-2 ml-2 pl-2 border-l border-[#1e2029] text-xs">
            <span
              className={`px-2 py-0.5 rounded text-[11px] font-mono font-bold border flex items-center gap-1 ${signalBadgeColor}`}
            >
              {isUp && <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />}
              {isDown && <TrendingDown className="w-3.5 h-3.5 text-red-400" />}
              {isNoSetup && <HelpCircle className="w-3.5 h-3.5 text-slate-400" />}
              {decision.signal}
            </span>

            <span
              className={`px-1.5 py-0.5 rounded text-[10px] font-mono uppercase font-semibold border hidden md:inline ${qualityBadgeColor}`}
            >
              {decision.setupQuality} QUALITY
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs">
          <button
            onClick={(e) => {
              e.stopPropagation();
              setManualScanTrigger((prev) => prev + 1);
            }}
            className="flex items-center gap-1 px-2.5 py-1 rounded bg-[#161822] hover:bg-[#202330] border border-[#2a2e3d] text-slate-300 hover:text-white transition-colors text-[11px]"
            title="Scan active chart candles now"
          >
            <RefreshCw className="w-3 h-3 text-amber-400" />
            <span className="hidden sm:inline">Scan Now</span>
          </button>

          <button className="text-slate-400 hover:text-white p-1">
            {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Expanded Scanner Workspace */}
      {isExpanded && (
        <div className="px-3.5 py-3 border-t border-[#181a22] bg-[#08090d] text-xs space-y-3">
          
          {/* Main Decision Confluence Card */}
          <div className="p-3 rounded-lg bg-[#0e1017] border border-[#1e212c] space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#181b24] pb-2">
              <div className="flex items-center gap-2.5">
                <span className="text-slate-400 text-xs font-medium">Market Idea:</span>
                <div className={`px-2.5 py-0.5 rounded text-xs font-mono font-black tracking-wider border flex items-center gap-1.5 ${signalBadgeColor}`}>
                  {isUp && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />}
                  {isDown && <XCircle className="w-3.5 h-3.5 text-red-400" />}
                  {isNoSetup && <Info className="w-3.5 h-3.5 text-slate-400" />}
                  <span>{decision.signal}</span>
                </div>
                <div className={`px-2 py-0.5 rounded text-[10px] font-mono uppercase font-semibold border ${qualityBadgeColor}`}>
                  {decision.setupQuality} SETUP
                </div>
              </div>

              <div className="text-[11px] font-mono text-slate-400 flex items-center gap-3">
                <span>Current: <strong className="text-white">{formatPrice(scannerData.currentPrice)}</strong></span>
                <span>Invalidation: <strong className="text-red-400">{formatPrice(decision.invalidationLevel)}</strong></span>
              </div>
            </div>

            {/* Structured Evidence Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 text-xs font-mono">
              <div className="p-2 rounded bg-[#090a0f] border border-[#181a22]">
                <div className="text-[10px] text-slate-500 uppercase flex items-center gap-1 mb-0.5">
                  <Activity className="w-3 h-3 text-amber-400" />
                  Regime
                </div>
                <div
                  className={`font-bold text-[11px] uppercase truncate ${
                    decision.marketCondition === 'trending bullish'
                      ? 'text-emerald-400'
                      : decision.marketCondition === 'trending bearish'
                      ? 'text-red-400'
                      : 'text-amber-400'
                  }`}
                >
                  {decision.marketCondition}
                </div>
              </div>

              <div className="p-2 rounded bg-[#090a0f] border border-[#181a22]">
                <div className="text-[10px] text-slate-500 uppercase flex items-center gap-1 mb-0.5">
                  <Layers className="w-3 h-3 text-amber-400" />
                  Structure
                </div>
                <div className="text-slate-200 font-semibold text-[11px] truncate">
                  {decision.marketStructure}
                </div>
              </div>

              <div className="p-2 rounded bg-[#090a0f] border border-[#181a22]">
                <div className="text-[10px] text-slate-500 uppercase flex items-center gap-1 mb-0.5">
                  {scannerData.marketStructure.currentTrend === 'bullish' ? (
                    <TrendingUp className="w-3 h-3 text-emerald-400" />
                  ) : (
                    <TrendingDown className="w-3 h-3 text-red-400" />
                  )}
                  Trend
                </div>
                <div className="text-slate-200 font-semibold text-[11px] truncate">
                  {decision.trendCondition}
                </div>
              </div>

              <div className="p-2 rounded bg-[#090a0f] border border-[#181a22]">
                <div className="text-[10px] text-slate-500 uppercase flex items-center gap-1 mb-0.5">
                  <Volume2 className="w-3 h-3 text-amber-400" />
                  Volume
                </div>
                <div className="text-slate-200 font-semibold text-[11px] truncate">
                  {decision.volumeCondition}
                </div>
              </div>

              <div className="p-2 rounded bg-[#090a0f] border border-[#181a22]">
                <div className="text-[10px] text-slate-500 uppercase flex items-center gap-1 mb-0.5">
                  <Crosshair className="w-3 h-3 text-amber-400" />
                  Key Level
                </div>
                <div className="text-slate-200 font-semibold text-[11px] truncate">
                  {decision.keyPriceArea}
                </div>
              </div>
            </div>

            {/* Evidence Explanation */}
            <div className="p-2.5 rounded bg-[#090a0f] border border-[#181a22]">
              <span className="text-amber-400 font-bold uppercase text-[10px] tracking-wider block mb-0.5">
                Market Structure Analysis:
              </span>
              <p className="text-slate-300 leading-relaxed text-[11px]">
                {decision.reason}
              </p>
            </div>
          </div>

          {/* Formations List if any */}
          {scanResult.patterns.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-slate-400 text-xs font-semibold flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                Detected Candlestick Formations ({scanResult.patterns.length})
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {scanResult.patterns.map((p) => {
                  const isBull = p.bias === 'bullish';
                  return (
                    <div
                      key={p.id}
                      className="p-2 rounded bg-[#0e1017] border border-[#1c1f2b] flex flex-col justify-between"
                    >
                      <div className="flex items-center justify-between">
                        <span className={`font-bold text-xs ${isBull ? 'text-emerald-400' : 'text-red-400'}`}>
                          {p.name}
                        </span>
                        <span className="text-[10px] font-mono text-slate-500">
                          {p.confidence}% Pattern Score
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">
                        {p.description}
                      </p>
                      <div className="mt-1.5 pt-1 border-t border-[#181b24] flex items-center justify-between font-mono text-[10px] text-slate-500">
                        <span>Level: <strong className="text-slate-300">{formatPrice(p.priceLevel)}</strong></span>
                        <span>Invalidation: <strong className="text-red-400">{formatPrice(p.invalidationPrice)}</strong></span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Notice */}
          <div className="p-2 rounded bg-[#0d0e14] border border-amber-500/20 flex items-center gap-2 text-[10px] text-slate-400">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <span>Educational market viewing and candlestick reading only. Not financial advice.</span>
          </div>
        </div>
      )}
    </div>
  );
};

export default ChartScanner;
