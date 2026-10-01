/**
 * Professional Drawing Tools Toolbar (Left Panel)
 * NWWT Black and Gold Theme with Compact Glowing Icons
 */

import React, { useState } from 'react';
import {
  MousePointer,
  TrendingUp,
  Minus,
  MoveRight,
  Maximize2,
  Sliders,
  Activity,
  Layers,
  Square,
  BoxSelect,
  Undo2,
  Redo2,
  Bell,
  Trash2,
  Eye,
  EyeOff,
  ChevronRight,
  ChevronDown
} from 'lucide-react';
import { DrawingToolType } from '../../types/drawings.ts';

interface DrawingToolbarProps {
  activeTool: DrawingToolType;
  onSelectTool: (tool: DrawingToolType) => void;
  drawingsCount: number;
  activeAlertsCount: number;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onOpenManager: () => void;
  onOpenAlerts: () => void;
  onClearAll: () => void;
  areAllVisible?: boolean;
  onToggleAllVisibility?: () => void;
}

export const DrawingToolbar: React.FC<DrawingToolbarProps> = ({
  activeTool,
  onSelectTool,
  drawingsCount,
  activeAlertsCount,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onOpenManager,
  onOpenAlerts,
  onClearAll,
  areAllVisible = true,
  onToggleAllVisibility
}) => {
  // Sub-menu popout state
  const [activeFlyout, setActiveFlyout] = useState<'lines' | 'fib' | 'shapes' | null>(null);

  const toggleFlyout = (menu: 'lines' | 'fib' | 'shapes') => {
    setActiveFlyout((prev) => (prev === menu ? null : menu));
  };

  const isLinesActive = [
    'trendline',
    'horizontal_line',
    'horizontal_ray',
    'extended_line',
    'vertical_line'
  ].includes(activeTool);

  const isFibActive = ['fibonacci_retracement', 'fibonacci_extension'].includes(activeTool);
  const isShapesActive = ['parallel_channel', 'rectangle', 'price_zone'].includes(activeTool);

  return (
    <div className="relative flex flex-col items-center bg-[#0a0b10] border-r border-[#1a1d28] py-2 px-1 text-slate-400 select-none z-20 shrink-0 w-10 sm:w-11">
      {/* 1. Cursor / Selection Pointer */}
      <button
        onClick={() => {
          onSelectTool('cursor');
          setActiveFlyout(null);
        }}
        className={`w-8 h-8 rounded flex items-center justify-center transition cursor-pointer mb-1 relative group ${
          activeTool === 'cursor'
            ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40 shadow-[0_0_8px_rgba(245,158,11,0.3)]'
            : 'hover:bg-[#151722] hover:text-white'
        }`}
        title="Cursor / Selection Tool"
      >
        <MousePointer className="w-4 h-4" />
        <span className="hidden group-hover:block absolute left-10 ml-1 px-2 py-0.5 rounded bg-[#181a26] text-white text-[10px] whitespace-nowrap border border-[#2b2f42] z-50 pointer-events-none">
          Pointer (Select & Move)
        </span>
      </button>

      <div className="w-6 h-[1px] bg-[#1a1d28] my-1" />

      {/* 2. Lines & Rays Tools Group */}
      <div className="relative group">
        <button
          onClick={() => toggleFlyout('lines')}
          className={`w-8 h-8 rounded flex items-center justify-center transition cursor-pointer relative ${
            isLinesActive
              ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40 shadow-[0_0_8px_rgba(245,158,11,0.3)]'
              : 'hover:bg-[#151722] hover:text-white'
          }`}
          title="Trendlines & Support/Resistance"
        >
          <TrendingUp className="w-4 h-4" />
          <span className="absolute bottom-0.5 right-0.5 w-1 h-1 bg-amber-400 rounded-full" />
        </button>

        {/* Lines Flyout Submenu */}
        {activeFlyout === 'lines' && (
          <div className="absolute left-10 top-0 ml-1.5 p-1 rounded bg-[#0f111a] border border-[#262a3d] shadow-xl flex flex-col gap-1 w-44 z-50">
            <span className="text-[9px] font-mono text-slate-500 px-2 py-0.5 uppercase border-b border-[#1d2030]">
              Lines & Rays
            </span>
            <button
              onClick={() => {
                onSelectTool('trendline');
                setActiveFlyout(null);
              }}
              className={`flex items-center gap-2 px-2 py-1.5 rounded text-xs font-mono transition text-left cursor-pointer ${
                activeTool === 'trendline' ? 'bg-amber-500/20 text-amber-300 font-bold' : 'hover:bg-[#181a26] text-slate-300'
              }`}
            >
              <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
              <span>Trendline</span>
            </button>
            <button
              onClick={() => {
                onSelectTool('horizontal_line');
                setActiveFlyout(null);
              }}
              className={`flex items-center gap-2 px-2 py-1.5 rounded text-xs font-mono transition text-left cursor-pointer ${
                activeTool === 'horizontal_line' ? 'bg-amber-500/20 text-amber-300 font-bold' : 'hover:bg-[#181a26] text-slate-300'
              }`}
            >
              <Minus className="w-3.5 h-3.5 text-amber-400" />
              <span>Horizontal Line (S/R)</span>
            </button>
            <button
              onClick={() => {
                onSelectTool('horizontal_ray');
                setActiveFlyout(null);
              }}
              className={`flex items-center gap-2 px-2 py-1.5 rounded text-xs font-mono transition text-left cursor-pointer ${
                activeTool === 'horizontal_ray' ? 'bg-amber-500/20 text-amber-300 font-bold' : 'hover:bg-[#181a26] text-slate-300'
              }`}
            >
              <MoveRight className="w-3.5 h-3.5 text-sky-400" />
              <span>Horizontal Ray</span>
            </button>
            <button
              onClick={() => {
                onSelectTool('extended_line');
                setActiveFlyout(null);
              }}
              className={`flex items-center gap-2 px-2 py-1.5 rounded text-xs font-mono transition text-left cursor-pointer ${
                activeTool === 'extended_line' ? 'bg-amber-500/20 text-amber-300 font-bold' : 'hover:bg-[#181a26] text-slate-300'
              }`}
            >
              <Maximize2 className="w-3.5 h-3.5 text-purple-400" />
              <span>Extended Line</span>
            </button>
            <button
              onClick={() => {
                onSelectTool('vertical_line');
                setActiveFlyout(null);
              }}
              className={`flex items-center gap-2 px-2 py-1.5 rounded text-xs font-mono transition text-left cursor-pointer ${
                activeTool === 'vertical_line' ? 'bg-amber-500/20 text-amber-300 font-bold' : 'hover:bg-[#181a26] text-slate-300'
              }`}
            >
              <Minus className="w-3.5 h-3.5 text-slate-400 rotate-90" />
              <span>Vertical Line</span>
            </button>
          </div>
        )}
      </div>

      {/* 3. Fibonacci Group */}
      <div className="relative group my-1">
        <button
          onClick={() => toggleFlyout('fib')}
          className={`w-8 h-8 rounded flex items-center justify-center transition cursor-pointer relative ${
            isFibActive
              ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40 shadow-[0_0_8px_rgba(245,158,11,0.3)]'
              : 'hover:bg-[#151722] hover:text-white'
          }`}
          title="Fibonacci Retracement & Extension"
        >
          <Activity className="w-4 h-4" />
          <span className="absolute bottom-0.5 right-0.5 w-1 h-1 bg-amber-400 rounded-full" />
        </button>

        {activeFlyout === 'fib' && (
          <div className="absolute left-10 top-0 ml-1.5 p-1 rounded bg-[#0f111a] border border-[#262a3d] shadow-xl flex flex-col gap-1 w-44 z-50">
            <span className="text-[9px] font-mono text-slate-500 px-2 py-0.5 uppercase border-b border-[#1d2030]">
              Fibonacci Tools
            </span>
            <button
              onClick={() => {
                onSelectTool('fibonacci_retracement');
                setActiveFlyout(null);
              }}
              className={`flex items-center gap-2 px-2 py-1.5 rounded text-xs font-mono transition text-left cursor-pointer ${
                activeTool === 'fibonacci_retracement' ? 'bg-amber-500/20 text-amber-300 font-bold' : 'hover:bg-[#181a26] text-slate-300'
              }`}
            >
              <Activity className="w-3.5 h-3.5 text-amber-400" />
              <span>Fib Retracement</span>
            </button>
            <button
              onClick={() => {
                onSelectTool('fibonacci_extension');
                setActiveFlyout(null);
              }}
              className={`flex items-center gap-2 px-2 py-1.5 rounded text-xs font-mono transition text-left cursor-pointer ${
                activeTool === 'fibonacci_extension' ? 'bg-amber-500/20 text-amber-300 font-bold' : 'hover:bg-[#181a26] text-slate-300'
              }`}
            >
              <Activity className="w-3.5 h-3.5 text-sky-400" />
              <span>Fib Extension</span>
            </button>
          </div>
        )}
      </div>

      {/* 4. Shapes & Price Zones Group */}
      <div className="relative group mb-1">
        <button
          onClick={() => toggleFlyout('shapes')}
          className={`w-8 h-8 rounded flex items-center justify-center transition cursor-pointer relative ${
            isShapesActive
              ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40 shadow-[0_0_8px_rgba(245,158,11,0.3)]'
              : 'hover:bg-[#151722] hover:text-white'
          }`}
          title="Channels & Price Zones"
        >
          <BoxSelect className="w-4 h-4" />
          <span className="absolute bottom-0.5 right-0.5 w-1 h-1 bg-amber-400 rounded-full" />
        </button>

        {activeFlyout === 'shapes' && (
          <div className="absolute left-10 top-0 ml-1.5 p-1 rounded bg-[#0f111a] border border-[#262a3d] shadow-xl flex flex-col gap-1 w-44 z-50">
            <span className="text-[9px] font-mono text-slate-500 px-2 py-0.5 uppercase border-b border-[#1d2030]">
              Zones & Channels
            </span>
            <button
              onClick={() => {
                onSelectTool('price_zone');
                setActiveFlyout(null);
              }}
              className={`flex items-center gap-2 px-2 py-1.5 rounded text-xs font-mono transition text-left cursor-pointer ${
                activeTool === 'price_zone' ? 'bg-amber-500/20 text-amber-300 font-bold' : 'hover:bg-[#181a26] text-slate-300'
              }`}
            >
              <BoxSelect className="w-3.5 h-3.5 text-blue-400" />
              <span>Support/Resist Zone</span>
            </button>
            <button
              onClick={() => {
                onSelectTool('rectangle');
                setActiveFlyout(null);
              }}
              className={`flex items-center gap-2 px-2 py-1.5 rounded text-xs font-mono transition text-left cursor-pointer ${
                activeTool === 'rectangle' ? 'bg-amber-500/20 text-amber-300 font-bold' : 'hover:bg-[#181a26] text-slate-300'
              }`}
            >
              <Square className="w-3.5 h-3.5 text-purple-400" />
              <span>Rectangle</span>
            </button>
            <button
              onClick={() => {
                onSelectTool('parallel_channel');
                setActiveFlyout(null);
              }}
              className={`flex items-center gap-2 px-2 py-1.5 rounded text-xs font-mono transition text-left cursor-pointer ${
                activeTool === 'parallel_channel' ? 'bg-amber-500/20 text-amber-300 font-bold' : 'hover:bg-[#181a26] text-slate-300'
              }`}
            >
              <Layers className="w-3.5 h-3.5 text-amber-400" />
              <span>Parallel Channel</span>
            </button>
          </div>
        )}
      </div>

      <div className="w-6 h-[1px] bg-[#1a1d28] my-1" />

      {/* 5. Alerts Center */}
      <button
        onClick={() => {
          setActiveFlyout(null);
          onOpenAlerts();
        }}
        className="w-8 h-8 rounded flex items-center justify-center transition cursor-pointer hover:bg-[#151722] hover:text-white text-slate-400 relative group"
        title="Drawing Alerts Manager"
      >
        <Bell className="w-4 h-4 text-amber-400" />
        {activeAlertsCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[14px] h-[14px] rounded-full bg-amber-500 text-black text-[9px] font-bold font-mono flex items-center justify-center px-0.5">
            {activeAlertsCount}
          </span>
        )}
        <span className="hidden group-hover:block absolute left-10 ml-1 px-2 py-0.5 rounded bg-[#181a26] text-white text-[10px] whitespace-nowrap border border-[#2b2f42] z-50 pointer-events-none">
          Alerts Manager ({activeAlertsCount} active)
        </span>
      </button>

      {/* 6. Object Tree / Drawings Manager */}
      <button
        onClick={() => {
          setActiveFlyout(null);
          onOpenManager();
        }}
        className="w-8 h-8 rounded flex items-center justify-center transition cursor-pointer hover:bg-[#151722] hover:text-white text-slate-400 relative group my-1"
        title="Drawings Object Tree"
      >
        <Sliders className="w-4 h-4" />
        {drawingsCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[14px] h-[14px] rounded-full bg-[#202538] text-slate-300 border border-[#303850] text-[9px] font-mono flex items-center justify-center px-0.5">
            {drawingsCount}
          </span>
        )}
        <span className="hidden group-hover:block absolute left-10 ml-1 px-2 py-0.5 rounded bg-[#181a26] text-white text-[10px] whitespace-nowrap border border-[#2b2f42] z-50 pointer-events-none">
          Drawings List ({drawingsCount})
        </span>
      </button>

      {/* 7. Toggle Visibility of all drawings */}
      {onToggleAllVisibility && drawingsCount > 0 && (
        <button
          onClick={onToggleAllVisibility}
          className="w-8 h-8 rounded flex items-center justify-center transition cursor-pointer hover:bg-[#151722] hover:text-white text-slate-400 relative group mb-1"
          title={areAllVisible ? 'Hide all drawings' : 'Show all drawings'}
        >
          {areAllVisible ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5 text-slate-600" />}
        </button>
      )}

      {/* 8. Undo / Redo */}
      <div className="mt-auto flex flex-col items-center gap-1 pt-1 border-t border-[#1a1d28]">
        <button
          onClick={onUndo}
          disabled={!canUndo}
          className="w-7 h-7 rounded flex items-center justify-center transition disabled:opacity-25 hover:bg-[#151722] hover:text-white text-slate-400 cursor-pointer disabled:cursor-not-allowed"
          title="Undo (Ctrl+Z)"
        >
          <Undo2 className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={onRedo}
          disabled={!canRedo}
          className="w-7 h-7 rounded flex items-center justify-center transition disabled:opacity-25 hover:bg-[#151722] hover:text-white text-slate-400 cursor-pointer disabled:cursor-not-allowed"
          title="Redo (Ctrl+Y)"
        >
          <Redo2 className="w-3.5 h-3.5" />
        </button>
        {drawingsCount > 0 && (
          <button
            onClick={onClearAll}
            className="w-7 h-7 rounded flex items-center justify-center transition hover:bg-rose-500/20 hover:text-rose-400 text-slate-500 cursor-pointer mt-1"
            title="Clear all drawings on this asset"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  );
};
