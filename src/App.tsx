/**
 * NWWT Market Viewing & Signal Scanner Terminal
 * Real-time Binance Spot USDT Market Data, Interactive Candlestick Chart & Market Structure Scanner
 *
 * Navigation:
 * - Watchlist
 * - Chart
 * - Scanner
 *
 * Desktop: Clean split layout with Watchlist/Scanner on left and selected Chart on right.
 * Mobile: Clean stacked layout with sticky navigation bar.
 * Clicking an asset opens its chart. Clicking a scanner signal opens that asset's chart.
 * Strictly educational market viewing. NO trading controls.
 */

import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { useBinanceMarket } from './hooks/useBinanceMarket.ts';
import { useSignalPerformance } from './hooks/useSignalPerformance.ts';
import { loadClearedSignalIds } from './utils/signalTouchEngine.ts';
import { isPermanentlyExcludedSymbol } from './utils/marketStructureQuality.ts';
import { Header, NavTab } from './components/Header.tsx';
import { WatchlistToolbar } from './components/WatchlistToolbar.tsx';
import { WatchlistTable } from './components/WatchlistTable.tsx';
import { WatchlistScannerPanel } from './components/WatchlistScannerPanel.tsx';
import { CandlestickChart } from './components/CandlestickChart.tsx';
import { TickerData, SortField, SortConfig, FilterPreset, Timeframe } from './types.ts';
import { BarChart2, TrendingUp, Zap } from 'lucide-react';

