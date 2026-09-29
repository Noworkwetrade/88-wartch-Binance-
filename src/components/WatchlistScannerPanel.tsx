/**
 * NWWT Watchlist Scanner Panel
 *
 * Dedicated analysis layer that scans the Binance Spot USDT watchlist using real closed candles.
 * Displays:
 * - Scanner connection status
 * - Number of assets ready and scanned
 * - Scanner timeframe switcher (15m, 1h, 4h)
 * - Most recent confirmed UP or DOWN signals with plain language reasons
 * - Pending retest setups
 * - Clicking any signal selects the asset and opens its chart
 */

import React from 'react';
import {
  TrendingUp,
  TrendingDown,
  RefreshCw,
  Clock,
  ArrowRight,
  Shield,
  Layers,
  Sparkles,
  Target
} from 'lucide-react';
import { ScannerState, Timeframe, ScannerSignalItem, PendingRetestItem } from '../types.ts';
import { formatPrice } from './WatchlistTable.tsx';

interface WatchlistScannerPanelProps {
  scannerState: ScannerState;
  selectedAsset: string | null;
  onSelectAsset: (symbol: string) => void;
  onTimeframeChange: (tf: Timeframe) => void;
  onTriggerScan: (tf?: Timeframe) => void;
}

const SCANNER_TIMEFRAMES: Timeframe[] = ['15m', '1h', '4h'];

export const WatchlistScannerPanel: React.FC<WatchlistScannerPanelProps> = ({
  scannerState,
  selectedAsset,
  onSelectAsset,
  onTimeframeChange,
  onTriggerScan
}) => {
  const { status, timeframe, scannedCount, totalSymbols, lastScanTime, signals, pendingRetests } = scannerState;

  const isScanning = status === 'scanning';
  const latestSignal: ScannerSignalItem | null = signals.length > 0 ? signals[0] : null;

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
              {scannedCount} assets scanned • Closed candles only
            </div>
          </div>
        </div>

        {/* Timeframe selector & Manual Scan button */}
        <div className="flex items-center gap-2">
          <div className="flex items-center bg-[#12131a] p-0.5 rounded border border-[#20222d]">
            {SCANNER_TIMEFRAMES.map((tf) => (
              <button
                key={tf}
                onClick={() => {
                  onTimeframeChange(tf);
                  onTriggerScan(tf);
                }}
                className={`px-2 py-1 rounded text-[11px] font-mono font-medium transition ${
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
            className={`p-1.5 rounded bg-[#161822] hover:bg-[#202330] border border-[#2a2e3d] text-amber-400 transition ${
              isScanning ? 'opacity-50 cursor-not-allowed' : 'active:scale-95'
            }`}
            title="Scan watchlist candles now"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isScanning ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Main Content Area: Scrollable */}
      <div className="flex-1 overflow-y-auto divide-y divide-[#161720]">
        
        {/* Prominent Latest Confirmed Signal Alert */}
        {latestSignal ? (
          <div className="p-3 bg-[#0d0f17] border-b border-[#1f2230]">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-mono tracking-wider uppercase text-amber-400 font-bold flex items-center gap-1">
                <Sparkles className="w-3 h-3 text-amber-400" />
                Latest Confirmed Setup
              </span>
              <span className="text-[10px] text-slate-500 font-mono">
                {latestSignal.timeframe} TF
              </span>
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
                  <span className="font-bold text-white">{formatPrice(latestSignal.signalPrice)}</span>
                  <ArrowRight className="w-3.5 h-3.5 text-slate-500 group-hover:text-amber-400 transition transform group-hover:translate-x-0.5" />
                </div>
              </div>

              <p className="text-xs text-slate-300 mt-2 leading-relaxed">
                {latestSignal.reason}
              </p>

              <div className="mt-2.5 pt-2 border-t border-[#1a1d29] flex items-center justify-between text-[11px] font-mono text-slate-400">
                <div className="flex items-center gap-1.5">
                  <Shield className="w-3 h-3 text-red-400" />
                  <span>Invalidation: <strong className="text-red-400">{formatPrice(latestSignal.invalidationLevel)}</strong></span>
                </div>
                <span className="text-[10px] text-amber-400/80 font-semibold">
                  {latestSignal.confidence}% Confluence
                </span>
              </div>
            </div>
          </div>
        ) : (
          <div className="p-4 text-center text-slate-500 text-xs font-mono">
            {isScanning ? 'Analyzing market structure across pairs...' : 'Scanning active. Awaiting verified technical setups.'}
          </div>
        )}

        {/* Confirmed Signals Section */}
        <div className="p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5 text-amber-400" />
              Confirmed Signals ({signals.length})
            </span>
            <span className="text-[10px] text-slate-500 font-mono">
              Click asset to open chart
            </span>
          </div>

          {signals.length === 0 ? (
            <div className="p-4 text-center rounded border border-[#181a24] bg-[#0c0d12] text-slate-500 text-xs font-mono">
              No active signals on {timeframe} timeframe. Market structure currently neutral.
            </div>
          ) : (
            <div className="space-y-1.5">
              {signals.map((s) => {
                const isSelected = selectedAsset === s.asset;
                const isUp = s.direction === 'UP';

                return (
                  <div
                    key={s.id}
                    onClick={() => onSelectAsset(s.asset)}
                    className={`p-2.5 rounded border transition cursor-pointer ${
                      isSelected
                        ? 'bg-[#151824] border-amber-500/60 shadow-sm'
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
                        <span className="text-[10px] font-mono text-slate-400">
                          {s.setupType}
                        </span>
                      </div>

                      <div className="font-mono text-xs font-bold text-white">
                        {formatPrice(s.signalPrice)}
                      </div>
                    </div>

                    <p className="text-[11px] text-slate-300 mt-1 line-clamp-2 leading-relaxed">
                      {s.reason}
                    </p>

                    <div className="mt-1.5 pt-1 border-t border-[#161822] flex items-center justify-between text-[10px] font-mono text-slate-500">
                      <span>Invalidation: <strong className="text-red-400/90">{formatPrice(s.invalidationLevel)}</strong></span>
                      <span className="text-amber-400/80">{s.confidence}% Conf.</span>
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

      </div>

      {/* Bottom Educational Disclaimer */}
      <div className="p-2 border-t border-[#181920] bg-[#0a0a0d] text-[10px] text-slate-500 flex items-center justify-between font-mono shrink-0">
        <span>Educational market viewing terminal</span>
        <span>Not financial advice</span>
      </div>
    </div>
  );
};

export default WatchlistScannerPanel;
