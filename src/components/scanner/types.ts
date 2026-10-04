import { Candle, Timeframe, TickerData, MarketStructureResult } from '../../types.ts';

/**
 * ScannerVolumeData
 * Volume metrics read directly from the active chart's candle and 24h ticker stream.
 */
export interface ScannerVolumeData {
  latestCandleVolume: number;
  total24hVolume: string | number;
  quoteVolume?: string | number;
}

/**
 * ScannerInputData / ScannerReaderInterface
 * A strictly-typed, read-only interface providing the exact in-memory data
 * from the currently selected asset and chart.
 */
export interface ScannerInputData {
  asset: string;
  timeframe: Timeframe;
  candles: Candle[];
  volume: ScannerVolumeData;
  marketStructure: MarketStructureResult;
  currentPrice: number;
  ticker?: TickerData | null;
}

export interface ScannerPattern {
  id: string;
  name: string;
  bias: 'bullish' | 'bearish' | 'neutral';
  timeframe: Timeframe;
  confidence: number; // 0 - 100%
  candleIndex: number;
  priceLevel: number;
  invalidationPrice: number;
  targetPrice: number;
  volumeConfirmation: boolean;
  structureConfluence: string;
  description: string;
  confirmedCandleCloseTime?: number;
}

export type ScannerSignal = 'UP' | 'DOWN' | 'NO SETUP';
export type SetupQuality = 'HIGH' | 'MODERATE' | 'LOW' | 'NONE';
export type MarketCondition = 'trending bullish' | 'trending bearish' | 'ranging or neutral';

/**
 * ScannerDecision
 * Final decision produced strictly from multi-condition confluence evaluation.
 */
export interface ScannerDecision {
  signal: ScannerSignal;
  setupQuality: SetupQuality;
  marketCondition: MarketCondition;
  marketStructure: string;
  trendCondition: string;
  volumeCondition: string;
  keyPriceArea: string;
  reason: string;
  invalidationLevel: number;
}

export interface ScannerAnalysisResult {
  asset: string;
  timeframe: Timeframe;
  currentPrice: number;
  decision: ScannerDecision;
  patterns: ScannerPattern[];
  primaryPattern: ScannerPattern | null;
  overallConfidence: number;
  trendConfluence: 'aligned' | 'counter-trend' | 'neutral';
  supportLevel: number;
  resistanceLevel: number;
  volumeStatus: 'expanding' | 'average' | 'contracting';
  educationalSummary: string;
  confirmedCandleCloseTime?: number;
  scannedAt: number;
}

export interface ChartScannerProps {
  asset: string;
  symbol?: string;
  timeframe: Timeframe;
  candles: Candle[];
  volume: ScannerVolumeData;
  marketStructure: MarketStructureResult;
  currentPrice: number;
  ticker?: TickerData | null;
}
