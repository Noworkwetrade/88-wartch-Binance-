/**
 * Network Modal Component
 * Displays real-time status of the WEEX WebSocket pool and 100-channel grouped connections
 */

import React from 'react';
import { X, Server, CheckCircle2, AlertCircle, RefreshCw, Layers } from 'lucide-react';
import { ConnectionPoolStats } from '../types.ts';

interface NetworkModalProps {
  isOpen: boolean;
  onClose: () => void;
  poolStats: ConnectionPoolStats | null;
  onReconnect: () => void;
}

export const NetworkModal: React.FC<NetworkModalProps> = ({
  isOpen,
  onClose,
  poolStats,
  onReconnect
}) => {
  if (!isOpen) return null;

  const connections = poolStats?.connections || [];
  const connectedCount = poolStats?.connected ?? 0;
  const totalCount = poolStats?.total ?? 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className="bg-[#181c27] border border-[#2a2e39] rounded-xl w-full max-w-3xl max-h-[85vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Modal Header */}
        <div className="p-4 border-b border-[#2a2e39] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Server className="w-5 h-5 text-indigo-400" />
            <div>
              <h2 className="text-base font-bold text-slate-100">
                WEEX WebSocket Connection Pool
              </h2>
              <p className="text-xs text-slate-400">
                Automatic 100-channel division across multiple WebSocket connections
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-md text-slate-400 hover:text-white hover:bg-[#252a37] transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Aggregate Overview Card */}
        <div className="p-4 bg-[#131722] border-b border-[#2a2e39] grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
          <div className="p-3 rounded-lg bg-[#1e222d] border border-[#2a2e39]">
            <div className="text-[10px] text-slate-400 mb-0.5">Total Connections</div>
            <div className="text-lg font-bold font-mono text-slate-100">{totalCount}</div>
            <div className="text-[10px] text-slate-500">Max 100 pairs/conn</div>
          </div>

          <div className="p-3 rounded-lg bg-[#1e222d] border border-[#2a2e39]">
            <div className="text-[10px] text-slate-400 mb-0.5">Active / Connected</div>
            <div className="text-lg font-bold font-mono text-emerald-400">{connectedCount}</div>
            <div className="text-[10px] text-slate-500">Streaming live tickers</div>
          </div>

          <div className="p-3 rounded-lg bg-[#1e222d] border border-[#2a2e39]">
            <div className="text-[10px] text-slate-400 mb-0.5">Reconnecting</div>
            <div className="text-lg font-bold font-mono text-amber-400">
              {poolStats?.reconnecting ?? 0}
            </div>
            <div className="text-[10px] text-slate-500">Auto-retry active</div>
          </div>

          <div className="p-3 rounded-lg bg-[#1e222d] border border-[#2a2e39]">
            <div className="text-[10px] text-slate-400 mb-0.5">Aggregate Status</div>
            <div className="text-sm font-bold font-mono uppercase text-blue-400 mt-1">
              {poolStats?.aggregateStatus || 'disconnected'}
            </div>
          </div>
        </div>

        {/* Individual Connections List */}
        <div className="p-4 flex-1 overflow-y-auto space-y-2">
          <div className="flex items-center justify-between text-xs text-slate-400 mb-2">
            <span className="font-semibold uppercase tracking-wider text-[11px]">
              Connection Pool Breakdown ({connections.length} groups)
            </span>
            <button
              onClick={onReconnect}
              className="flex items-center gap-1 px-2.5 py-1 rounded bg-[#1e222d] hover:bg-[#252a37] text-slate-300 text-xs border border-[#2a2e39] cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Reconnect Pool</span>
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5">
            {connections.map((conn) => {
              const isConn = conn.status === 'connected';
              const isReconn = conn.status === 'reconnecting';
              const isConnecting = conn.status === 'connecting';

              return (
                <div
                  key={conn.connectionId}
                  className="p-3 rounded-lg bg-[#131722] border border-[#2a2e39] flex flex-col justify-between"
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-1.5 font-mono font-bold text-xs text-slate-200">
                      <Layers className="w-3.5 h-3.5 text-blue-400" />
                      <span>Conn #{conn.connectionId}</span>
                    </div>

                    <span
                      className={`text-[10px] font-mono px-1.5 py-0.5 rounded font-semibold uppercase ${
                        isConn
                          ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                          : isReconn
                          ? 'bg-orange-500/20 text-orange-400 border border-orange-500/30'
                          : isConnecting
                          ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                          : 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                      }`}
                    >
                      {conn.status}
                    </span>
                  </div>

                  <div className="text-[11px] text-slate-400 space-y-1 font-mono">
                    <div className="flex justify-between">
                      <span>Pairs Assigned:</span>
                      <span className="text-slate-200 font-semibold">{conn.symbolsCount}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Subscribed:</span>
                      <span className={conn.subscribed ? 'text-emerald-400' : 'text-slate-500'}>
                        {conn.subscribed ? 'Active' : 'Pending'}
                      </span>
                    </div>
                    {conn.reconnectAttempts > 0 && (
                      <div className="flex justify-between text-amber-400">
                        <span>Retries:</span>
                        <span>{conn.reconnectAttempts}</span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Modal Footer */}
        <div className="p-3 bg-[#131722] border-t border-[#2a2e39] flex items-center justify-between text-xs text-slate-400">
          <span>Client: NWWT-WEEX-WATCHLIST/1.0</span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded font-medium transition-colors cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default NetworkModal;
