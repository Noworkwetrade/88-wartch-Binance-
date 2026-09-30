/**
 * NWWT Market Header Component
 *
 * Real-time Binance market stream status, NWWT branding,
 * and high-visibility navigation targets: Watchlist, Chart, Scanner.
 */

import React from 'react';
import { Activity, RefreshCw, BarChart2, TrendingUp, Zap } from 'lucide-react';
import { ConnectionStatus } from '../types.ts';

export type NavTab = 'watchlist' | 'chart' | 'scanner';

interface HeaderProps {
  status: ConnectionStatus;
  totalSymbols: number;
  ticksPerSecond: number;
  activeTab: NavTab;
  onTabChange: (tab: NavTab) => void;
  onReconnect: () => void;
  selectedAsset: string | null;
}

export const Header: React.FC<HeaderProps> = ({
  status,
  totalSymbols,
  ticksPerSecond,
  activeTab,
  onTabChange,
  onReconnect,
  selectedAsset
}) => {
  const isConnected = status === 'connected';

  return (
    <header className="border-b border-[#181a24] bg-[#090a0e] px-2.5 sm:px-3.5 py-2 sticky top-0 z-30 flex items-center justify-between gap-2 sm:gap-3 text-white select-none overflow-x-auto no-scrollbar">
      {/* Brand & Market Info */}
      <div className="flex items-center gap-2 sm:gap-3 shrink-0">
        <div className="flex items-center gap-1.5 sm:gap-2">
          <div className="w-6 h-6 sm:w-7 sm:h-7 rounded bg-amber-500/10 border border-amber-500/40 flex items-center justify-center font-black text-amber-400 text-xs shadow-sm shrink-0">
            NW
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="font-extrabold text-xs sm:text-sm tracking-tight text-white">NWWT</span>
              <span className="text-[9px] sm:text-[10px] font-mono px-1 sm:px-1.5 py-0.2 rounded bg-amber-500/10 text-amber-400 border border-amber-500/25 font-bold uppercase tracking-wide hidden min-[380px]:inline">
                SCANNER
              </span>
            </div>
            <div className="text-[10px] text-slate-400 font-mono hidden md:block">
              Binance Spot USDT • Live Stream
            </div>
          </div>
        </div>

        {/* Selected asset tag if set */}
        {selectedAsset && (
          <div className="hidden xl:flex items-center gap-1.5 pl-3 border-l border-[#1a1c27] text-xs font-mono">
            <span className="text-slate-500">Active:</span>
            <span className="text-amber-400 font-bold bg-[#141620] px-2 py-0.5 rounded border border-[#232738]">
              {selectedAsset}
            </span>
          </div>
        )}
      </div>

      {/* Center: Three Clear Navigation Targets */}
      <nav className="flex items-center bg-[#10121a] p-0.5 sm:p-1 rounded-md border border-[#1e2130] shrink-0">
        <button
          onClick={() => onTabChange('watchlist')}
          className={`flex items-center gap-1 sm:gap-1.5 px-2 sm:px-3 py-1 rounded text-[11px] sm:text-xs font-mono font-medium transition cursor-pointer whitespace-nowrap ${
            activeTab === 'watchlist'
              ? 'bg-amber-500 text-black font-bold shadow-sm'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          <BarChart2 className="w-3.5 h-3.5 shrink-0" />
          <span>Watchlist</span>
        </button>

        <button
          onClick={() => onTabChange('chart')}
          className={`flex items-center gap-1 sm:gap-1.5 px-2 sm:px-3 py-1 rounded text-[11px] sm:text-xs font-mono font-medium transition cursor-pointer whitespace-nowrap ${
            activeTab === 'chart'
              ? 'bg-amber-500 text-black font-bold shadow-sm'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          <TrendingUp className="w-3.5 h-3.5 shrink-0" />
          <span>Chart</span>
        </button>

        <button
          onClick={() => onTabChange('scanner')}
          className={`flex items-center gap-1 sm:gap-1.5 px-2 sm:px-3 py-1 rounded text-[11px] sm:text-xs font-mono font-medium transition cursor-pointer whitespace-nowrap ${
            activeTab === 'scanner'
              ? 'bg-amber-500 text-black font-bold shadow-sm'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          <Zap className="w-3.5 h-3.5 text-amber-400 shrink-0" />
          <span>Scanner</span>
        </button>
      </nav>

      {/* Right: Live Connection & Velocity */}
      <div className="flex items-center gap-1.5 sm:gap-2 text-xs shrink-0">
        {/* Speed / Ticks Indicator */}
        <div className="hidden md:flex items-center gap-1.5 px-2.5 py-1 rounded bg-[#10121a] border border-[#1e2130] text-slate-300 font-mono text-[11px]">
          <Activity className="w-3 h-3 text-amber-400" />
          <span>{ticksPerSecond} <span className="text-slate-500">ticks/s</span></span>
        </div>

        {/* Live Status Badge */}
        <div
          className={`flex items-center gap-1 sm:gap-1.5 px-2 sm:px-2.5 py-0.5 sm:py-1 rounded-full text-[10px] sm:text-[11px] font-mono font-semibold border ${
            isConnected
              ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
              : 'bg-amber-500/10 text-amber-400 border-amber-500/30'
          }`}
        >
          <span
            className={`w-1.5 h-1.5 rounded-full shrink-0 ${
              isConnected ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'
            }`}
          />
          <span className="hidden min-[420px]:inline">{isConnected ? 'LIVE FEED' : status.toUpperCase()}</span>
        </div>

        {/* Reconnect button */}
        <button
          onClick={onReconnect}
          className="p-1 sm:p-1.5 rounded bg-[#12141c] hover:bg-[#1a1d28] border border-[#202330] text-slate-400 hover:text-white transition cursor-pointer shrink-0"
          title="Reconnect Market Stream"
        >
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      </div>
    </header>
  );
};

export default Header;
