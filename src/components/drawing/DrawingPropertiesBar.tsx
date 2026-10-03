/**
 * Responsive Drawing Settings & Properties System
 * - Desktop: Convenient floating properties pill clamped within chart viewport
 * - Mobile: Ergonomic touch-friendly Bottom Sheet with organized collapsible sections
 * - Immediate canvas redraw on any property change
 * - Full alert configuration & candle snapping controls
 */

import React, { useState, useEffect } from 'react';
import {
  Bell,
  Copy,
  Lock,
  Unlock,
  Trash2,
  Eye,
  EyeOff,
  Sparkles,
  Check,
  X,
  Sliders,
  Magnet,
  ChevronDown,
  ChevronUp,
  Maximize2,
  ArrowRightLeft,
  ArrowUpRight,
  ArrowDownRight,
  Repeat
} from 'lucide-react';
import { ChartDrawing, LineStyleType, AlertTriggerType, AlertDirection } from '../../types/drawings.ts';

interface DrawingPropertiesBarProps {
  drawing: ChartDrawing;
  onUpdate: (updates: Partial<ChartDrawing>) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onOpenAlertModal: () => void;
  onClose?: () => void;
  isSnapEnabled?: boolean;
  onToggleSnap?: () => void;
  timeframe?: string;
  symbol?: string;
  onAddAlert?: (alert: any) => void;
  onRemoveAlert?: (alertId: string) => void;
  onToggleAlert?: (alertId: string, enabled: boolean) => void;
}

const COLOR_PRESETS = [
  '#f59e0b', // Amber / Gold
  '#10b981', // Emerald Green
  '#ef4444', // Red
  '#3b82f6', // Blue
  '#8b5cf6', // Purple
  '#06b6d4', // Cyan
  '#ffffff', // White
  '#64748b'  // Slate Gray
];

