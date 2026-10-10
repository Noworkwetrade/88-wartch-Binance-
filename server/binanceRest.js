/**
 * Binance Spot REST API Client
 * Primary: https://api.binance.com
 * Fallback: https://data-api.binance.vision / https://api1.binance.com
 */

const BASE_URLS = [
  'https://api.binance.com',
  'https://data-api.binance.vision',
  'https://api1.binance.com',
  'https://api2.binance.com'
];

const USER_AGENT = 'NWWT-Market-Scanner/6.0';
const klineCache = new Map();
const KLINE_CACHE_TTL_MS = 4000; // 4 seconds cache to protect Binance rate limits

/**
 * Robust fetch with automatic failover across Binance endpoints
 */
async function binanceFetch(path, options = {}) {
  let lastError = null;

  for (const baseUrl of BASE_URLS) {
    try {
      const url = `${baseUrl}${path}`;
      const response = await fetch(url, {
        ...options,
        headers: {
          'User-Agent': USER_AGENT,
          'Accept': 'application/json',
          ...(options.headers || {})
        },
        signal: AbortSignal.timeout( options.timeout || 8000 )
      });

      if (response.ok) {
        return await response.json();
      }
      lastError = new Error(`HTTP ${response.status} from ${baseUrl}${path}`);
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError || new Error(`Failed to fetch ${path} from all Binance endpoints`);
}

const PERMANENT_EXCLUDED_SYMBOLS = new Set(['USDCUSDT', 'USD1USDT', 'USDC', 'USD1']);

/**
 * Normalizes trading symbol inputs to standard Binance Spot format.
 * Handles bare symbols (e.g. BTC -> BTCUSDT), slashes (BTC/USDT -> BTCUSDT),
 * hyphens (BTC-USDC -> BTCUSDC), and respects USDT, USDC, and USD quote pairs.
 */
export function normalizeSymbol(rawSymbol) {
  if (!rawSymbol) return 'BTCUSDT';
  let s = String(rawSymbol).trim().toUpperCase();
  s = s.replace(/[\/\-_\s]/g, '');
  if (!s) return 'BTCUSDT';

  // If already ends with supported quote asset
  if (s.endsWith('USDT') || s.endsWith('USDC') || s.endsWith('USD')) {
    return s;
  }

  // Bare base asset (e.g. BTC, ETH, SOL) defaults to USDT
  return `${s}USDT`;
}

export function isPermanentlyExcludedSymbol(symbol) {
  if (!symbol) return false;
  const upper = String(symbol).trim().toUpperCase().replace(/[\/\-_\s]/g, '');
  return PERMANENT_EXCLUDED_SYMBOLS.has(upper) || PERMANENT_EXCLUDED_SYMBOLS.has(upper + 'USDT');
}

/**
 * Fetches all active Binance Spot USDT, USDC, and USD trading pairs dynamically
 * GET /api/v3/exchangeInfo
 */
export async function fetchExchangeInfo() {
  try {
    const data = await binanceFetch('/api/v3/exchangeInfo');
    if (!data || !Array.isArray(data.symbols)) {
      throw new Error('Invalid exchangeInfo response from Binance');
    }

    // Filter strictly to active Spot USDT, USDC, and USD trading pairs, permanently excluding stablecoin pairs like USDCUSDT
    const spotSymbols = data.symbols.filter((item) => {
      const isAllowedQuote = item && (item.quoteAsset === 'USDT' || item.quoteAsset === 'USDC' || item.quoteAsset === 'USD');
      return (
        item &&
        item.status === 'TRADING' &&
        isAllowedQuote &&
        item.isSpotTradingAllowed !== false &&
        !isPermanentlyExcludedSymbol(item.symbol)
      );
    });

    return {
      serverTime: data.serverTime || Date.now(),
      timezone: data.timezone || 'UTC',
      symbols: spotSymbols
    };
  } catch (error) {
    console.error('[binanceRest] Error fetching exchangeInfo:', error.message);
    throw error;
  }
}

/**
 * Fetches 24hr market ticker statistics for all pairs
 * GET /api/v3/ticker/24hr
 */
export async function fetchSpotTickers() {
  try {
    const data = await binanceFetch('/api/v3/ticker/24hr');
    if (!Array.isArray(data)) return [];

    // Filter USDT, USDC, and USD pairs with valid prices, permanently excluding USDCUSDT and USD1USDT
    return data.filter((item) => {
      if (!item || !item.symbol) return false;
      const s = item.symbol;
      const hasAllowedQuote = s.endsWith('USDT') || s.endsWith('USDC') || s.endsWith('USD');
      return hasAllowedQuote && !isPermanentlyExcludedSymbol(s);
    });
  } catch (err) {
    console.warn('[binanceRest] Note fetching 24hr snapshot:', err.message);
    return [];
  }
}

/**
 * Fetches real historical candlesticks from Binance Spot API
 * GET /api/v3/klines?symbol=BTCUSDT&interval=15m&limit=250
 */
export async function fetchKlines(symbol, interval = '15m', limit = 200) {
  const cleanSymbol = normalizeSymbol(symbol || 'BTCUSDT');
  if (isPermanentlyExcludedSymbol(cleanSymbol)) {
    return [];
  }
  const validLimit = Math.min(1000, Math.max(10, limit));
  const cacheKey = `${cleanSymbol}:${interval}:${validLimit}`;
  const now = Date.now();

  const cached = klineCache.get(cacheKey);
  if (cached && now - cached.timestamp < KLINE_CACHE_TTL_MS) {
    return cached.data;
  }

  try {
    const data = await binanceFetch(
      `/api/v3/klines?symbol=${cleanSymbol}&interval=${interval}&limit=${validLimit}`
    );

    if (!Array.isArray(data)) {
      return cached ? cached.data : [];
    }

    // Binance Kline format:
    // [
    //   0: Open time,
    //   1: Open,
    //   2: High,
    //   3: Low,
    //   4: Close,
    //   5: Volume,
    //   6: Close time,
    //   ...
    // ]
    const candles = data.map((k) => ({
      openTime: Number(k[0]),
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
      volume: parseFloat(k[5]),
      closeTime: Number(k[6])
    })).filter((c) => !isNaN(c.close) && c.close > 0);

    klineCache.set(cacheKey, { timestamp: now, data: candles });
    return candles;
  } catch (err) {
    console.warn(`[binanceRest] Failed to fetch klines for ${cleanSymbol}:`, err.message);
    return cached ? cached.data : [];
  }
}
