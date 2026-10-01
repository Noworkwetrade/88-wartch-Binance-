/**
 * In-App Floating Alert Notification Toast Banner
 * Non-intrusive alert popups on real price touch, cross, and confirmation rejection
 */

import React from 'react';
import { Bell, X, ArrowUpRight, ArrowDownRight, CheckCircle2 } from 'lucide-react';
import { DrawingAlertNotification } from '../../types/drawings.ts';

interface AlertNotificationToastProps {
  notifications: DrawingAlertNotification[];
  onDismiss: (id: string) => void;
}

export const AlertNotificationToast: React.FC<AlertNotificationToastProps> = ({
  notifications,
  onDismiss
}) => {
  if (!notifications || notifications.length === 0) return null;

  return (
    <div className="absolute top-12 right-3 z-40 flex flex-col gap-2 max-w-sm w-full pointer-events-none select-none">
      {notifications.map((n) => (
        <div
          key={n.id}
          className="pointer-events-auto p-3 rounded-lg bg-[#0e1017]/95 backdrop-blur-md border border-amber-500/50 shadow-[0_4px_20px_rgba(245,158,11,0.25)] text-white font-mono text-xs flex items-start gap-2.5 animate-in slide-in-from-top-2 fade-in duration-200"
        >
          <div className="w-7 h-7 rounded bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400 shrink-0 mt-0.5 animate-pulse">
            <Bell className="w-4 h-4" />
          </div>

          <div className="flex-1 overflow-hidden">
            <div className="flex items-center justify-between gap-1 mb-0.5">
              <span className="font-bold text-white text-xs truncate">
                {n.drawingName}
              </span>
              <span className="text-[10px] text-slate-400 shrink-0">
                {new Date(n.triggerTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </span>
            </div>

            <div className="flex items-center gap-2 text-[11px] mb-1">
              <span className="px-1.5 py-0.2 rounded bg-[#1b1f2e] text-amber-400 border border-amber-500/30 uppercase text-[9px] font-bold">
                {n.alertType.replace(/_/g, ' ')}
              </span>
              <span className="text-emerald-400 font-bold">
                ${n.triggerPrice.toFixed(2)}
              </span>
              <span className="text-[10px] text-slate-400">
                {n.asset} ({n.timeframe})
              </span>
            </div>

            <p className="text-[10.5px] text-slate-300 leading-snug font-sans">
              {n.message}
            </p>
          </div>

          <button
            onClick={() => onDismiss(n.id)}
            className="text-slate-400 hover:text-white p-1 hover:bg-[#1f2233] rounded transition cursor-pointer shrink-0"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
};
