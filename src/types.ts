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

// Market Regime Definitions
export type MarketRegime =
  | 'trending_up'
  | 'trending_down'
  | 'ranging'
  | 'high_volatility'
  | 'low_volatility'
  | 'transition';

export type AIValidationStatus = 'allow' | 'reject' | 'wait';

export type ModelTrackType =
  | 'original'
  | 'inverse'
  | 'ai_filtered'
  | 'ai_filtered_inverse';

export interface SignalConditionsRecord {
  trendDirection?: string;
  trendStrength?: number;
  marketRegime?: MarketRegime;
  structureState?: string;
  swingHigh?: number;
  swingLow?: number;
  supportLevel?: number;
  resistanceLevel?: number;
  hasBOS?: boolean;
  hasCHoCH?: boolean;
  isRetest?: boolean;
  isFakeout?: boolean;
  riskRewardRatio?: number;
  distanceToTpPercent?: number;
  distanceToSlPercent?: number;
  volatilityRatio?: number;
}

// NWWT Scanner Signal Definitions (UP / DOWN only) with V8 Performance Engine
export type SignalStatus = 'ACTIVE' | 'WIN' | 'LOSS' | 'EXPIRED';

export interface ScannerSignalItem {
  id: string;
  asset: string;
  timeframe: Timeframe;
  direction: 'UP' | 'DOWN';
  setupType: string;
  signalPrice: number;
  entryPrice: number;
  takeProfit: number;
  takeProfit1?: number;
  takeProfit2?: number;
  stopLoss: number;
  invalidationLevel: number;
  confidence: number;
  reason: string;
  timestamp: number;
  confirmedCandleCloseTime?: number;
  // Two Take Profit & Trade Completion Fields
  tp1Hit?: boolean;
  tp1HitTimestamp?: number;
  tp1Price?: number;
  tp2Hit?: boolean;
  tp2HitTimestamp?: number;
  tp2Price?: number;
  rewardRiskRatio?: number;
  riskDistance?: number;
  targetDistance?: number;
  structureReference?: {
    swingLow: number;
    swingHigh: number;
    supportLevel: number;
    resistanceLevel: number;
    buffer: number;
    atr: number;
    invalidationType: string;
    tp1TargetType: string;
    tp2TargetType?: string;
    riskDistance: number;
    targetDistance: number;
    timeframe: string;
    pair: string;
  };
  isBacktest?: boolean;
  displayMessage?: string;
  isTradeComplete?: boolean;
  // Performance Engine Fields
  status: SignalStatus;
  statusReason?: string;
  completedAt?: number;
  exitPrice?: number;
  pnlPercent?: number;
  expiryCandles: number;
  expiryTimestamp: number;
  highestReached?: number;
  lowestReached?: number;
  // Intelligence Layer & Research Mode Extensions
  marketRegime?: MarketRegime;
  aiValidation?: {
    status: AIValidationStatus;
    confidence: number;
    reason: string;
    regime: MarketRegime;
  };
  modelType?: ModelTrackType;
  durationMs?: number;
  maxDrawdownPercent?: number;
  signalConditions?: SignalConditionsRecord;
  marketStructureQuality?: {
    qualityGrade: 'excellent' | 'good' | 'acceptable' | 'poor' | 'untradable';
    qualityScore: number;
    isTradable: boolean;
    rejectionReason?: string;
    metrics: {
      candleActivity: number;
      relativePriceMovement: number;
      swingClarity: number;
      srClarity: number;
      volumeActivity?: number;
      averageCandleRangePercent: number;
      totalWindowRangePercent: number;
      swingCount: number;
      swingSeparationPercent: number;
      flatCandleRatio: number;
      overlapRatio: number;
    };
  };
  // Higher Timeframe (HTF) Confirmation Extensions
  htfConfirmation?: {
    enabled: boolean;
    ruleMode: 'lenient' | 'aligned' | 'strict';
    htfTimeframe?: Timeframe;
    htfRegime?: MarketRegime;
    htfTrendDirection?: 'bullish' | 'bearish' | 'neutral';
    status: 'confirmed' | 'rejected' | 'neutral';
    reason: string;
    metrics?: {
      higherTfRegime?: MarketRegime;
      higherTfTrend?: string;
      entryTimeframe: Timeframe;
    };
  };
}

