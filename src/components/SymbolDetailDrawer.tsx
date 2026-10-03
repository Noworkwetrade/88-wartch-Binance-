/**
 * Symbol Detail & Candlestick Chart Drawer Component
 * Slides in when a user clicks any asset in the watchlist.
 * Shows:
 * - Real-time Candlestick Chart powered by genuine Binance Spot market data
 * - Full timeframe selection (1m - 1M)
 * - Drag/pan, wheel/pinch zoom, reset view
 * - Market Structure (HH, HL, LH, LL, BOS, CHoCH)
 * - 24h Market statistics, price range bar, bid/ask, and live update recency
 */

import React, { useState, useEffect } from 'react';
import {
  X,
  Clock,
  Zap,
  BarChart2,
  SlidersHorizontal,
  ChevronRight,
  Maximize2
} from 'lucide-react';
import { TickerData, Timeframe } from '../types.ts';
import { formatPrice, formatVolume } from './WatchlistTable.tsx';
import { CandlestickChart } from './CandlestickChart.tsx';

interface SymbolDetailDrawerProps {
  ticker: TickerData | null;
  onClose: () => void;
  timeframe: Timeframe;
  onTimeframeChange: (tf: Timeframe) => void;
}

export const SymbolDetailDrawer: React.FC<SymbolDetailDrawerProps> = ({
  ticker,
  onClose,
  timeframe,
  onTimeframeChange
}) => {
  const [secondsAgo, setSecondsAgo] = useState<number>(0);
  const [activeTab, setActiveTab] = useState<'chart' | 'stats'>('chart');

  useEffect(() => {
    if (!ticker) return;
    const interval = setInterval(() => {
      if (ticker.lastUpdateTime) {
        setSecondsAgo(Math.max(0, Math.floor((Date.now() - ticker.lastUpdateTime) / 1000)));
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [ticker]);

  if (!ticker) return null;

  const percentNum = parseFloat(ticker.priceChangePercent);
  const isPositive = !isNaN(percentNum) && percentNum > 0;
  const isNegative = !isNaN(percentNum) && percentNum < 0;

  const high = parseFloat(ticker.highPrice);
  const low = parseFloat(ticker.lowPrice);
  const current = parseFloat(ticker.lastPrice);
  let rangePercent = 50;
  if (!isNaN(high) && !isNaN(low) && !isNaN(current) && high > low) {
    rangePercent = Math.max(0, Math.min(100, ((current - low) / (high - low)) * 100));
  }

  return (
    <div className="w-full md:w-[620px] lg:w-[740px] xl:w-[860px] bg-[#181c27] border-l border-[#2a2e39] flex flex-col h-full z-20 shadow-2xl transition-all duration-200">
      {/* Drawer Header */}
      <div className="p-3.5 border-b border-[#2a2e39] bg-[#131722] flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-blue-500/10 border border-blue-500/30 flex items-center justify-center font-bold text-blue-400 text-xs font-mono">
            {ticker.symbol.slice(0, 3)}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-slate-100 font-mono">{ticker.symbol}</h2>
              <span className="text-[10px] text-slate-400 bg-[#1e222d] border border-[#2a2e39] px-1.5 py-0.2 rounded font-mono">
                SPOT
              </span>
            </div>
            <div className="flex items-center gap-2 text-[11px] text-slate-400">
              <span className="font-mono text-slate-300 font-medium">
                {formatPrice(ticker.lastPrice)}
              </span>
              <span
                className={`font-mono font-medium ${
                  isPositive ? 'text-emerald-400' : isNegative ? 'text-rose-400' : 'text-slate-400'
                }`}
              >
                {isPositive ? '+' : ''}
                {!isNaN(percentNum) ? percentNum.toFixed(2) : ticker.priceChangePercent}%
              </span>
              <span className="text-emerald-400 flex items-center gap-1 font-mono text-[10px]">
                <Zap className="w-2.5 h-2.5 fill-emerald-400" /> LIVE
              </span>
            </div>
          </div>
        </div>

        {/* View mode buttons & Close */}
        <div className="flex items-center gap-1.5">
          <div className="flex items-center bg-[#1e222d] p-0.5 rounded-md border border-[#2a2e39] text-xs">
            <button
              onClick={() => setActiveTab('chart')}
              className={`flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium transition-colors cursor-pointer ${
                activeTab === 'chart'
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <BarChart2 className="w-3.5 h-3.5" />
              <span>Chart</span>
            </button>
            <button
              onClick={() => setActiveTab('stats')}
              className={`flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium transition-colors cursor-pointer ${
                activeTab === 'stats'
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              <span>Stats</span>
            </button>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-md text-slate-400 hover:text-white hover:bg-[#252a37] transition-colors cursor-pointer"
            title="Close Drawer (Esc)"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Main Drawer Body */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {activeTab === 'chart' ? (
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Real Candlestick Chart Area */}
            <div className="flex-1 min-h-[360px] flex flex-col overflow-hidden border-b border-[#2a2e39]">
              <CandlestickChart
                symbol={ticker.symbol}
                ticker={ticker}
                timeframe={timeframe}
                onTimeframeChange={onTimeframeChange}
              />
            </div>

            {/* Quick Stats Bar below Chart */}
            <div className="p-3 bg-[#131722] grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs font-mono">
              <div className="p-2 rounded bg-[#181c27] border border-[#2a2e39]">
                <div className="text-[10px] text-slate-500">24h Low</div>
                <div className="font-semibold text-slate-200">{formatPrice(ticker.lowPrice)}</div>
              </div>
              <div className="p-2 rounded bg-[#181c27] border border-[#2a2e39]">
                <div className="text-[10px] text-slate-500">24h High</div>
                <div className="font-semibold text-slate-200">{formatPrice(ticker.highPrice)}</div>
              </div>
              <div className="p-2 rounded bg-[#181c27] border border-[#2a2e39]">
                <div className="text-[10px] text-slate-500">24h Volume</div>
                <div className="font-semibold text-slate-200">{formatVolume(ticker.volume)}</div>
              </div>
              <div className="p-2 rounded bg-[#181c27] border border-[#2a2e39]">
                <div className="text-[10px] text-slate-500">Last Update</div>
                <div className="font-semibold text-emerald-400">
                  {secondsAgo === 0 ? 'Live now' : `${secondsAgo}s ago`}
                </div>
              </div>
            </div>
          </div>
        ) : (
          /* Comprehensive Stats View */
          <div className="p-5 flex-1 overflow-y-auto space-y-5">
            {/* Price Overview */}
            <div className="p-4 rounded-lg bg-[#131722] border border-[#2a2e39]">
              <div className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold mb-1">
                Last Price
              </div>
              <div className="text-3xl font-bold font-mono tracking-tight text-white mb-2">
                {formatPrice(ticker.lastPrice)}
              </div>

              <div className="flex items-center gap-2">
                <span
                  className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-mono font-medium ${
                    isPositive
                      ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                      : isNegative
                      ? 'bg-rose-500/15 text-rose-400 border border-rose-500/30'
                      : 'bg-slate-800 text-slate-400'
                  }`}
                >
                  {isPositive ? '+' : ''}
                  {!isNaN(percentNum) ? percentNum.toFixed(2) : ticker.priceChangePercent}%
                </span>
                <span
                  className={`text-xs font-mono ${
                    isPositive ? 'text-emerald-400' : isNegative ? 'text-rose-400' : 'text-slate-400'
                  }`}
                >
                  ({isPositive ? '+' : ''}
                  {formatPrice(ticker.priceChange)})
                </span>
              </div>
            </div>

            {/* 24h High / Low Range */}
            <div className="p-4 rounded-lg bg-[#131722] border border-[#2a2e39] space-y-3">
              <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                24h Price Range
              </div>

              <div className="relative pt-2 pb-1">
                <div className="h-2 w-full bg-[#2a2e39] rounded-full overflow-hidden relative">
                  <div
                    className="h-full bg-gradient-to-r from-rose-500 via-amber-400 to-emerald-500 rounded-full"
                    style={{ width: '100%' }}
                  />
                  <div
                    className="absolute top-0 bottom-0 w-2 bg-white rounded-full shadow-md"
                    style={{ left: `${rangePercent}%`, transform: 'translateX(-50%)' }}
                  />
                </div>
              </div>

              <div className="flex justify-between items-center text-xs font-mono">
                <div>
                  <div className="text-[10px] text-slate-500">24h Low</div>
                  <div className="font-semibold text-slate-200">{formatPrice(ticker.lowPrice)}</div>
                </div>
                <div className="text-right">
                  <div className="text-[10px] text-slate-500">24h High</div>
                  <div className="font-semibold text-slate-200">{formatPrice(ticker.highPrice)}</div>
                </div>
              </div>
            </div>

            {/* Volume & Market Data Grid */}
            <div className="p-4 rounded-lg bg-[#131722] border border-[#2a2e39] space-y-3">
              <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                Volume & Market Depth
              </div>

              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="p-2.5 rounded bg-[#1e222d] border border-[#2a2e39]">
                  <div className="text-[10px] text-slate-400 mb-0.5">24h Volume (Base)</div>
                  <div className="font-mono font-medium text-slate-100">
                    {formatVolume(ticker.volume)}
                  </div>
                </div>

                <div className="p-2.5 rounded bg-[#1e222d] border border-[#2a2e39]">
                  <div className="text-[10px] text-slate-400 mb-0.5">24h Volume (Quote)</div>
                  <div className="font-mono font-medium text-slate-100">
                    {formatVolume(ticker.quoteVolume)}
                  </div>
                </div>

                <div className="p-2.5 rounded bg-[#1e222d] border border-[#2a2e39]">
                  <div className="text-[10px] text-slate-400 mb-0.5">Bid Price</div>
                  <div className="font-mono font-medium text-slate-100">
                    {formatPrice(ticker.bidPrice)}
                  </div>
                </div>

                <div className="p-2.5 rounded bg-[#1e222d] border border-[#2a2e39]">
                  <div className="text-[10px] text-slate-400 mb-0.5">Ask Price</div>
                  <div className="font-mono font-medium text-slate-100">
                    {formatPrice(ticker.askPrice)}
                  </div>
                </div>
              </div>
            </div>

            {/* Live Stream Health & Timestamps */}
            <div className="p-4 rounded-lg bg-[#131722] border border-[#2a2e39] space-y-2">
              <div className="flex items-center gap-1.5 text-xs text-slate-400">
                <Clock className="w-3.5 h-3.5" />
                <span>Last Binance Ticker Tick:</span>
                <span className="font-mono text-slate-200">
                  {ticker.lastUpdateTime
                    ? new Date(ticker.lastUpdateTime).toLocaleTimeString()
                    : '--'}
                </span>
              </div>
              <div className="text-[11px] text-slate-500 font-mono">
                {secondsAgo === 0 ? 'Updated just now' : `Updated ${secondsAgo}s ago`}
              </div>
            </div>

            {/* Binance Channel Info */}
            <div className="p-3 rounded bg-[#1e222d]/70 border border-[#2a2e39] text-[11px] font-mono text-slate-400 flex justify-between items-center">
              <span>Binance Stream Channel:</span>
              <span className="text-blue-400 font-semibold">{ticker.symbol.toLowerCase()}@miniTicker</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default SymbolDetailDrawer;
