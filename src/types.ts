/**
 * Type definitions for NWWT Binance Spot Market Data, Watchlist & Scanner
 */

export interface TickerData {
  symbol: string;
  baseAsset?: string;
  quoteAsset?: string;
  lastPrice: string;
  priceChange: string;
  priceChangePercent: string;
  highPrice: string;
  lowPrice: string;
  bidPrice: string;
  askPrice: string;
  volume: string;
  quoteVolume: string;
  lastUpdateTime: number;
  connectionStatus?: string;
  // UI helpers
  priceDirection?: 'up' | 'down' | 'neutral';
  flashTimestamp?: number;
}

export type ConnectionStatus = 'connected' | 'connecting' | 'reconnecting' | 'disconnected';

export interface SingleConnectionStat {
  connectionId: number;
  status: ConnectionStatus;
  symbolsCount: number;
  subscribed: boolean;
  lastMessageTime: number;
  reconnectAttempts: number;
}

export interface ConnectionPoolStats {
  total: number;
  connected: number;
  reconnecting: number;
  connecting: number;
  disconnected: number;
  aggregateStatus: ConnectionStatus;
  connections?: SingleConnectionStat[];
}

export interface MarketInitPayload {
  status: ConnectionStatus;
  totalSymbols: number;
  connections: ConnectionPoolStats;
  tickers: TickerData[];
  scanner?: ScannerState;
  timestamp: number;
}

export type SortField = 'symbol' | 'lastPrice' | 'priceChange' | 'priceChangePercent' | 'highPrice' | 'lowPrice' | 'volume';
export type SortDirection = 'asc' | 'desc';

export interface SortConfig {
  field: SortField;
  direction: SortDirection;
}

export type FilterPreset = 'all' | 'gainers' | 'losers' | 'highVolume';

export type Timeframe = '1m' | '5m' | '15m' | '30m' | '1h' | '2h' | '4h' | '6h' | '8h' | '12h' | '1d' | '1w' | '1M';

export interface Candle {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  closeTime: number;
}

export type SwingType = 'HH' | 'HL' | 'LH' | 'LL';

export interface SwingPoint {
  index: number;
  time: number;
  price: number;
  type: SwingType;
  isHigh: boolean;
}

export interface StructureBreak {
  type: 'BOS' | 'CHoCH';
  direction: 'bullish' | 'bearish';
  breakIndex: number;
  breakTime: number;
  breakPrice: number;
  originIndex: number;
  originPrice: number;
}

export interface MarketStructureResult {
  swingPoints: SwingPoint[];
  structureBreaks: StructureBreak[];
  currentTrend: 'bullish' | 'bearish' | 'neutral';
}

// NWWT Scanner Signal Definitions (UP / DOWN only)
export interface ScannerSignalItem {
  id: string;
  asset: string;
  timeframe: Timeframe;
  direction: 'UP' | 'DOWN';
  setupType: string;
  signalPrice: number;
  invalidationLevel: number;
  confidence: number;
  reason: string;
  timestamp: number;
}

export interface PendingRetestItem {
  asset: string;
  timeframe: Timeframe;
  targetLevel: number;
  currentPrice: number;
  direction: 'UP' | 'DOWN';
  note: string;
}

export interface ScannerState {
  status: 'ready' | 'scanning' | 'idle';
  timeframe: Timeframe;
  scannedCount: number;
  totalSymbols: number;
  lastScanTime: number;
  signals: ScannerSignalItem[];
  pendingRetests: PendingRetestItem[];
}
