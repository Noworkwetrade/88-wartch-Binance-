/**
 * Watchlist Toolbar Component
 * Clean NWWT search, sorting presets, and fast pair filtering
 */

import React from 'react';
import { Search, X, TrendingUp, TrendingDown, Flame, BarChart2 } from 'lucide-react';
import { FilterPreset } from '../types.ts';

interface WatchlistToolbarProps {
  searchQuery: string;
  onSearchChange: (q: string) => void;
  selectedPreset: FilterPreset;
  onPresetChange: (preset: FilterPreset) => void;
  filteredCount: number;
  totalCount: number;
}

export const WatchlistToolbar: React.FC<WatchlistToolbarProps> = ({
  searchQuery,
  onSearchChange,
  selectedPreset,
  onPresetChange,
  filteredCount,
  totalCount
}) => {
  return (
    <div className="bg-[#0c0d12] border-b border-[#181a24] px-3 py-2 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2 shrink-0">
      {/* Search Input */}
      <div className="relative flex-1 max-w-xs">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search symbol (e.g. BTC, ETH, SOL)..."
          className="w-full bg-[#12131b] border border-[#20222f] focus:border-amber-500 focus:outline-none rounded pl-8 pr-7 py-1 text-xs text-white placeholder:text-slate-500 transition-colors font-mono"
        />
        {searchQuery && (
          <button
            onClick={() => onSearchChange('')}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Preset Filters */}
      <div className="flex items-center justify-between sm:justify-end gap-1.5 text-xs">
        <div className="flex items-center gap-1 bg-[#12131b] p-0.5 rounded border border-[#20222f]">
          <button
            onClick={() => onPresetChange('all')}
            className={`px-2 py-0.5 rounded text-[11px] font-mono font-medium transition ${
              selectedPreset === 'all'
                ? 'bg-amber-500 text-black font-bold'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            All
          </button>

          <button
            onClick={() => onPresetChange('gainers')}
            className={`px-2 py-0.5 rounded text-[11px] font-mono font-medium transition flex items-center gap-1 ${
              selectedPreset === 'gainers'
                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <TrendingUp className="w-3 h-3 text-emerald-400" />
            <span>Gainers</span>
          </button>

          <button
            onClick={() => onPresetChange('losers')}
            className={`px-2 py-0.5 rounded text-[11px] font-mono font-medium transition flex items-center gap-1 ${
              selectedPreset === 'losers'
                ? 'bg-red-500/20 text-red-400 border border-red-500/40'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <TrendingDown className="w-3 h-3 text-red-400" />
            <span>Losers</span>
          </button>

          <button
            onClick={() => onPresetChange('highVolume')}
            className={`px-2 py-0.5 rounded text-[11px] font-mono font-medium transition flex items-center gap-1 ${
              selectedPreset === 'highVolume'
                ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Flame className="w-3 h-3 text-amber-400" />
            <span>Vol</span>
          </button>
        </div>

        <span className="text-[10px] text-slate-500 font-mono hidden md:inline ml-1">
          {filteredCount} pairs
        </span>
      </div>
    </div>
  );
};

export default WatchlistToolbar;
