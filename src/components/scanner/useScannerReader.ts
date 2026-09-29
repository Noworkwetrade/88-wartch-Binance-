import { ScannerInputData } from './types.ts';

/**
 * useScannerReader
 * A clean reader hook exposing the exact existing chart data
 * from the active asset to future scanner engines without side effects.
 */
export function useScannerReader(input: ScannerInputData): ScannerInputData {
  return {
    asset: input.asset,
    timeframe: input.timeframe,
    candles: input.candles,
    volume: input.volume,
    marketStructure: input.marketStructure,
    currentPrice: input.currentPrice,
    ticker: input.ticker ?? null
  };
}