export const DrawingPropertiesBar: React.FC<DrawingPropertiesBarProps> = ({
  drawing,
  onUpdate,
  onDuplicate,
  onDelete,
  onOpenAlertModal,
  onClose,
  isSnapEnabled = false,
  onToggleSnap,
  timeframe = '15m',
  symbol = 'BTCUSDT',
  onAddAlert,
  onRemoveAlert,
  onToggleAlert
}) => {
  const [showColorPicker, setShowColorPicker] = useState<boolean>(false);
  const [isMobileSheetOpen, setIsMobileSheetOpen] = useState<boolean>(false);
  const [isMobile, setIsMobile] = useState<boolean>(false);

  // Collapsible section state for mobile bottom sheet
  const [openSections, setOpenSections] = useState<{
    style: boolean;
    snapping: boolean;
    alerts: boolean;
    properties: boolean;
  }>({
    style: true,
    snapping: true,
    alerts: true,
    properties: false
  });

  // Track viewport size for mobile/desktop layout
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  const toggleSection = (key: keyof typeof openSections) => {
    setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  // Coordinate metrics
  const p1 = drawing.points[0];
  const p2 = drawing.points[1] || p1;
  const priceDiff = p2 ? p2.price - p1.price : 0;
  const pctDiff = p1 && p1.price ? ((priceDiff / p1.price) * 100).toFixed(2) : '0.00';

  return (
    <>
      {/* ============================================================== */}
      {/* 1. DESKTOP FLOATING PROPERTIES BAR (Visible on >= 768px)       */}
      {/* ============================================================== */}
      <div className="hidden md:flex absolute top-2.5 left-14 lg:left-16 z-30 max-w-[calc(100%-80px)] overflow-x-auto no-scrollbar items-center gap-1.5 p-1 rounded-lg bg-[#0e1017]/95 backdrop-blur-md border border-[#252838] shadow-2xl text-xs font-mono select-none animate-in fade-in zoom-in-95 duration-150">
        {/* Color Swatch */}
        <div className="relative">
          <button
            onClick={() => setShowColorPicker((prev) => !prev)}
            className="w-6 h-6 rounded border border-white/20 flex items-center justify-center cursor-pointer transition hover:scale-105"
            style={{ backgroundColor: drawing.color }}
            title="Change Drawing Color"
          />

          {showColorPicker && (
            <div className="absolute top-8 left-0 p-2 rounded bg-[#131622] border border-[#2b3044] shadow-2xl grid grid-cols-4 gap-1.5 z-50 animate-in fade-in duration-100">
              {COLOR_PRESETS.map((c) => (
                <button
                  key={c}
                  onClick={() => {
                    onUpdate({ color: c, glowColor: c });
                    setShowColorPicker(false);
                  }}
                  className="w-5 h-5 rounded-full border border-white/20 flex items-center justify-center transition hover:scale-110 cursor-pointer"
                  style={{ backgroundColor: c }}
                >
                  {drawing.color === c && <Check className="w-3 h-3 text-black stroke-[3]" />}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Line Thickness */}
        <div className="flex items-center bg-[#151824] rounded px-1 py-0.5 gap-1">
          {[1, 2, 3, 4].map((px) => (
            <button
              key={px}
              onClick={() => onUpdate({ thickness: px })}
              className={`px-1.5 py-0.5 rounded text-[10px] font-bold transition cursor-pointer ${
                drawing.thickness === px
                  ? 'bg-amber-500 text-black'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              {px}px
            </button>
          ))}
        </div>

        {/* Line Style */}
        <div className="flex items-center bg-[#151824] rounded px-1 py-0.5 gap-1">
          {(['solid', 'dashed', 'dotted'] as LineStyleType[]).map((st) => (
            <button
              key={st}
              onClick={() => onUpdate({ lineStyle: st })}
              className={`px-1.5 py-0.5 rounded text-[10px] capitalize transition cursor-pointer ${
                drawing.lineStyle === st
                  ? 'bg-amber-500 text-black font-bold'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              {st}
            </button>
          ))}
        </div>

        {/* Glow Effect Toggle */}
        <button
          onClick={() => onUpdate({ glow: !drawing.glow })}
          className={`px-1.5 py-1 rounded flex items-center gap-1 text-[10px] transition cursor-pointer ${
            drawing.glow
              ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
              : 'text-slate-400 hover:text-white bg-[#151824]'
          }`}
          title="Toggle Neon Glow"
        >
          <Sparkles className="w-3 h-3 text-amber-400" />
          <span>Glow</span>
        </button>

        {/* Wick Snapping Toggle */}
        {onToggleSnap && (
          <button
            onClick={onToggleSnap}
            className={`px-1.5 py-1 rounded flex items-center gap-1 text-[10px] transition cursor-pointer ${
              isSnapEnabled
                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                : 'text-slate-400 hover:text-white bg-[#151824]'
            }`}
            title={isSnapEnabled ? 'Candle Wick Snapping: ON' : 'Candle Wick Snapping: OFF'}
          >
            <Magnet className="w-3 h-3 text-cyan-400" />
            <span className="hidden xl:inline">Snap</span>
          </button>
        )}

        <div className="w-[1px] h-4 bg-[#232738] mx-0.5" />

        {/* Alert Trigger Button */}
        <button
          onClick={onOpenAlertModal}
          className="px-2 py-1 rounded bg-[#181c2e] hover:bg-[#20253d] border border-amber-500/40 text-amber-400 font-bold flex items-center gap-1 transition cursor-pointer"
          title="Create or configure alerts on this drawing"
        >
          <Bell className="w-3 h-3" />
          <span>Alert</span>
          {drawing.alerts && drawing.alerts.length > 0 && (
            <span className="px-1 py-0.2 rounded-full bg-amber-500 text-black text-[9px] font-bold">
              {drawing.alerts.length}
            </span>
          )}
        </button>

        {/* Lock / Unlock */}
        <button
          onClick={() => onUpdate({ locked: !drawing.locked })}
          className={`p-1.5 rounded transition cursor-pointer ${
            drawing.locked ? 'text-amber-400 bg-amber-500/10' : 'text-slate-400 hover:text-white'
          }`}
          title={drawing.locked ? 'Unlock Drawing' : 'Lock Drawing'}
        >
          {drawing.locked ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
        </button>

        {/* Duplicate */}
        <button
          onClick={onDuplicate}
          className="p-1.5 rounded text-slate-400 hover:text-white transition cursor-pointer"
          title="Duplicate Drawing"
        >
          <Copy className="w-3.5 h-3.5" />
        </button>

        {/* Full Settings Drawer trigger for Desktop */}
        <button
          onClick={() => setIsMobileSheetOpen(true)}
          className="p-1.5 rounded text-slate-400 hover:text-white hover:bg-[#1a1d2c] transition cursor-pointer"
          title="Open Full Properties Panel"
        >
          <Sliders className="w-3.5 h-3.5 text-amber-400" />
        </button>

        {/* Delete */}
        <button
          onClick={onDelete}
          className="p-1.5 rounded text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 transition cursor-pointer"
          title="Delete Drawing"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>

        {/* Close / Deselect */}
        {onClose && (
          <button
            onClick={onClose}
            className="p-1 rounded text-slate-400 hover:text-white transition cursor-pointer ml-0.5"
            title="Deselect Drawing (Esc)"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* ============================================================== */}
      {/* 2. MOBILE COMPACT DOCKED MINI-BAR (< 768px)                    */}
      {/* ============================================================== */}
      <div className="flex md:hidden absolute bottom-3 left-12 right-3 z-30 p-1.5 rounded-lg bg-[#0e1017]/95 backdrop-blur-md border border-[#252838] shadow-2xl items-center justify-between font-mono text-xs select-none">
        <div className="flex items-center gap-2 overflow-hidden flex-1 mr-2">
          <span
            className="w-3.5 h-3.5 rounded-full shrink-0 border border-white/20"
            style={{ backgroundColor: drawing.color }}
          />
          <span className="font-bold text-white text-xs truncate">
            {drawing.name}
          </span>
          {drawing.alerts && drawing.alerts.length > 0 && (
            <span className="px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-400 border border-amber-500/40 text-[9px] font-bold shrink-0">
              {drawing.alerts.length} alert{drawing.alerts.length > 1 ? 's' : ''}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={() => setIsMobileSheetOpen(true)}
            className="px-2.5 py-1 rounded bg-amber-500/20 text-amber-400 border border-amber-500/40 text-[11px] font-bold flex items-center gap-1 cursor-pointer transition active:scale-95"
          >
            <Sliders className="w-3 h-3" />
            <span>Settings</span>
          </button>

          <button
            onClick={onDelete}
            className="p-1.5 rounded text-rose-400 bg-rose-500/10 border border-rose-500/30 cursor-pointer transition"
            title="Delete Drawing"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>

          {onClose && (
            <button
              onClick={onClose}
              className="p-1.5 rounded text-slate-400 hover:text-white bg-[#151824] cursor-pointer"
              title="Close"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* ============================================================== */}
      {/* 3. RESPONSIVE MOBILE BOTTOM SHEET / SETTINGS DRAWER            */}
      {/* ============================================================== */}
      {isMobileSheetOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/75 backdrop-blur-xs select-none animate-in fade-in duration-200">
          {/* Backdrop Click */}
          <div className="absolute inset-0" onClick={() => setIsMobileSheetOpen(false)} />

          <div
            className="relative w-full max-w-lg bg-[#0c0e17] border-t border-[#26293a] shadow-2xl rounded-t-2xl flex flex-col max-h-[85vh] overflow-hidden text-white font-mono animate-in slide-in-from-bottom-5 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Sheet Handle */}
            <div className="pt-2.5 pb-1 flex justify-center">
              <div className="w-10 h-1 rounded-full bg-slate-600" />
            </div>

            {/* Sheet Header */}
            <div className="px-4 py-2 border-b border-[#1c1f2e] flex items-center justify-between bg-[#10121d]">
              <div className="flex items-center gap-2">
                <span
                  className="w-3 h-3 rounded-full"
                  style={{ backgroundColor: drawing.color }}
                />
                <div>
                  <h3 className="text-xs font-bold text-white uppercase">{drawing.name}</h3>
                  <span className="text-[10px] text-slate-400 uppercase">
                    {drawing.type.replace(/_/g, ' ')} • {symbol} ({timeframe})
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => setIsMobileSheetOpen(false)}
                  className="px-3 py-1 rounded bg-amber-500 text-black font-bold text-xs flex items-center gap-1 cursor-pointer transition active:scale-95"
                >
                  <Check className="w-3 h-3 stroke-[3]" />
                  <span>Done</span>
                </button>
                <button
                  onClick={() => setIsMobileSheetOpen(false)}
                  className="p-1 rounded text-slate-400 hover:text-white transition"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Scrollable Settings Body */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3.5 overscroll-contain pb-8">
              {/* SECTION 1: Line Style & Visual Appearance */}
              <div className="rounded-lg bg-[#11131c] border border-[#1f2233] overflow-hidden">
                <button
                  type="button"
                  onClick={() => toggleSection('style')}
                  className="w-full px-3 py-2 bg-[#141622] flex items-center justify-between text-xs font-bold text-slate-200 cursor-pointer"
                >
                  <span>Line Styling & Visuals</span>
                  {openSections.style ? <ChevronUp className="w-3.5 h-3.5 text-slate-400" /> : <ChevronDown className="w-3.5 h-3.5 text-slate-400" />}
                </button>

                {openSections.style && (
                  <div className="p-3 space-y-3 text-xs">
                    {/* Color Presets Grid */}
                    <div>
                      <label className="text-[10px] text-slate-400 block mb-1.5 uppercase font-bold">
                        Line & Accent Color
                      </label>
                      <div className="grid grid-cols-8 gap-2">
                        {COLOR_PRESETS.map((c) => (
                          <button
                            key={c}
                            onClick={() => onUpdate({ color: c, glowColor: c })}
                            className="h-8 rounded-lg border border-white/20 flex items-center justify-center transition active:scale-95 cursor-pointer"
                            style={{ backgroundColor: c }}
                          >
                            {drawing.color === c && <Check className="w-4 h-4 text-black stroke-[3]" />}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Thickness Selector */}
                    <div>
                      <label className="text-[10px] text-slate-400 block mb-1.5 uppercase font-bold">
                        Line Thickness
                      </label>
                      <div className="grid grid-cols-4 gap-1.5">
                        {[1, 2, 3, 4].map((px) => (
                          <button
                            key={px}
                            onClick={() => onUpdate({ thickness: px })}
                            className={`py-2 rounded font-bold transition cursor-pointer text-xs ${
                              drawing.thickness === px
                                ? 'bg-amber-500 text-black shadow-md'
                                : 'bg-[#181a26] text-slate-400 hover:text-white border border-[#23273a]'
                            }`}
                          >
                            {px}px
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Line Style (Solid, Dashed, Dotted) */}
                    <div>
                      <label className="text-[10px] text-slate-400 block mb-1.5 uppercase font-bold">
                        Line Pattern
                      </label>
                      <div className="grid grid-cols-3 gap-1.5">
                        {(['solid', 'dashed', 'dotted'] as LineStyleType[]).map((st) => (
                          <button
                            key={st}
                            onClick={() => onUpdate({ lineStyle: st })}
                            className={`py-2 rounded font-bold capitalize transition cursor-pointer text-xs ${
                              drawing.lineStyle === st
                                ? 'bg-amber-500 text-black shadow-md'
                                : 'bg-[#181a26] text-slate-400 hover:text-white border border-[#23273a]'
                            }`}
                          >
                            {st}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Glow Toggle */}
                    <div className="flex items-center justify-between pt-1">
                      <span className="text-slate-300 font-semibold">Neon Glow Effect</span>
                      <button
                        onClick={() => onUpdate({ glow: !drawing.glow })}
                        className={`px-3 py-1 rounded text-xs font-bold transition cursor-pointer ${
                          drawing.glow
                            ? 'bg-amber-500/20 text-amber-300 border border-amber-500/50'
                            : 'bg-[#181a26] text-slate-500 border border-[#23273a]'
                        }`}
                      >
                        {drawing.glow ? 'ENABLED' : 'DISABLED'}
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* SECTION 2: Snapping & Drawing Behavior */}
              <div className="rounded-lg bg-[#11131c] border border-[#1f2233] overflow-hidden">
                <button
                  type="button"
                  onClick={() => toggleSection('snapping')}
                  className="w-full px-3 py-2 bg-[#141622] flex items-center justify-between text-xs font-bold text-slate-200 cursor-pointer"
                >
                  <span>Wick Snapping & Lock State</span>
                  {openSections.snapping ? <ChevronUp className="w-3.5 h-3.5 text-slate-400" /> : <ChevronDown className="w-3.5 h-3.5 text-slate-400" />}
                </button>

                {openSections.snapping && (
                  <div className="p-3 space-y-2.5 text-xs">
                    {/* Wick Snapping Toggle */}
                    {onToggleSnap && (
                      <div className="flex items-center justify-between p-2 rounded bg-[#151824] border border-[#202334]">
                        <div>
                          <div className="text-slate-200 font-bold flex items-center gap-1.5">
                            <Magnet className="w-3.5 h-3.5 text-cyan-400" />
                            <span>Candle Wick Snapping</span>
                          </div>
                          <span className="text-[10px] text-slate-400">
                            Snap anchors precisely to high, low, open, close
                          </span>
                        </div>
                        <button
                          onClick={onToggleSnap}
                          className={`px-2.5 py-1 rounded text-xs font-bold transition cursor-pointer ${
                            isSnapEnabled
                              ? 'bg-cyan-500 text-black'
                              : 'bg-[#1f2233] text-slate-400'
                          }`}
                        >
                          {isSnapEnabled ? 'ON' : 'OFF'}
                        </button>
                      </div>
                    )}

                    {/* Lock Toggle */}
                    <div className="flex items-center justify-between p-2 rounded bg-[#151824] border border-[#202334]">
                      <div>
                        <div className="text-slate-200 font-bold flex items-center gap-1.5">
                          {drawing.locked ? <Lock className="w-3.5 h-3.5 text-amber-400" /> : <Unlock className="w-3.5 h-3.5 text-slate-400" />}
                          <span>Lock Drawing</span>
                        </div>
                        <span className="text-[10px] text-slate-400">
                          Prevent accidental dragging or repositioning
                        </span>
                      </div>
                      <button
                        onClick={() => onUpdate({ locked: !drawing.locked })}
                        className={`px-2.5 py-1 rounded text-xs font-bold transition cursor-pointer ${
                          drawing.locked
                            ? 'bg-amber-500 text-black'
                            : 'bg-[#1f2233] text-slate-400'
                        }`}
                      >
                        {drawing.locked ? 'LOCKED' : 'UNLOCKED'}
                      </button>
                    </div>

                    {/* Visibility Toggle */}
                    <div className="flex items-center justify-between p-2 rounded bg-[#151824] border border-[#202334]">
                      <div>
                        <div className="text-slate-200 font-bold flex items-center gap-1.5">
                          {drawing.visible ? <Eye className="w-3.5 h-3.5 text-emerald-400" /> : <EyeOff className="w-3.5 h-3.5 text-slate-500" />}
                          <span>Visibility</span>
                        </div>
                        <span className="text-[10px] text-slate-400">
                          Show or hide this object on the chart
                        </span>
                      </div>
                      <button
                        onClick={() => onUpdate({ visible: !drawing.visible })}
                        className={`px-2.5 py-1 rounded text-xs font-bold transition cursor-pointer ${
                          drawing.visible
                            ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                            : 'bg-[#1f2233] text-slate-500'
                        }`}
                      >
                        {drawing.visible ? 'VISIBLE' : 'HIDDEN'}
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* SECTION 3: Drawing Alerts Management */}
              <div className="rounded-lg bg-[#11131c] border border-[#1f2233] overflow-hidden">
                <button
                  type="button"
                  onClick={() => toggleSection('alerts')}
                  className="w-full px-3 py-2 bg-[#141622] flex items-center justify-between text-xs font-bold text-slate-200 cursor-pointer"
                >
                  <div className="flex items-center gap-1.5">
                    <Bell className="w-3.5 h-3.5 text-amber-400" />
                    <span>Drawing Alerts ({drawing.alerts?.length || 0})</span>
                  </div>
                  {openSections.alerts ? <ChevronUp className="w-3.5 h-3.5 text-slate-400" /> : <ChevronDown className="w-3.5 h-3.5 text-slate-400" />}
                </button>

                {openSections.alerts && (
                  <div className="p-3 space-y-2.5 text-xs">
                    {drawing.alerts && drawing.alerts.length > 0 ? (
                      <div className="space-y-1.5">
                        {drawing.alerts.map((al) => (
                          <div
                            key={al.id}
                            className="p-2 rounded bg-[#151824] border border-[#202334] flex items-center justify-between"
                          >
                            <div>
                              <div className="font-bold text-white capitalize text-xs">
                                {al.type.replace(/_/g, ' ')}
                              </div>
                              <div className="text-[10px] text-slate-400">
                                Direction: {al.direction} • {al.repeat ? 'Recurring' : 'Once'}
                              </div>
                            </div>

                            <div className="flex items-center gap-1.5">
                              {onToggleAlert && (
                                <button
                                  onClick={() => onToggleAlert(al.id, !al.enabled)}
                                  className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                    al.enabled ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-800 text-slate-500'
                                  }`}
                                >
                                  {al.enabled ? 'ACTIVE' : 'PAUSED'}
                                </button>
                              )}
                              {onRemoveAlert && (
                                <button
                                  onClick={() => onRemoveAlert(al.id)}
                                  className="p-1 text-slate-500 hover:text-rose-400"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-center py-2 text-slate-500 text-[11px]">
                        No active alerts set on this drawing yet.
                      </div>
                    )}

                    <button
                      type="button"
                      onClick={() => {
                        setIsMobileSheetOpen(false);
                        onOpenAlertModal();
                      }}
                      className="w-full py-2 rounded bg-[#181c2e] hover:bg-[#20253d] border border-amber-500/40 text-amber-400 font-bold flex items-center justify-center gap-1.5 transition cursor-pointer text-xs shadow-sm"
                    >
                      <Bell className="w-3.5 h-3.5" />
                      <span>Configure New Alert</span>
                    </button>
                  </div>
                )}
              </div>

              {/* SECTION 4: Coordinates & Geometry Data */}
              <div className="rounded-lg bg-[#11131c] border border-[#1f2233] overflow-hidden">
                <button
                  type="button"
                  onClick={() => toggleSection('properties')}
                  className="w-full px-3 py-2 bg-[#141622] flex items-center justify-between text-xs font-bold text-slate-200 cursor-pointer"
                >
                  <span>Anchor Coordinates & Metrics</span>
                  {openSections.properties ? <ChevronUp className="w-3.5 h-3.5 text-slate-400" /> : <ChevronDown className="w-3.5 h-3.5 text-slate-400" />}
                </button>

                {openSections.properties && (
                  <div className="p-3 space-y-2 text-xs font-mono text-slate-300">
                    <div className="flex items-center justify-between p-1.5 rounded bg-[#151824]">
                      <span className="text-slate-400 text-[11px]">Anchor Point 1:</span>
                      <span className="text-amber-400 font-bold">${p1 ? p1.price.toFixed(2) : '--'}</span>
                    </div>
                    {drawing.points.length > 1 && (
                      <div className="flex items-center justify-between p-1.5 rounded bg-[#151824]">
                        <span className="text-slate-400 text-[11px]">Anchor Point 2:</span>
                        <span className="text-amber-400 font-bold">${p2 ? p2.price.toFixed(2) : '--'}</span>
                      </div>
                    )}
                    {drawing.points.length > 1 && (
                      <div className="flex items-center justify-between p-1.5 rounded bg-[#151824]">
                        <span className="text-slate-400 text-[11px]">Price Span:</span>
                        <span className={priceDiff >= 0 ? 'text-emerald-400 font-bold' : 'text-rose-400 font-bold'}>
                          {priceDiff >= 0 ? '+' : ''}${priceDiff.toFixed(2)} ({pctDiff}%)
                        </span>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* SECTION 5: Important Actions */}
              <div className="grid grid-cols-2 gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => {
                    onDuplicate();
                    setIsMobileSheetOpen(false);
                  }}
                  className="py-2.5 rounded bg-[#161926] hover:bg-[#1e2233] border border-[#2b3046] text-slate-200 font-bold text-xs flex items-center justify-center gap-1.5 transition cursor-pointer"
                >
                  <Copy className="w-3.5 h-3.5 text-slate-400" />
                  <span>Duplicate</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    onDelete();
                    setIsMobileSheetOpen(false);
                  }}
                  className="py-2.5 rounded bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 text-rose-400 font-bold text-xs flex items-center justify-center gap-1.5 transition cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Delete</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
