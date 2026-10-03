/**
 * Custom React Hook for Real-Time Binance Market Streaming & NWWT Scanner
 * Reuses the project's existing Binance WebSocket connection via /ws
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { TickerData, ConnectionStatus, ConnectionPoolStats, ScannerState, Timeframe } from '../types.ts';

export function useBinanceMarket() {
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('connecting');
  const [poolStats, setPoolStats] = useState<ConnectionPoolStats | null>(null);
  const [totalSymbols, setTotalSymbols] = useState<number>(0);
  const [tickersList, setTickersList] = useState<TickerData[]>([]);
  const [ticksPerSecond, setTicksPerSecond] = useState<number>(0);
  const [lastTickTime, setLastTickTime] = useState<number>(0);
  const [scannerState, setScannerState] = useState<ScannerState>({
    status: 'ready',
    timeframe: '15m',
    scannedCount: 0,
    totalSymbols: 0,
    lastScanTime: 0,
    signals: [],
    pendingRetests: []
  });

  // High-performance ticker storage
  const tickersMapRef = useRef<Map<string, TickerData>>(new Map());
  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<any>(null);
  const tickCounterRef = useRef<number>(0);
  const dirtyRef = useRef<boolean>(false);

  // Sync tickers map to React state throttled for smooth 60fps UI without layout thrashing
  const flushUpdates = useCallback(() => {
    if (dirtyRef.current) {
      setTickersList(Array.from(tickersMapRef.current.values()));
      dirtyRef.current = false;
    }
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      flushUpdates();
    }, 80); // 12 updates per second maximum for ultra fluid UI
    return () => clearInterval(interval);
  }, [flushUpdates]);

  // Calculate ticks per second
  useEffect(() => {
    const secInterval = setInterval(() => {
      setTicksPerSecond(tickCounterRef.current);
      tickCounterRef.current = 0;
    }, 1000);
    return () => clearInterval(secInterval);
  }, []);

  // Process a single ticker update item from Binance feed
  const processTickerItem = useCallback((t: Partial<TickerData> & { symbol: string }) => {
    if (!t || !t.symbol) return;
    tickCounterRef.current++;
    setLastTickTime(t.lastUpdateTime || Date.now());

    const existing = tickersMapRef.current.get(t.symbol);
    let direction: 'up' | 'down' | 'neutral' = 'neutral';

    if (existing && existing.lastPrice !== '--' && t.lastPrice && t.lastPrice !== '--') {
      const oldPriceNum = parseFloat(existing.lastPrice);
      const newPriceNum = parseFloat(t.lastPrice);
      if (!isNaN(oldPriceNum) && !isNaN(newPriceNum)) {
        if (newPriceNum > oldPriceNum) direction = 'up';
        else if (newPriceNum < oldPriceNum) direction = 'down';
        else direction = existing.priceDirection || 'neutral';
      }
    }

    const updated: TickerData = {
      ...(existing || {
        symbol: t.symbol,
        baseAsset: t.symbol.replace(/USDT$/, ''),
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
      }),
      ...t,
      priceDirection: direction,
      flashTimestamp: direction !== 'neutral' ? Date.now() : (existing?.flashTimestamp || 0)
    };

    tickersMapRef.current.set(t.symbol, updated);
    dirtyRef.current = true;
  }, []);

  const connect = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }

    try {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/ws`;

      const ws = new WebSocket(wsUrl);
      socketRef.current = ws;

      ws.onopen = () => {
        setConnectionStatus('connected');
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);

          if (msg.type === 'init' || msg.type === 'snapshot') {
            const data = msg.data;
            if (data.status) setConnectionStatus(data.status);
            if (data.connections) setPoolStats(data.connections);
            if (data.totalSymbols) setTotalSymbols(data.totalSymbols);
            if (data.scanner) setScannerState(data.scanner);

            if (Array.isArray(data.tickers)) {
              for (const t of data.tickers) {
                const existing = tickersMapRef.current.get(t.symbol);
                tickersMapRef.current.set(t.symbol, {
                  ...(existing || {}),
                  ...t
                });
              }
              dirtyRef.current = true;
              flushUpdates();
            }
          } else if (msg.type === 'ticker_batch') {
            if (Array.isArray(msg.data)) {
              for (const item of msg.data) {
                processTickerItem(item);
              }
            }
          } else if (msg.type === 'ticker') {
            processTickerItem(msg.data);
          } else if (msg.type === 'scanner_update') {
            if (msg.data) {
              setScannerState(msg.data);
            }
          } else if (msg.type === 'status') {
            const data = msg.data;
            if (data.status) setConnectionStatus(data.status);
            if (data.connections) setPoolStats(data.connections);
            if (data.totalSymbols) setTotalSymbols(data.totalSymbols);
          }
        } catch (err) {
          // ignore parsing error
        }
      };

      ws.onerror = () => {
        setConnectionStatus('reconnecting');
      };

      ws.onclose = () => {
        setConnectionStatus('reconnecting');
        socketRef.current = null;
        reconnectTimerRef.current = setTimeout(() => {
          connect();
        }, 2000);
      };
    } catch (err) {
      setConnectionStatus('reconnecting');
      reconnectTimerRef.current = setTimeout(() => {
        connect();
      }, 3000);
    }
  }, [flushUpdates, processTickerItem]);

  useEffect(() => {
    connect();

    // Tab visibility recovery: if the user returned from another tab, request fresh market snapshot
    const handleVisibilityOrFocus = () => {
      if (document.visibilityState === 'visible') {
        const ws = socketRef.current;
        if (!ws || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
          connect();
        } else if (ws.readyState === WebSocket.OPEN) {
          try {
            ws.send(JSON.stringify({ type: 'request_snapshot' }));
          } catch (e) {}
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityOrFocus);
    window.addEventListener('focus', handleVisibilityOrFocus);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityOrFocus);
      window.removeEventListener('focus', handleVisibilityOrFocus);
      if (socketRef.current) {
        socketRef.current.close();
        socketRef.current = null;
      }
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
      }
    };
  }, [connect]);

  // Request server to run scanner on chosen timeframe
  const triggerScan = useCallback((timeframe: Timeframe = '15m') => {
    setScannerState((prev) => ({ ...prev, status: 'scanning', timeframe }));
    const ws = socketRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'run_scan', timeframe }));
    }
    fetch(`/api/scanner`)
      .then((res) => res.json())
      .then((data) => {
        if (data) setScannerState(data);
      })
      .catch(() => {});
  }, []);

  const reconnectBackend = useCallback(() => {
    if (socketRef.current) {
      try {
        socketRef.current.close();
      } catch (e) {}
    }
    fetch('/api/reconnect', { method: 'POST' }).catch(() => {});
    connect();
  }, [connect]);

  return {
    connectionStatus,
    poolStats,
    totalSymbols,
    tickersList,
    tickersMap: tickersMapRef.current,
    ticksPerSecond,
    lastTickTime,
    scannerState,
    triggerScan,
    reconnectBackend
  };
}