export interface PendingRetestItem {
  asset: string;
  timeframe: Timeframe;
  targetLevel: number;
  currentPrice: number;
  direction: 'UP' | 'DOWN';
  note: string;
}

export interface SetupPerformance {
  total: number;
  wins: number;
  losses: number;
  expired: number;
  active: number;
  tpRate: number; // Win rate %
  avgPnlPercent: number;
  expectancy?: number;
  maxLosingStreak?: number;
  drawdown?: number;
}

export interface WalkForwardMetrics {
  isValid: boolean;
  sampleSize: number;
  minRequired: number;
  inSample: {
    count: number;
    settled: number;
    wins: number;
    losses: number;
    winRate: number;
    profitFactor: number;
    expectancy: number;
    avgWinPercent: number;
    avgLossPercent: number;
    maxLosingStreak: number;
  } | null;
  outOfSample: {
    count: number;
    settled: number;
    wins: number;
    losses: number;
    winRate: number;
    profitFactor: number;
    expectancy: number;
    avgWinPercent: number;
    avgLossPercent: number;
    maxLosingStreak: number;
  } | null;
  winRateEfficiency?: number;
  message: string;
}

export interface LivePerformanceSummary {
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  profitFactor: number;
  expectancy: number;
  drawdown: number;
  sampleSize: number;
}

export interface BacktestPerformanceSummary {
  trades: number;
  winRate: number;
  profitFactor: number;
  drawdown: number;
  sampleSize: number;
}

export interface SignalPerformanceStats {
  totalSignals: number;
  activeCount: number;
  completedCount: number;
  winsCount: number;
  lossesCount: number;
  expiredCount: number;
  tpRate: number; // (wins / (wins + losses)) * 100
  avgWinPercent: number;
  avgLossPercent: number;
  profitFactor: number;
  expectancy?: number;
  maxLosingStreak?: number;
  drawdown?: number;
  sampleSize?: number;
  hasSufficientSample?: boolean;
  liveStats?: LivePerformanceSummary;
  backtestStats?: BacktestPerformanceSummary;
  bySetupType: Record<string, SetupPerformance>;
  byTimeframe: Record<string, SetupPerformance>;
  byDirection: Record<'UP' | 'DOWN', SetupPerformance>;
  byAsset: Record<string, SetupPerformance>;
  byRegime?: Record<string, SetupPerformance>;
  byModel?: {
    original: SignalPerformanceStats;
    inverse: SignalPerformanceStats;
    ai_filtered: SignalPerformanceStats;
    ai_filtered_inverse: SignalPerformanceStats;
  };
  walkForward?: WalkForwardMetrics;
}

export interface ScannerState {
  status: 'ready' | 'scanning' | 'idle';
  timeframe: Timeframe;
  scannedCount: number;
  totalSymbols: number;
  lastScanTime: number;
  signals: ScannerSignalItem[];
  completedSignals?: ScannerSignalItem[];
  activeCount?: number;
  completedCount?: number;
  pendingRetests: PendingRetestItem[];
  performance?: SignalPerformanceStats;
  // Multi-Timeframe and Fair Coverage Metrics
  htfConfirmationEnabled?: boolean;
  htfTimeframe?: Timeframe;
  htfRuleMode?: 'lenient' | 'aligned' | 'strict';
  coverageMetrics?: {
    totalEligibleSymbols: number;
    batchSize: number;
    batchIndex: number;
    totalBatches: number;
    cycleDurationMs: number;
    estFullRotationSeconds: number;
    coveragePercent: number;
    lastBatchCompletedAt?: number;
  };
}
