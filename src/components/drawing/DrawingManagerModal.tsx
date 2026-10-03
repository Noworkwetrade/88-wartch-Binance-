/**
 * Drawings Object Tree & Global Alerts Manager Modal
 * Allows managing all drawings and alerts on the active chart asset
 */

import React, { useState } from 'react';
import {
  X,
  Layers,
  Bell,
  Eye,
  EyeOff,
  Lock,
  Unlock,
  Trash2,
  Copy,
  Edit2,
  Check,
  Search,
  AlertTriangle,
  Clock,
  History
} from 'lucide-react';
import { ChartDrawing, DrawingAlert, DrawingAlertNotification } from '../../types/drawings.ts';

interface DrawingManagerModalProps {
  symbol: string;
  drawings: ChartDrawing[];
  selectedDrawingId: string | null;
  onSelectDrawing: (id: string | null) => void;
  onToggleVisibility: (id: string) => void;
  onToggleLock: (id: string) => void;
  onRenameDrawing: (id: string, name: string) => void;
  onDuplicateDrawing: (id: string) => void;
  onDeleteDrawing: (id: string) => void;
  onToggleAlert: (drawingId: string, alertId: string, enabled: boolean) => void;
  onDeleteAlert: (drawingId: string, alertId: string) => void;
  notificationHistory: DrawingAlertNotification[];
  onClearHistory: () => void;
  onClose: () => void;
}