export default function App() {
  const {
    connectionStatus,
    totalSymbols,
    tickersList,
    tickersMap,
    ticksPerSecond,
    scannerState,
    triggerScan,
    updateScannerConfig,
    reconnectBackend
  } = useBinanceMarket();

  // V8 Signal Performance Engine
  const {
    signals: performanceSignals,
    activeSignals,
    completedSignals,
    stats: performanceStats,
    clearHistory
  } = useSignalPerformance(scannerState.signals, tickersMap, scannerState.completedSignals);

  // Navigation Target State
  const [activeTab, setActiveTab] = useState<NavTab>('watchlist');

  // Desktop Left Pane Sub-tab: 'watchlist' or 'scanner'
  const [leftPaneTab, setLeftPaneTab] = useState<'watchlist' | 'scanner'>('watchlist');

  // Persistent State
  const [searchQuery, setSearchQuery] = useState<string>(() => {
    return localStorage.getItem('nwwt_search_query') || '';
  });

  const [selectedPreset, setSelectedPreset] = useState<FilterPreset>(() => {
    return (localStorage.getItem('nwwt_selected_preset') as FilterPreset) || 'all';
  });

  const [sortConfig, setSortConfig] = useState<SortConfig>(() => {
    try {
      const saved = localStorage.getItem('nwwt_sort_config');
      if (saved) return JSON.parse(saved);
    } catch (e) {}
    return { field: 'volume', direction: 'desc' };
  });

  // Selected Symbol: Default to BTCUSDT so a real chart is always active
  const [selectedSymbolName, setSelectedSymbolName] = useState<string>(() => {
    const saved = localStorage.getItem('nwwt_selected_symbol') || 'BTCUSDT';
    return isPermanentlyExcludedSymbol(saved) ? 'BTCUSDT' : saved;
  });

  const [selectedTimeframe, setSelectedTimeframe] = useState<Timeframe>(() => {
    return (localStorage.getItem('nwwt_selected_timeframe') as Timeframe) || '15m';
  });

  // Ensure excluded symbols are never selected
  useEffect(() => {
    if (isPermanentlyExcludedSymbol(selectedSymbolName)) {
      setSelectedSymbolName('BTCUSDT');
    }
  }, [selectedSymbolName]);

  // Sync to localStorage
  useEffect(() => {
    localStorage.setItem('nwwt_search_query', searchQuery);
  }, [searchQuery]);

  useEffect(() => {
    localStorage.setItem('nwwt_selected_preset', selectedPreset);
  }, [selectedPreset]);

  useEffect(() => {
    localStorage.setItem('nwwt_sort_config', JSON.stringify(sortConfig));
  }, [sortConfig]);

  useEffect(() => {
    if (selectedSymbolName) {
      localStorage.setItem('nwwt_selected_symbol', selectedSymbolName);
    }
  }, [selectedSymbolName]);

  useEffect(() => {
    localStorage.setItem('nwwt_selected_timeframe', selectedTimeframe);
  }, [selectedTimeframe]);

  // Sorting handler
  const handleSort = (field: SortField) => {
    setSortConfig((prev) => {
      if (prev.field === field) {
        return {
          field,
          direction: prev.direction === 'asc' ? 'desc' : 'asc'
        };
      }
      return {
        field,
        direction: field === 'symbol' ? 'asc' : 'desc'
      };
    });
  };

  // Filter & Sort tickers
  const filteredAndSortedTickers = useMemo(() => {
    let result = tickersList.filter((t) => t && t.symbol && !isPermanentlyExcludedSymbol(t.symbol));

    // 1. Search Query Filter
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toUpperCase();
      result = result.filter(
        (t) =>
          t.symbol.toUpperCase().includes(q) ||
          (t.baseAsset && t.baseAsset.toUpperCase().includes(q))
      );
    }

    // 2. Preset Filter
    if (selectedPreset === 'gainers') {
      result = result.filter((t) => {
        const p = parseFloat(t.priceChangePercent);
        return !isNaN(p) && p > 0;
      });
    } else if (selectedPreset === 'losers') {
      result = result.filter((t) => {
        const p = parseFloat(t.priceChangePercent);
        return !isNaN(p) && p < 0;
      });
    } else if (selectedPreset === 'highVolume') {
      result = result.filter((t) => {
        const v = parseFloat(t.volume);
        return !isNaN(v) && v > 0;
      });
    }

    // 3. Sorting
    const { field, direction } = sortConfig;
    const factor = direction === 'asc' ? 1 : -1;

    return [...result].sort((a, b) => {
      if (field === 'symbol') {
        return a.symbol.localeCompare(b.symbol) * factor;
      }
      const aVal = parseFloat((a as any)[field]) || 0;
      const bVal = parseFloat((b as any)[field]) || 0;

      if (aVal === bVal) {
        return a.symbol.localeCompare(b.symbol);
      }
      return (aVal - bVal) * factor;
    });
  }, [tickersList, searchQuery, selectedPreset, sortConfig]);

  // Selected ticker for the chart
  const selectedTicker = useMemo(() => {
    const sym = selectedSymbolName || 'BTCUSDT';
    return tickersMap.get(sym) || {
      symbol: sym,
      baseAsset: sym.replace(/USDT$/, ''),
      quoteAsset: 'USDT',
      lastPrice: '--',
      priceChange: '0.00',
      priceChangePercent: '0.00',
      highPrice: '--',
      lowPrice: '--',
      bidPrice: '--',
      askPrice: '--',
      volume: '0',
      quoteVolume: '0',
      lastUpdateTime: Date.now()
    };
  }, [selectedSymbolName, tickersList, tickersMap]);

  // Active signal for currently selected asset - ONLY ACTIVE setups get drawn on chart
  // Completed trades (WIN / LOSS / EXPIRED) must never leave levels behind on active chart
  const activeSignalForAsset = useMemo(() => {
    if (!selectedSymbolName) return null;
    const clearedSet = loadClearedSignalIds();
    const activeList = activeSignals.filter(
      (s) =>
        s.asset === selectedSymbolName &&
        !s.isTradeComplete &&
        (s.status === 'ACTIVE' || (s.tp1Hit && !s.isTradeComplete)) &&
        !clearedSet.has(s.id) &&
        s.modelType !== 'inverse' &&
        s.modelType !== 'ai_filtered_inverse' &&
        !completedSignals.some(
          (c) =>
            c.asset === s.asset &&
            c.timeframe === s.timeframe &&
            (c.confirmedCandleCloseTime === s.confirmedCandleCloseTime || c.timestamp === s.timestamp)
        )
    );
    // Prioritize AI Filtered setup if available, otherwise original
    const aiFiltered = activeList.find((s) => s.modelType === 'ai_filtered');
    if (aiFiltered) return aiFiltered;
    return activeList[0] || null;
  }, [activeSignals, completedSignals, selectedSymbolName]);

  // Open asset chart on asset click (used by Watchlist & Scanner)
  const handleSelectAsset = useCallback((symbol: string) => {
    if (isPermanentlyExcludedSymbol(symbol)) return;
    setSelectedSymbolName(symbol);
    // On mobile, automatically switch to Chart tab
    setActiveTab('chart');
  }, []);

  // Synchronized entry timeframe change handler across chart and scanner engine
  const handleTimeframeChange = useCallback((tf: Timeframe) => {
    setSelectedTimeframe(tf);
    updateScannerConfig({ timeframe: tf });
    triggerScan(tf);
  }, [updateScannerConfig, triggerScan]);

  return (
    <div className="flex flex-col h-screen w-screen bg-[#070709] text-white overflow-hidden font-sans antialiased">
      {/* Top Header */}
      <Header
        status={connectionStatus}
        totalSymbols={totalSymbols}
        ticksPerSecond={ticksPerSecond}
        activeTab={activeTab}
        onTabChange={(tab) => {
          setActiveTab(tab);
          if (tab === 'scanner') setLeftPaneTab('scanner');
          if (tab === 'watchlist') setLeftPaneTab('watchlist');
        }}
        onReconnect={reconnectBackend}
        selectedAsset={selectedSymbolName}
      />

      {/* DESKTOP SPLIT LAYOUT (lg screens and above) */}
      <div className="hidden lg:flex flex-1 overflow-hidden">
        {/* Left Side: Watchlist & Scanner Pane (Width ~460px) */}
        <section className="w-[460px] xl:w-[500px] border-r border-[#181a24] bg-[#090a0e] flex flex-col shrink-0 overflow-hidden">
          {/* Left Pane Toggle Bar: Watchlist vs NWWT Scanner */}
          <div className="flex items-center border-b border-[#181a24] bg-[#0c0d12] p-1 shrink-0">
            <button
              onClick={() => setLeftPaneTab('watchlist')}
              className={`flex-1 py-1.5 px-3 rounded text-xs font-mono font-bold flex items-center justify-center gap-1.5 transition cursor-pointer ${
                leftPaneTab === 'watchlist'
                  ? 'bg-amber-500 text-black shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <BarChart2 className="w-3.5 h-3.5" />
              <span>Watchlist</span>
              <span className={`text-[10px] px-1.5 py-0.2 rounded font-normal ${leftPaneTab === 'watchlist' ? 'bg-black/20 text-black' : 'bg-[#151722] text-slate-400'}`}>
                {filteredAndSortedTickers.length}
              </span>
            </button>

            <button
              onClick={() => setLeftPaneTab('scanner')}
              className={`flex-1 py-1.5 px-3 rounded text-xs font-mono font-bold flex items-center justify-center gap-1.5 transition cursor-pointer ${
                leftPaneTab === 'scanner'
                  ? 'bg-amber-500 text-black shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Zap className="w-3.5 h-3.5" />
              <span>NWWT Scanner</span>
              {performanceStats.activeCount > 0 && (
                <span className={`text-[10px] px-1.5 py-0.2 rounded font-bold ${leftPaneTab === 'scanner' ? 'bg-black/20 text-black' : 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'}`}>
                  {performanceStats.activeCount}
                </span>
              )}
            </button>
          </div>

          {/* Left Pane Content */}
          <div className="flex-1 flex flex-col overflow-hidden">
            {leftPaneTab === 'watchlist' ? (
              <>
                <WatchlistToolbar
                  searchQuery={searchQuery}
                  onSearchChange={setSearchQuery}
                  selectedPreset={selectedPreset}
                  onPresetChange={setSelectedPreset}
                  filteredCount={filteredAndSortedTickers.length}
                  totalCount={tickersList.length}
                />
                <WatchlistTable
                  tickers={filteredAndSortedTickers}
                  sortConfig={sortConfig}
                  onSort={handleSort}
                  selectedSymbol={selectedSymbolName}
                  onSelectSymbol={(ticker) => handleSelectAsset(ticker.symbol)}
                />
              </>
            ) : (
              <WatchlistScannerPanel
                scannerState={scannerState}
                selectedAsset={selectedSymbolName}
                onSelectAsset={handleSelectAsset}
                onTimeframeChange={handleTimeframeChange}
                onTriggerScan={(tf) => triggerScan(tf || selectedTimeframe)}
                onUpdateScannerConfig={updateScannerConfig}
                performanceSignals={performanceSignals}
                activeSignals={activeSignals}
                completedSignals={completedSignals}
                performanceStats={performanceStats}
                onClearHistory={clearHistory}
              />
            )}
          </div>
        </section>

        {/* Right Side: Selected Asset Candlestick Chart (Flex 1) */}
        <section className="flex-1 flex flex-col bg-[#070709] overflow-hidden">
          <CandlestickChart
            key={`${selectedSymbolName}-${selectedTimeframe}`}
            symbol={selectedSymbolName || 'BTCUSDT'}
            ticker={selectedTicker}
            timeframe={selectedTimeframe}
            onTimeframeChange={handleTimeframeChange}
            onSelectSymbol={handleSelectAsset}
            allSymbols={tickersList}
            activeSignal={activeSignalForAsset}
          />
        </section>
      </div>

      {/* MOBILE STACKED LAYOUT (Screens < lg) */}
      <div className="flex-1 lg:hidden flex flex-col overflow-hidden relative">
        {/* Active Tab View */}
        {activeTab === 'watchlist' && (
          <div className="flex-1 flex flex-col overflow-hidden pb-14">
            <WatchlistToolbar
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
              selectedPreset={selectedPreset}
              onPresetChange={setSelectedPreset}
              filteredCount={filteredAndSortedTickers.length}
              totalCount={tickersList.length}
            />
            <WatchlistTable
              tickers={filteredAndSortedTickers}
              sortConfig={sortConfig}
              onSort={handleSort}
              selectedSymbol={selectedSymbolName}
              onSelectSymbol={(ticker) => handleSelectAsset(ticker.symbol)}
            />
          </div>
        )}

        {activeTab === 'scanner' && (
          <div className="flex-1 flex flex-col overflow-hidden pb-14">
            <WatchlistScannerPanel
              scannerState={scannerState}
              selectedAsset={selectedSymbolName}
              onSelectAsset={handleSelectAsset}
              onTimeframeChange={handleTimeframeChange}
              onTriggerScan={(tf) => triggerScan(tf || selectedTimeframe)}
              onUpdateScannerConfig={updateScannerConfig}
              performanceSignals={performanceSignals}
              activeSignals={activeSignals}
              completedSignals={completedSignals}
              performanceStats={performanceStats}
              onClearHistory={clearHistory}
            />
          </div>
        )}

        {activeTab === 'chart' && (
          <div className="flex-1 flex flex-col overflow-hidden pb-14">
            <CandlestickChart
              key={`${selectedSymbolName}-${selectedTimeframe}`}
              symbol={selectedSymbolName || 'BTCUSDT'}
              ticker={selectedTicker}
              timeframe={selectedTimeframe}
              onTimeframeChange={handleTimeframeChange}
              onSelectSymbol={handleSelectAsset}
              allSymbols={tickersList}
              activeSignal={activeSignalForAsset}
            />
          </div>
        )}

        {/* Sticky Bottom Navigation Bar for Mobile */}
        <div className="fixed bottom-0 left-0 right-0 h-14 bg-[#0a0a0e]/95 backdrop-blur-md border-t border-[#181a24] z-40 flex items-center justify-around px-2 select-none shadow-lg pb-safe">
          <button
            onClick={() => setActiveTab('watchlist')}
            className={`flex flex-col items-center justify-center flex-1 h-full py-1 transition cursor-pointer min-w-0 ${
              activeTab === 'watchlist' ? 'text-amber-400 font-bold' : 'text-slate-400 hover:text-white'
            }`}
          >
            <BarChart2 className="w-4 h-4 mb-0.5 shrink-0" />
            <span className="text-[10px] font-mono truncate">Watchlist</span>
          </button>

          <button
            onClick={() => setActiveTab('chart')}
            className={`flex flex-col items-center justify-center flex-1 h-full py-1 transition cursor-pointer min-w-0 ${
              activeTab === 'chart' ? 'text-amber-400 font-bold' : 'text-slate-400 hover:text-white'
            }`}
          >
            <TrendingUp className="w-4 h-4 mb-0.5 shrink-0" />
            <span className="text-[10px] font-mono truncate max-w-[90px]">
              {selectedSymbolName ? selectedSymbolName.replace(/USDT$/, '') : 'Chart'}
            </span>
          </button>

          <button
            onClick={() => setActiveTab('scanner')}
            className={`flex flex-col items-center justify-center flex-1 h-full py-1 transition cursor-pointer min-w-0 relative ${
              activeTab === 'scanner' ? 'text-amber-400 font-bold' : 'text-slate-400 hover:text-white'
            }`}
          >
            <div className="relative">
              <Zap className="w-4 h-4 mb-0.5 text-amber-400 shrink-0" />
              {scannerState.signals.length > 0 && (
                <span className="absolute -top-1 -right-2.5 w-2 h-2 rounded-full bg-emerald-400" />
              )}
            </div>
            <span className="text-[10px] font-mono truncate">Scanner</span>
          </button>
        </div>
      </div>
    </div>
  );
}
