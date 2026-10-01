/**
 * Floating Properties Bar for Selected Drawing
 * Allows instant customization of color, thickness, line style, glow, alerts, and actions
 */

import React, { useState } from 'react';
import {
  Bell,
  Copy,
  Lock,
  Unlock,
  Trash2,
  Eye,
  EyeOff,
  Sparkles,
  Check
} from 'lucide-react';
import { ChartDrawing, LineStyleType } from '../../types/drawings.ts';

interface DrawingPropertiesBarProps {
  drawing: ChartDrawing;
  onUpdate: (updates: Partial<ChartDrawing>) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onOpenAlertModal: () => void;
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
  onOpenAlertModal
}) => {
  const [showColorPicker, setShowColorPicker] = useState<boolean>(false);

  return (
    <div className="absolute top-2 left-14 z-30 flex items-center gap-1.5 p-1 rounded-md bg-[#0e1017]/95 backdrop-blur-md border border-[#252838] shadow-2xl text-xs font-mono select-none animate-in fade-in zoom-in-95 duration-150">
      {/* 1. Color Swatch */}
      <div className="relative">
        <button
          onClick={() => setShowColorPicker((prev) => !prev)}
          className="w-6 h-6 rounded border border-white/20 flex items-center justify-center cursor-pointer transition hover:scale-105"
          style={{ backgroundColor: drawing.color }}
          title="Change Color"
        />

        {showColorPicker && (
          <div className="absolute top-8 left-0 p-2 rounded bg-[#131622] border border-[#2b3044] shadow-2xl grid grid-cols-4 gap-1.5 z-50">
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

      {/* 2. Line Thickness Selector */}
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

      {/* 3. Line Style (Solid, Dashed, Dotted) */}
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

      {/* 4. Glow Effect Toggle */}
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
        <span className="hidden sm:inline">Glow</span>
      </button>

      <div className="w-[1px] h-4 bg-[#232738] mx-0.5" />

      {/* 5. Alert Trigger Button */}
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

      {/* 6. Lock / Unlock */}
      <button
        onClick={() => onUpdate({ locked: !drawing.locked })}
        className={`p-1.5 rounded transition cursor-pointer ${
          drawing.locked ? 'text-amber-400 bg-amber-500/10' : 'text-slate-400 hover:text-white'
        }`}
        title={drawing.locked ? 'Unlock Drawing' : 'Lock Drawing'}
      >
        {drawing.locked ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
      </button>

      {/* 7. Duplicate */}
      <button
        onClick={onDuplicate}
        className="p-1.5 rounded text-slate-400 hover:text-white transition cursor-pointer"
        title="Duplicate Drawing"
      >
        <Copy className="w-3.5 h-3.5" />
      </button>

      {/* 8. Delete */}
      <button
        onClick={onDelete}
        className="p-1.5 rounded text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 transition cursor-pointer"
        title="Delete Drawing"
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  );
};