export const DrawingManagerModal: React.FC<DrawingManagerModalProps> = ({
  symbol,
  drawings,
  selectedDrawingId,
  onSelectDrawing,
  onToggleVisibility,
  onToggleLock,
  onRenameDrawing,
  onDuplicateDrawing,
  onDeleteDrawing,
  onToggleAlert,
  onDeleteAlert,
  notificationHistory,
  onClearHistory,
  onClose
}) => {
  const [activeTab, setActiveTab] = useState<'drawings' | 'alerts' | 'history'>('drawings');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [tempName, setTempName] = useState<string>('');

  const allAlerts = drawings.flatMap((d) =>
    (d.alerts || []).map((a) => ({
      ...a,
      drawingName: d.name,
      drawingColor: d.color,
      drawingType: d.type
    }))
  );

  const filteredDrawings = drawings.filter((d) =>
    d.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    d.type.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const startRename = (d: ChartDrawing) => {
    setEditingId(d.id);
    setTempName(d.name);
  };

  const saveRename = (id: string) => {
    if (tempName.trim()) {
      onRenameDrawing(id, tempName.trim());
    }
    setEditingId(null);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-xs p-2 sm:p-4 select-none animate-in fade-in duration-150">
      <div className="w-full max-w-xl rounded-lg bg-[#0e1017] border border-[#26293a] shadow-2xl text-white font-mono flex flex-col h-[520px] max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="px-3.5 py-2.5 sm:px-4 sm:py-3 bg-[#12141f] border-b border-[#202333] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-white tracking-wider uppercase">
              CHART DRAWINGS & ALERTS • {symbol}
            </span>
            <span className="text-[10px] px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-400 border border-amber-500/30">
              {drawings.length} Objects
            </span>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded text-slate-400 hover:text-white hover:bg-[#1c1f2e] transition cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tab Strip */}
        <div className="flex items-center border-b border-[#1c1f2e] bg-[#0a0b10] px-3 gap-2 shrink-0">
          <button
            onClick={() => setActiveTab('drawings')}
            className={`py-2 px-3 text-xs font-bold flex items-center gap-1.5 border-b-2 transition cursor-pointer ${
              activeTab === 'drawings'
                ? 'border-amber-400 text-amber-400'
                : 'border-transparent text-slate-400 hover:text-white'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>Drawings ({drawings.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('alerts')}
            className={`py-2 px-3 text-xs font-bold flex items-center gap-1.5 border-b-2 transition cursor-pointer ${
              activeTab === 'alerts'
                ? 'border-amber-400 text-amber-400'
                : 'border-transparent text-slate-400 hover:text-white'
            }`}
          >
            <Bell className="w-3.5 h-3.5" />
            <span>Active Alerts ({allAlerts.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('history')}
            className={`py-2 px-3 text-xs font-bold flex items-center gap-1.5 border-b-2 transition cursor-pointer ${
              activeTab === 'history'
                ? 'border-amber-400 text-amber-400'
                : 'border-transparent text-slate-400 hover:text-white'
            }`}
          >
            <History className="w-3.5 h-3.5" />
            <span>Alert Log ({notificationHistory.length})</span>
          </button>
        </div>

        {/* Tab 1: Drawings Tree */}
        {activeTab === 'drawings' && (
          <div className="flex-1 flex flex-col p-3 overflow-hidden">
            <div className="flex items-center gap-2 mb-2.5">
              <div className="relative flex-1">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-500" />
                <input
                  type="text"
                  placeholder="Search drawings by name or type..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-[#131520] border border-[#202333] rounded pl-8 pr-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-amber-500"
                />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto space-y-1.5 pr-1">
              {filteredDrawings.length === 0 ? (
                <div className="p-8 text-center text-slate-500 text-xs font-mono">
                  No drawings found on {symbol}. Select a tool from the left toolbar to draw on the chart.
                </div>
              ) : (
                filteredDrawings.map((d) => {
                  const isSelected = selectedDrawingId === d.id;
                  const isEditing = editingId === d.id;

                  return (
                    <div
                      key={d.id}
                      onClick={() => onSelectDrawing(d.id)}
                      className={`p-2 rounded border flex items-center justify-between transition cursor-pointer ${
                        isSelected
                          ? 'bg-[#181c2c] border-amber-500/60 shadow-sm'
                          : 'bg-[#11131c] border-[#1d2030] hover:border-slate-700'
                      }`}
                    >
                      <div className="flex items-center gap-2 overflow-hidden flex-1">
                        <span
                          className="w-3 h-3 rounded-full shrink-0"
                          style={{ backgroundColor: d.color }}
                        />

                        {isEditing ? (
                          <div className="flex items-center gap-1 flex-1" onClick={(e) => e.stopPropagation()}>
                            <input
                              type="text"
                              value={tempName}
                              onChange={(e) => setTempName(e.target.value)}
                              onKeyDown={(e) => e.key === 'Enter' && saveRename(d.id)}
                              className="bg-[#0b0c12] border border-amber-500 rounded px-1.5 py-0.5 text-xs text-white focus:outline-none flex-1"
                              autoFocus
                            />
                            <button
                              onClick={() => saveRename(d.id)}
                              className="p-1 text-emerald-400 hover:text-white"
                            >
                              <Check className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2 truncate">
                            <span className="text-xs font-semibold text-white truncate">{d.name}</span>
                            <span className="text-[10px] text-slate-500 uppercase">({d.type.replace(/_/g, ' ')})</span>
                            {d.alerts && d.alerts.length > 0 && (
                              <span className="px-1.5 py-0.2 rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/30 text-[9px] font-bold">
                                {d.alerts.length} alert{d.alerts.length > 1 ? 's' : ''}
                              </span>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Action Buttons */}
                      <div className="flex items-center gap-1 shrink-0 ml-2" onClick={(e) => e.stopPropagation()}>
                        {!isEditing && (
                          <button
                            onClick={() => startRename(d)}
                            className="p-1 text-slate-400 hover:text-white hover:bg-[#1f2233] rounded transition"
                            title="Rename"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                        )}

                        <button
                          onClick={() => onToggleVisibility(d.id)}
                          className={`p-1 rounded transition ${
                            d.visible ? 'text-slate-400 hover:text-white' : 'text-slate-600 bg-slate-800/40'
                          }`}
                          title={d.visible ? 'Hide' : 'Show'}
                        >
                          {d.visible ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                        </button>

                        <button
                          onClick={() => onToggleLock(d.id)}
                          className={`p-1 rounded transition ${
                            d.locked ? 'text-amber-400 bg-amber-500/10' : 'text-slate-400 hover:text-white'
                          }`}
                          title={d.locked ? 'Unlock' : 'Lock'}
                        >
                          {d.locked ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
                        </button>

                        <button
                          onClick={() => onDuplicateDrawing(d.id)}
                          className="p-1 text-slate-400 hover:text-white hover:bg-[#1f2233] rounded transition"
                          title="Duplicate"
                        >
                          <Copy className="w-3.5 h-3.5" />
                        </button>

                        <button
                          onClick={() => onDeleteDrawing(d.id)}
                          className="p-1 text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 rounded transition"
                          title="Delete"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}

        {/* Tab 2: All Active Alerts */}
        {activeTab === 'alerts' && (
          <div className="flex-1 p-3 overflow-y-auto space-y-2">
            {allAlerts.length === 0 ? (
              <div className="p-8 text-center text-slate-500 text-xs font-mono">
                No active alerts on {symbol}. Select any drawing on the chart and click 'Alert' to set one up.
              </div>
            ) : (
              allAlerts.map((al) => (
                <div
                  key={al.id}
                  className="p-2.5 rounded bg-[#11131c] border border-[#1f2233] flex items-center justify-between text-xs"
                >
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: al.drawingColor }} />
                      <strong className="text-white">{al.drawingName}</strong>
                      <span className="text-[10px] px-1.5 py-0.2 rounded bg-amber-500/15 text-amber-400 border border-amber-500/30 uppercase font-bold">
                        {al.type.replace(/_/g, ' ')}
                      </span>
                    </div>
                    <div className="text-[10px] text-slate-400 pl-4.5">
                      Direction: {al.direction} • {al.repeat ? 'Recurring' : 'One-time'} • Cooldown: {al.cooldownMs / 60000}m
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => onToggleAlert(al.drawingId, al.id, !al.enabled)}
                      className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase transition cursor-pointer ${
                        al.enabled
                          ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                          : 'bg-slate-800 text-slate-500 border border-slate-700'
                      }`}
                    >
                      {al.enabled ? 'Active' : 'Paused'}
                    </button>

                    <button
                      onClick={() => onDeleteAlert(al.drawingId, al.id)}
                      className="p-1 text-slate-500 hover:text-rose-400 transition cursor-pointer"
                      title="Delete Alert"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* Tab 3: Alert Trigger History */}
        {activeTab === 'history' && (
          <div className="flex-1 flex flex-col p-3 overflow-hidden">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] text-slate-400">Triggered Alert Notifications</span>
              {notificationHistory.length > 0 && (
                <button
                  onClick={onClearHistory}
                  className="text-[10px] text-slate-500 hover:text-rose-400 flex items-center gap-1 transition cursor-pointer"
                >
                  <Trash2 className="w-3 h-3" />
                  <span>Clear History</span>
                </button>
              )}
            </div>

            <div className="flex-1 overflow-y-auto space-y-1.5 pr-1">
              {notificationHistory.length === 0 ? (
                <div className="p-8 text-center text-slate-500 text-xs font-mono">
                  No alert notifications recorded yet.
                </div>
              ) : (
                notificationHistory.map((h) => (
                  <div
                    key={h.id}
                    className="p-2 rounded bg-[#11131c] border border-[#1f2233] text-xs flex items-center justify-between"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <strong className="text-white">{h.drawingName}</strong>
                        <span className="text-[10px] text-amber-400 uppercase font-bold">
                          {h.alertType.replace(/_/g, ' ')}
                        </span>
                        <span className="text-[10px] text-emerald-400 font-bold">
                          ${h.triggerPrice.toFixed(2)}
                        </span>
                      </div>
                      <p className="text-[10.5px] text-slate-400 mt-0.5">{h.message}</p>
                    </div>
                    <span className="text-[9.5px] text-slate-500 shrink-0 ml-2">
                      {new Date(h.triggerTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
