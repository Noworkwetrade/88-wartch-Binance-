/**
 * TradingView Style Watchlist Table Component
 * High performance, sorting, smooth price updates, clean NWWT financial formatting
 */

import React, { useState } from 'react';
import { ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';
import { TickerData, SortField, SortConfig } from '../types.ts';

interface WatchlistTableProps {
  tickers: TickerData[];
  sortConfig: SortConfig;
  onSort: (field: SortField) => void;
  selectedSymbol: string | null;
  onSelectSymbol: (ticker: TickerData) => void;
}

export function formatPrice(priceStr: string | number): string {
  if (priceStr === '--' || priceStr === undefined || priceStr === null) return '--';
  const num = typeof priceStr === 'number' ? priceStr : parseFloat(priceStr);
  if (isNaN(num)) return String(priceStr);

  if (num >= 1000) {
    return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  } else if (num >= 1) {
    return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  } else if (num >= 0.0001) {
    return num.toFixed(6);
  } else {
    return num.toFixed(8);
  }
}

export function formatVolume(volStr: string | number): string {
  if (volStr === '--' || volStr === undefined || volStr === null) return '--';
  const num = typeof volStr === 'number' ? volStr : parseFloat(volStr);
  if (isNaN(num)) return String(volStr);

  if (num >= 1_000_000_000) return (num / 1_000_000_000).toFixed(2) + 'B';
  if (num >= 1_000_000) return (num / 1_000_000).toFixed(2) + 'M';
  if (num >= 1_000) return (num / 1_000).toFixed(2) + 'K';
  return num.toFixed(2);
}

export const WatchlistTable: React.FC<WatchlistTableProps> = ({
  tickers,
  sortConfig,
  onSort,
  selectedSymbol,
  onSelectSymbol
}) => {
  // Page limit for high-speed rendering with smooth scrolling
  const [displayLimit, setDisplayLimit] = useState<number>(120);

  const renderSortIcon = (field: SortField) => {
    if (sortConfig.field !== field) {
      return <ArrowUpDown className="w-3 h-3 text-slate-600 opacity-60 group-hover:opacity-100" />;
    }
    return sortConfig.direction === 'asc' ? (
      <ArrowUp className="w-3 h-3 text-amber-400" />
    ) : (
      <ArrowDown className="w-3 h-3 text-amber-400" />
    );
  };

  const visibleTickers = tickers.slice(0, displayLimit);

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-[#070709] text-white">
      <div className="overflow-x-auto overflow-y-auto flex-1">
        <table className="w-full border-collapse text-left text-xs font-sans select-none">
          {/* Table Header */}
          <thead className="bg-[#0c0d12] text-slate-400 sticky top-0 z-10 border-b border-[#181a24] shadow-sm uppercase tracking-wider text-[10px] font-mono">
            <tr>
              <th
                onClick={() => onSort('symbol')}
                className="py-2.5 px-3 font-semibold hover:text-white cursor-pointer group transition-colors"
              >
                <div className="flex items-center gap-1.5">
                  <span>Asset</span>
                  {renderSortIcon('symbol')}
                </div>
              </th>

              <th
                onClick={() => onSort('lastPrice')}
                className="py-2.5 px-3 font-semibold text-right hover:text-white cursor-pointer group transition-colors"
              >
                <div className="flex items-center justify-end gap-1.5">
                  <span>Price (USDT)</span>
                  {renderSortIcon('lastPrice')}
                </div>
              </th>

              <th
                onClick={() => onSort('priceChangePercent')}
                className="py-2.5 px-3 font-semibold text-right hover:text-white cursor-pointer group transition-colors"
              >
                <div className="flex items-center justify-end gap-1.5">
                  <span>24h Change</span>
                  {renderSortIcon('priceChangePercent')}
                </div>
              </th>

              <th
                onClick={() => onSort('volume')}
                className="py-2.5 px-3 font-semibold text-right hidden sm:table-cell hover:text-white cursor-pointer group transition-colors"
              >
                <div className="flex items-center justify-end gap-1.5">
                  <span>Volume</span>
                  {renderSortIcon('volume')}
                </div>
              </th>
            </tr>
          </thead>

          {/* Table Body */}
          <tbody className="divide-y divide-[#12141c]">
            {visibleTickers.length === 0 ? (
              <tr>
                <td colSpan={4} className="py-16 text-center text-slate-500 font-mono">
                  No matching Binance Spot USDT pairs found.
                </td>
              </tr>
            ) : (
              visibleTickers.map((ticker) => {
                const isSelected = selectedSymbol === ticker.symbol;
                const percentNum = parseFloat(ticker.priceChangePercent);
                const isPositive = !isNaN(percentNum) && percentNum > 0;
                const isNegative = !isNaN(percentNum) && percentNum < 0;

                return (
                  <tr
                    key={ticker.symbol}
                    onClick={() => onSelectSymbol(ticker)}
                    className={`transition-colors cursor-pointer group ${
                      isSelected
                        ? 'bg-amber-500/10 border-l-2 border-l-amber-500'
                        : 'hover:bg-[#10121a]'
                    }`}
                  >
                    {/* Symbol */}
                    <td className="py-2 px-3 whitespace-nowrap">
                      <div className="flex items-center gap-1.5">
                        <span className="font-semibold text-white group-hover:text-amber-400 transition-colors font-mono text-xs">
                          {ticker.symbol.replace(/USDT$/, '')}
                        </span>
                        <span className="text-[10px] text-slate-500 font-mono">
                          /USDT
                        </span>
                      </div>
                    </td>

                    {/* Live Price */}
                    <td className="py-2 px-3 text-right whitespace-nowrap font-mono text-xs font-semibold text-white">
                      <span>{formatPrice(ticker.lastPrice)}</span>
                    </td>

                    {/* 24h Change % */}
                    <td className="py-2 px-3 text-right whitespace-nowrap">
                      <span
                        className={`inline-flex items-center justify-end px-1.5 py-0.5 rounded text-[11px] font-mono font-bold min-w-[58px] ${
                          isPositive
                            ? 'text-emerald-400 bg-emerald-500/10'
                            : isNegative
                            ? 'text-red-400 bg-red-500/10'
                            : 'text-slate-400 bg-slate-800/40'
                        }`}
                      >
                        {isPositive ? '+' : ''}
                        {!isNaN(percentNum) ? percentNum.toFixed(2) : '0.00'}%
                      </span>
                    </td>

                    {/* 24h Volume */}
                    <td className="py-2 px-3 text-right whitespace-nowrap font-mono text-[11px] text-slate-400 hidden sm:table-cell">
                      {formatVolume(ticker.quoteVolume || ticker.volume)}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Row count & Load More if > displayLimit */}
      {tickers.length > displayLimit && (
        <div className="p-2 border-t border-[#151722] bg-[#0c0d12] flex items-center justify-between text-[11px] text-slate-500 font-mono">
          <span>Showing {displayLimit} of {tickers.length} pairs</span>
          <button
            onClick={() => setDisplayLimit((prev) => prev + 100)}
            className="text-amber-400 hover:text-amber-300 transition text-xs font-semibold"
          >
            Load More Pairs ↓
          </button>
        </div>
      )}
    </div>
  );
};

export default WatchlistTable;
