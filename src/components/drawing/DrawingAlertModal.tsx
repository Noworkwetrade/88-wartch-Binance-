/**
 * Drawing Alert Configuration Modal
 * Configures touch, cross, and confirmation rejection alerts for an individual drawing
 */

import React, { useState } from 'react';
import {
  X,
  Bell,
  CheckCircle2,
  AlertTriangle,
  ArrowUpRight,
  ArrowDownRight,
  ArrowRightLeft,
  Trash2,
  Clock,
  Repeat
} from 'lucide-react';
import { ChartDrawing, DrawingAlert, AlertTriggerType, AlertDirection } from '../../types/drawings.ts';

interface DrawingAlertModalProps {
  drawing: ChartDrawing;
  timeframe: string;
  symbol: string;
  onClose: () => void;
  onAddAlert: (alert: Omit<DrawingAlert, 'id' | 'drawingId' | 'createdAt'>) => void;
  onRemoveAlert: (alertId: string) => void;
  onToggleAlert: (alertId: string, enabled: boolean) => void;
}

export const DrawingAlertModal: React.FC<DrawingAlertModalProps> = ({
  drawing,
  timeframe,
  symbol,
  onClose,
  onAddAlert,
  onRemoveAlert,
  onToggleAlert
}) => {
  const [triggerType, setTriggerType] = useState<AlertTriggerType>('price_cross');
  const [direction, setDirection] = useState<AlertDirection>('any');
  const [tolerancePercent, setTolerancePercent] = useState<number>(0.15);
  const [rejectionBufferPercent, setRejectionBufferPercent] = useState<number>(0.25);
  const [repeat, setRepeat] = useState<boolean>(true);
  const [cooldownMinutes, setCooldownMinutes] = useState<number>(5);
  const [customMessage, setCustomMessage] = useState<string>('');

  const handleCreateAlert = (e: React.FormEvent) => {
    e.preventDefault();
    onAddAlert({
      asset: symbol,
      timeframe,
      type: triggerType,
      direction,
      tolerancePercent,
      rejectionBufferPercent: triggerType === 'price_rejection' ? rejectionBufferPercent : undefined,
      cooldownMs: cooldownMinutes * 60 * 1000,
      repeat,
      enabled: true,
      message: customMessage.trim() || undefined
    });

    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4 select-none animate-in fade-in duration-150">
      <div className="w-full max-w-md rounded-lg bg-[#0e1017] border border-[#26293a] shadow-2xl text-white font-mono flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-4 py-3 bg-[#12141f] border-b border-[#202333] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400">
              <Bell className="w-3.5 h-3.5" />
            </div>
            <div>
              <h3 className="text-xs font-bold text-white">Create Drawing Alert</h3>
              <p className="text-[10px] text-slate-400">
                {drawing.name} • {symbol} ({timeframe})
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded text-slate-400 hover:text-white hover:bg-[#1c1f2e] transition cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleCreateAlert} className="p-4 space-y-3.5 overflow-y-auto max-h-[80vh]">
          {/* 1. Alert Trigger Type */}
          <div>
            <label className="text-[11px] font-bold text-slate-300 block mb-1.5 uppercase">
              Alert Trigger Condition
            </label>
            <div className="grid grid-cols-3 gap-1.5 text-xs">
              {[
                { id: 'price_cross', label: 'Price Cross', desc: 'Crosses line' },
                { id: 'price_touch', label: 'Price Touch', desc: 'Reaches level' },
                { id: 'price_rejection', label: 'Price Rejection', desc: 'Bounce & confirm' }
              ].map((t) => (
                <button
                  type="button"
                  key={t.id}
                  onClick={() => setTriggerType(t.id as AlertTriggerType)}
                  className={`p-2 rounded border text-left transition cursor-pointer flex flex-col justify-between ${
                    triggerType === t.id
                      ? 'bg-amber-500/15 border-amber-500/50 text-amber-300 font-bold'
                      : 'bg-[#131520] border-[#1f2233] text-slate-400 hover:text-white'
                  }`}
                >
                  <span className="text-[11px] leading-tight">{t.label}</span>
                  <span className="text-[9px] text-slate-500 font-sans mt-0.5">{t.desc}</span>
                </button>
              ))}
            </div>
          </div>

          {/* 2. Direction Selection (For Cross & Rejection) */}
          {(triggerType === 'price_cross' || triggerType === 'price_rejection') && (
            <div>
              <label className="text-[11px] font-bold text-slate-300 block mb-1.5 uppercase">
                Trigger Direction
              </label>
              <div className="grid grid-cols-3 gap-1.5 text-xs">
                {[
                  { id: 'any', label: 'Any Direction', icon: ArrowRightLeft },
                  { id: 'crossing_up', label: 'Crossing Up', icon: ArrowUpRight },
                  { id: 'crossing_down', label: 'Crossing Down', icon: ArrowDownRight }
                ].map((d) => {
                  const Icon = d.icon;
                  return (
                    <button
                      type="button"
                      key={d.id}
                      onClick={() => setDirection(d.id as AlertDirection)}
                      className={`p-2 rounded border transition cursor-pointer flex items-center justify-center gap-1.5 ${
                        direction === d.id
                          ? 'bg-amber-500/15 border-amber-500/50 text-amber-300 font-bold'
                          : 'bg-[#131520] border-[#1f2233] text-slate-400 hover:text-white'
                      }`}
                    >
                      <Icon className="w-3.5 h-3.5" />
                      <span className="text-[10.5px]">{d.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* 3. Rejection Confirmation Buffer */}
          {triggerType === 'price_rejection' && (
            <div className="p-2.5 rounded bg-[#131520] border border-[#24283b] space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-300 font-semibold">Rejection Confirmation Buffer:</span>
                <span className="text-amber-400 font-bold">{rejectionBufferPercent}%</span>
              </div>
              <p className="text-[10px] text-slate-500 leading-tight">
                Requires price to touch the drawing and subsequently move away by at least {rejectionBufferPercent}% to confirm genuine structural rejection.
              </p>
              <input
                type="range"
                min="0.1"
                max="1.0"
                step="0.05"
                value={rejectionBufferPercent}
                onChange={(e) => setRejectionBufferPercent(parseFloat(e.target.value))}
                className="w-full accent-amber-500 cursor-pointer"
              />
            </div>
          )}

          {/* 4. Touch Tolerance */}
          <div className="p-2.5 rounded bg-[#131520] border border-[#24283b] space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-300 font-semibold">Price Proximity Tolerance:</span>
              <span className="text-amber-400 font-bold">{tolerancePercent}%</span>
            </div>
            <input
              type="range"
              min="0.05"
              max="0.5"
              step="0.05"
              value={tolerancePercent}
              onChange={(e) => setTolerancePercent(parseFloat(e.target.value))}
              className="w-full accent-amber-500 cursor-pointer"
            />
          </div>

          {/* 5. Repeat & Cooldown Controls */}
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="p-2 rounded bg-[#131520] border border-[#1f2233]">
              <label className="text-[10px] text-slate-400 block mb-1 uppercase">Repeat Alert</label>
              <button
                type="button"
                onClick={() => setRepeat((prev) => !prev)}
                className={`w-full py-1.5 rounded flex items-center justify-center gap-1.5 font-bold transition cursor-pointer ${
                  repeat
                    ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                    : 'bg-[#1b1e2c] text-slate-400 border border-[#2a2e42]'
                }`}
              >
                <Repeat className="w-3.5 h-3.5" />
                <span>{repeat ? 'Repeats on Cross' : 'Trigger Once'}</span>
              </button>
            </div>

            <div className="p-2 rounded bg-[#131520] border border-[#1f2233]">
              <label className="text-[10px] text-slate-400 block mb-1 uppercase">Cooldown Time</label>
              <div className="flex items-center gap-1">
                {[1, 5, 15, 60].map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setCooldownMinutes(m)}
                    className={`flex-1 py-1 rounded text-[10px] font-bold transition cursor-pointer ${
                      cooldownMinutes === m
                        ? 'bg-amber-500 text-black'
                        : 'bg-[#1b1e2c] text-slate-400 hover:text-white'
                    }`}
                  >
                    {m}m
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* 6. Existing Alerts on this Drawing */}
          {drawing.alerts && drawing.alerts.length > 0 && (
            <div className="pt-2 border-t border-[#1f2233]">
              <span className="text-[10px] text-slate-400 uppercase font-bold block mb-1.5">
                Active Alerts on this Drawing ({drawing.alerts.length})
              </span>
              <div className="space-y-1.5 max-h-32 overflow-y-auto">
                {drawing.alerts.map((al) => (
                  <div
                    key={al.id}
                    className="p-2 rounded bg-[#12141f] border border-[#202333] flex items-center justify-between text-xs"
                  >
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => onToggleAlert(al.id, !al.enabled)}
                        className={`w-3.5 h-3.5 rounded-full border cursor-pointer transition ${
                          al.enabled ? 'bg-emerald-500 border-emerald-400' : 'bg-slate-700 border-slate-600'
                        }`}
                        title={al.enabled ? 'Pause Alert' : 'Enable Alert'}
                      />
                      <span className="capitalize font-semibold text-slate-200">
                        {al.type.replace(/_/g, ' ')}
                      </span>
                      <span className="text-[10px] text-slate-500">
                        {al.direction !== 'any' ? `(${al.direction.replace(/_/g, ' ')})` : ''}
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={() => onRemoveAlert(al.id)}
                      className="text-slate-500 hover:text-rose-400 p-1 cursor-pointer transition"
                      title="Delete Alert"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="pt-3 border-t border-[#202333] flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded text-xs text-slate-400 hover:text-white bg-[#151722] hover:bg-[#1d2030] cursor-pointer transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-1.5 rounded text-xs font-bold text-black bg-amber-500 hover:bg-amber-400 cursor-pointer transition shadow-md flex items-center gap-1.5"
            >
              <Bell className="w-3.5 h-3.5" />
              <span>Activate Alert</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
