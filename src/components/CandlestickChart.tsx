/**
 * Real-Time TradingView Style Candlestick Chart Component
 * Powered exclusively by genuine Binance Spot market data.
 *
 * Interaction Features:
 * - Direct inline dropdown underneath clicked asset row
 * - Free horizontal pan with empty forward right-margin (unlocked viewport)
 * - Free vertical price movement (drag canvas vertically to pan price)
 * - Interactive right price scale: drag to compress/stretch vertical price scale, double-click to auto-fit
 * - Interactive bottom time scale: drag to compress/stretch horizontal candle width
 * - Focal-point zooming on mouse wheel (centered on cursor) & pinch zoom on touch (centered on fingers)
 * - Pointer capture for glitch-free dragging even when cursor leaves canvas
 * - Non-passive touch listeners with preventDefault() so table/page never scrolls while dragging chart
 * - ResizeObserver so canvas measures exact width and height immediately without blank frames
 * - Real-time candle movement: active candle body, wicks, and close update live with every Binance tick
 * - Live Market Structure (HH, HL, LH, LL, BOS, CHoCH) calculated strictly from real candle prices
 * - Full timeframes: 1m, 5m, 15m, 30m, 1h, 2h, 4h, 6h, 8h, 12h, 1d, 1w, 1M
 * - In-place close button to collapse dropdown
 */

import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import {
  RotateCcw,
  ZoomIn,
  ZoomOut,
  ChevronDown,
  ChevronUp,
  Layers,
  SlidersHorizontal,
  TrendingUp,
  TrendingDown,
  Activity,
  Maximize2,
  Minimize2,
  Search,
  Sparkles,
  Shield,
  Target,
  Info,
  X
} from 'lucide-react';
import { Candle, Timeframe, TickerData, MarketStructureResult, ScannerSignalItem } from '../types.ts';
import { calculateMarketStructure, getTimeframeDurationMs } from '../utils/marketStructure.ts';
import { formatPrice } from './WatchlistTable.tsx';
import { runChartScan } from './scanner/scannerEngine.ts';
import { ScannerAnalysisResult } from './scanner/types.ts';
import { useChartDrawings } from '../hooks/useChartDrawings.ts';
import { useDrawingAlerts } from '../hooks/useDrawingAlerts.ts';
import {
  drawChartElement,
  CoordinateContext,
  timeToX,
  xToTime,
  priceToY as convertPriceToY,
  yToPrice as convertYToPrice,
  hitTestDrawing,
  findCandleSnap,
  drawSnapIndicator,
  CandleSnapPoint
} from '../utils/drawingGeometry.ts';
import {
  checkSignalTouch,
  loadClearedSignalIds,
  addClearedSignalId
} from '../utils/signalTouchEngine.ts';
import { settleSignalOutcome } from '../utils/performanceEngine.ts';
import { DrawingToolbar } from './drawing/DrawingToolbar.tsx';
import { DrawingPropertiesBar } from './drawing/DrawingPropertiesBar.tsx';
import { DrawingAlertModal } from './drawing/DrawingAlertModal.tsx';
import { DrawingManagerModal } from './drawing/DrawingManagerModal.tsx';
import { AlertNotificationToast } from './drawing/AlertNotificationToast.tsx';
import { ChartDrawing, ChartPoint } from '../types/drawings.ts';

interface CandlestickChartProps {
  symbol: string;
  ticker: TickerData | null;
  timeframe: Timeframe;
  onTimeframeChange: (tf: Timeframe) => void;
  onClose?: () => void;
  onSelectSymbol?: (symbol: string) => void;
  allSymbols?: TickerData[];
  activeSignal?: ScannerSignalItem | null;
}

const TIMEFRAMES: Timeframe[] = [
  '1m', '5m', '15m', '30m',
  '1h', '2h', '4h', '6h', '8h', '12h',
  '1d', '1w', '1M'
];

/**
 * Calculates clean round price tick increments
 */
function getNicePriceStep(range: number, targetCount = 6): number {
  if (range <= 0 || isNaN(range)) return 1;
  const rawStep = range / targetCount;
  const power = Math.floor(Math.log10(rawStep));
  const magnitude = Math.pow(10, power);
  const normalized = rawStep / magnitude;

  let cleanStep = magnitude;
  if (normalized < 1.5) cleanStep = 1 * magnitude;
  else if (normalized < 3) cleanStep = 2 * magnitude;
  else if (normalized < 7) cleanStep = 5 * magnitude;
  else cleanStep = 10 * magnitude;

  return cleanStep;
}

export const CandlestickChart: React.FC<CandlestickChartProps> = ({
  symbol,
  ticker,
  timeframe,
  onTimeframeChange,
  onClose,
  onSelectSymbol,
  allSymbols = [],
  activeSignal = null
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const assetDropdownRef = useRef<HTMLDivElement | null>(null);

  // Asset Dropdown State
  const [isAssetDropdownOpen, setIsAssetDropdownOpen] = useState<boolean>(false);
  const [assetSearchQuery, setAssetSearchQuery] = useState<string>('');

  // Close asset dropdown on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (assetDropdownRef.current && !assetDropdownRef.current.contains(e.target as Node)) {
        setIsAssetDropdownOpen(false);
      }
    };
    if (isAssetDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isAssetDropdownOpen]);

  // Filtered dropdown symbols
  const filteredDropdownSymbols = useMemo(() => {
    if (!allSymbols || allSymbols.length === 0) return [];
    if (!assetSearchQuery.trim()) return allSymbols.slice(0, 100);
    const q = assetSearchQuery.trim().toUpperCase();
    return allSymbols
      .filter((s) => s.symbol.toUpperCase().includes(q) || (s.baseAsset && s.baseAsset.toUpperCase().includes(q)))
      .slice(0, 100);
  }, [allSymbols, assetSearchQuery]);

  // Candles data state
  const [candles, setCandles] = useState<Candle[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Drawing Tools Hook
  const {
    drawings,
    setDrawings,
    activeTool,
    setActiveTool,
    selectedDrawingId,
    selectDrawing,
    pendingPoints,
    setPendingPoints,
    updateDrawing,
    deleteDrawing,
    duplicateDrawing,
    toggleLock,
    toggleVisibility,
    renameDrawing,
    clearAllDrawings,
    completeNewDrawing,
    undo,
    redo,
    canUndo,
    canRedo,
    addAlertToDrawing,
    removeAlertFromDrawing,
    toggleAlertStatus
  } = useChartDrawings(symbol);

  // Modals state
  const [isAlertModalOpen, setIsAlertModalOpen] = useState<boolean>(false);
  const [isManagerModalOpen, setIsManagerModalOpen] = useState<boolean>(false);
  const [areAllDrawingsVisible, setAreAllDrawingsVisible] = useState<boolean>(true);

  // Drawing Drag / Move state
  const drawingDragModeRef = useRef<'none' | 'drawing' | 'handle'>('none');
  const activeHandleIndexRef = useRef<number | null>(null);
  const drawingDragStartPointRef = useRef<ChartPoint | null>(null);
  const drawingSnapshotRef = useRef<ChartDrawing | null>(null);
  const coordCtxRef = useRef<CoordinateContext | null>(null);

  // Candle Wick Snapping State
  const [isSnapEnabled, setIsSnapEnabled] = useState<boolean>(() => {
    return localStorage.getItem('nwwt_snap_enabled') !== 'false';
  });

  const toggleSnap = useCallback(() => {
    setIsSnapEnabled((prev) => {
      const next = !prev;
      localStorage.setItem('nwwt_snap_enabled', String(next));
      return next;
    });
  }, []);

  // Drawing creation drag gesture refs (Press, Drag, Release lifecycle)
  const isDrawingDragRef = useRef<boolean>(false);
  const drawingDragStartPosRef = useRef<{ x: number; y: number } | null>(null);
  const drawingStartPointRef = useRef<ChartPoint | null>(null);
  const activeSnapRef = useRef<CandleSnapPoint | null>(null);

  // Cleared Signal Lines Registry (Auto-removal of TP/SL on touch)
  const [clearedSignalIds, setClearedSignalIds] = useState<Set<string>>(loadClearedSignalIds);

  useEffect(() => {
    const handleSignalCleared = (e: any) => {
      const id = e.detail?.signalId;
      if (id) {
        setClearedSignalIds((prev) => new Set(prev).add(id));
      }
    };
    window.addEventListener('nwwt_signal_cleared', handleSignalCleared);
    return () => window.removeEventListener('nwwt_signal_cleared', handleSignalCleared);
  }, []);

  // Real-time touch monitoring across live price ticks and candle wicks
  useEffect(() => {
    if (!activeSignal || activeSignal.status !== 'ACTIVE' || !activeSignal.entryPrice) return;
    if (clearedSignalIds.has(activeSignal.id)) return;

    const currentPrice = ticker && ticker.lastPrice !== '--'
      ? parseFloat(ticker.lastPrice)
      : (candles.length > 0 ? candles[candles.length - 1].close : null);

    const highPrice = ticker && ticker.highPrice !== '--' ? parseFloat(ticker.highPrice) : undefined;
    const lowPrice = ticker && ticker.lowPrice !== '--' ? parseFloat(ticker.lowPrice) : undefined;

    const touch = checkSignalTouch(activeSignal, currentPrice, highPrice, lowPrice, candles);

    if (touch.isTouched && touch.touchedLevel) {
      addClearedSignalId(activeSignal.id);
      setClearedSignalIds((prev) => new Set(prev).add(activeSignal.id));
      settleSignalOutcome(
        activeSignal.id,
        touch.touchedLevel === 'TP' ? 'WIN' : 'LOSS',
        touch.touchPrice,
        touch.reason
      );
    }
  }, [activeSignal, ticker, candles, clearedSignalIds]);

  const selectedDrawing = useMemo(() => {
    return drawings.find((d) => d.id === selectedDrawingId) || null;
  }, [drawings, selectedDrawingId]);

  const toggleAllVisibility = useCallback(() => {
    const next = !areAllDrawingsVisible;
    setAreAllDrawingsVisible(next);
    setDrawings(drawings.map((d) => ({ ...d, visible: next })));
  }, [areAllDrawingsVisible, drawings, setDrawings]);

  // --- TradingView Interactive Transformation State ---
  // Horizontal zoom (pixels per candle)
  const [candleWidth, setCandleWidth] = useState<number>(11);
  // Horizontal scroll pan (offset in candles from latest candle)
  // Negative values allow empty right margin space (just like TradingView!)
  const [panOffset, setPanOffset] = useState<number>(-12);
  // Vertical price offset in pixels (allows moving price up/down freely)
  const [priceOffset, setPriceOffset] = useState<number>(0);
  // Vertical price scale factor (stretch/compress)
  const [priceScaleRatio, setPriceScaleRatio] = useState<number>(1.0);
  // Auto-fit scale mode (true until user drags/scales price vertically)
  const [autoScale, setAutoScale] = useState<boolean>(true);

  // Market Structure toggle
  const [showMarketStructure, setShowMarketStructure] = useState<boolean>(() => {
    return localStorage.getItem('nwwt_show_market_structure') !== 'false';
  });

  // Swing High / Swing Low Sensitivity (pivot lookback candles: 1 to 4)
  const [swingSensitivity, setSwingSensitivity] = useState<number>(() => {
    const saved = localStorage.getItem('nwwt_swing_sensitivity');
    return saved ? parseInt(saved, 10) || 2 : 2;
  });

  // Structure Markers Toggle (HH, HL, LH, LL pivot tags)
  const [showStructureMarkers, setShowStructureMarkers] = useState<boolean>(() => {
    return localStorage.getItem('nwwt_show_structure_markers') !== 'false';
  });

  // Structure Breaks Toggle (BOS and CHoCH horizontal lines)
  const [showStructureBreaks, setShowStructureBreaks] = useState<boolean>(() => {
    return localStorage.getItem('nwwt_show_structure_breaks') !== 'false';
  });

  // Structure Settings Popover control
  const [isStructureSettingsOpen, setIsStructureSettingsOpen] = useState<boolean>(false);
  const structureSettingsRef = useRef<HTMLDivElement | null>(null);

  // Close structure settings on outside click
  useEffect(() => {
    const handleSettingsClickOutside = (e: MouseEvent) => {
      if (structureSettingsRef.current && !structureSettingsRef.current.contains(e.target as Node)) {
        setIsStructureSettingsOpen(false);
      }
    };
    if (isStructureSettingsOpen) {
      document.addEventListener('mousedown', handleSettingsClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleSettingsClickOutside);
  }, [isStructureSettingsOpen]);

  // Crosshair state
  const [mousePos, setMousePos] = useState<{ x: number; y: number } | null>(null);
  const [cursorStyle, setCursorStyle] = useState<string>('crosshair');

  // Drag interaction state
  const dragModeRef = useRef<'none' | 'chart' | 'priceScale' | 'timeScale'>('none');
  const dragStartPosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const initialPanOffsetRef = useRef<number>(-12);
  const initialPriceOffsetRef = useRef<number>(0);
  const initialPriceScaleRef = useRef<number>(1.0);
  const initialCandleWidthRef = useRef<number>(11);

  // Pinch zoom state
  const initialPinchDistanceRef = useRef<number | null>(null);
  const initialPinchCenterRef = useRef<{ x: number; y: number } | null>(null);

  // Timeframe dropdown state
  const [isTfDropdownOpen, setIsTfDropdownOpen] = useState<boolean>(false);

  // Full Screen Chart Toggle (Instruction 4)
  const [isFullScreen, setIsFullScreen] = useState<boolean>(false);

  // Scan Market specifically for active chart asset (Instruction 7)
  const [isScanningAsset, setIsScanningAsset] = useState<boolean>(false);
  const [scanFeedback, setScanFeedback] = useState<string | null>(null);

  // Progressive Disclosure Accordions (Instruction 6)
  const [isStructureDetailsOpen, setIsStructureDetailsOpen] = useState<boolean>(true);
  const [isPriceActionOpen, setIsPriceActionOpen] = useState<boolean>(false);
  const [isPatternsOpen, setIsPatternsOpen] = useState<boolean>(false);

  const handleScanChartAsset = useCallback(async () => {
    setIsScanningAsset(true);
    setScanFeedback(`Scanning ${symbol} (${timeframe}) with live market candles...`);
    try {
      const res = await fetch('/api/scanner/scan-asset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol, timeframe })
      });
      const data = await res.json();
      if (data && data.result) {
        if (data.result.signal) {
          setScanFeedback(`Setup Identified on ${symbol}: ${data.result.signal.direction} (${data.result.signal.setupType})`);
        } else if (data.result.pendingRetest) {
          setScanFeedback(`Retest Detected on ${symbol}: Pulling back to $${formatPrice(data.result.pendingRetest.targetLevel)}`);
        } else {
          setScanFeedback(`Scan Complete on ${symbol} (${timeframe}): No confirmed setup. Waiting for break or retest.`);
        }
      } else {
        setScanFeedback(`Scan complete for ${symbol}.`);
      }
    } catch (err: any) {
      setScanFeedback(`Scan error for ${symbol}: ${err.message || 'Check connection'}`);
    } finally {
      setIsScanningAsset(false);
      setTimeout(() => {
        setScanFeedback(null);
      }, 7000);
    }
  }, [symbol, timeframe]);

  // Container dimensions from ResizeObserver
  const [containerSize, setContainerSize] = useState<{ width: number; height: number }>({ width: 0, height: 0 });
  const chartDimsRef = useRef<{ width: number; height: number; chartWidth: number; chartHeight: number }>({
    width: 800,
    height: 450,
    chartWidth: 730,
    chartHeight: 424
  });

  // Persist market structure toggle preference
  useEffect(() => {
    localStorage.setItem('nwwt_show_market_structure', String(showMarketStructure));
  }, [showMarketStructure]);

  // ResizeObserver to track container dimensions immediately
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 20 && height > 20) {
          setContainerSize({ width: Math.round(width), height: Math.round(height) });
        }
      }
    });

    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  // Fetch real Binance historical candles with automatic retry and abort protection
  const handleManualRetry = useCallback(() => {
    if (!symbol) return;
    setIsLoading(true);
    setFetchError(null);
    fetch(`/api/klines?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(timeframe)}&limit=250`)
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load Binance candles (${res.status})`);
        return res.json();
      })
      .then((data) => {
        if (Array.isArray(data.candles)) {
          setCandles(data.candles);
          setFetchError(null);
          setPanOffset(-12);
          setPriceOffset(0);
          setPriceScaleRatio(1.0);
          setAutoScale(true);
        } else {
          setCandles([]);
        }
      })
      .catch((err) => {
        console.warn('[CandlestickChart] Manual retry error:', err.message);
        setFetchError(err.message || 'Error loading historical candles');
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, [symbol, timeframe]);

  useEffect(() => {
    let isCancelled = false;
    const controller = new AbortController();

    async function fetchWithRetry(retry = 0) {
      if (!symbol || isCancelled) return;
      setIsLoading(true);
      setFetchError(null);

      try {
        const res = await fetch(
          `/api/klines?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(timeframe)}&limit=250`,
          { signal: controller.signal }
        );
        if (!res.ok) {
          throw new Error(`Failed to load Binance candles (${res.status})`);
        }
        const data = await res.json();
        if (isCancelled) return;

        if (Array.isArray(data.candles) && data.candles.length > 0) {
          setCandles(data.candles);
          setFetchError(null);
          setPanOffset(-12);
          setPriceOffset(0);
          setPriceScaleRatio(1.0);
          setAutoScale(true);
        } else if (Array.isArray(data.candles)) {
          setCandles(data.candles);
        } else {
          setCandles([]);
        }
      } catch (err: any) {
        if (isCancelled || err.name === 'AbortError') return;
        if (retry < 2) {
          setTimeout(() => {
            if (!isCancelled) fetchWithRetry(retry + 1);
          }, 800);
          return;
        }
        console.warn('[CandlestickChart] Error loading klines:', err.message);
        setFetchError(err.message || 'Error loading historical candles');
      } finally {
        if (!isCancelled) {
          setIsLoading(false);
        }
      }
    }

    fetchWithRetry();

    return () => {
      isCancelled = true;
      controller.abort();
    };
  }, [symbol, timeframe]);

  // Real-time candle updates:
  // Dynamically update active candle's close, high, low, wicks with live Binance ticks
  useEffect(() => {
    if (!ticker || ticker.lastPrice === '--') return;

    const currentPrice = parseFloat(ticker.lastPrice);
    if (isNaN(currentPrice)) return;

    const tickTime = ticker.lastUpdateTime || Date.now();
    const intervalMs = getTimeframeDurationMs(timeframe);

    setCandles((prevCandles) => {
      if (prevCandles.length === 0) {
        const openTime = Math.floor(tickTime / intervalMs) * intervalMs;
        const newCandle: Candle = {
          openTime,
          open: currentPrice,
          high: currentPrice,
          low: currentPrice,
          close: currentPrice,
          volume: parseFloat(ticker.volume) || 0,
          closeTime: openTime + intervalMs
        };
        return [newCandle];
      }

      const lastIdx = prevCandles.length - 1;
      const lastCandle = prevCandles[lastIdx];

      // If tick time surpassed interval duration, append new candle
      if (tickTime >= lastCandle.openTime + intervalMs) {
        const newOpenTime = Math.floor(tickTime / intervalMs) * intervalMs;
        const newCandle: Candle = {
          openTime: newOpenTime,
          open: currentPrice,
          high: currentPrice,
          low: currentPrice,
          close: currentPrice,
          volume: 0,
          closeTime: newOpenTime + intervalMs
        };
        return [...prevCandles, newCandle];
      } else {
        // Update active candle in real time
        const updatedLast: Candle = {
          ...lastCandle,
          close: currentPrice,
          high: Math.max(lastCandle.high, currentPrice),
          low: Math.min(lastCandle.low, currentPrice),
          closeTime: tickTime
        };
        const next = [...prevCandles];
        next[lastIdx] = updatedLast;
        return next;
      }
    });
  }, [ticker, timeframe]);

  // Calculate Market Structure from actual candle data with adjustable swing sensitivity
  const marketStructure: MarketStructureResult = useMemo(() => {
    return calculateMarketStructure(candles, swingSensitivity);
  }, [candles, swingSensitivity]);

  const currentPriceVal = useMemo(() => {
    if (candles.length > 0) return candles[candles.length - 1].close;
    if (ticker?.lastPrice && ticker.lastPrice !== '--') return parseFloat(ticker.lastPrice);
    return 0;
  }, [candles, ticker]);

  // Drawing Alerts Hook
  const {
    notifications,
    notificationHistory,
    dismissNotification,
    clearNotificationHistory
  } = useDrawingAlerts(symbol, timeframe, drawings, currentPriceVal, candles, setDrawings);

  // Keyboard Shortcuts for Drawings (Delete, Escape, Ctrl+Z, Ctrl+Y)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)) {
        return;
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedDrawingId) {
          const d = drawings.find((item) => item.id === selectedDrawingId);
          if (d && !d.locked) {
            deleteDrawing(selectedDrawingId);
          }
        }
      } else if (e.key === 'Escape') {
        if (activeTool !== 'cursor') {
          setActiveTool('cursor');
          setPendingPoints([]);
        } else if (selectedDrawingId) {
          selectDrawing(null);
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          redo();
        } else {
          undo();
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedDrawingId, drawings, activeTool, deleteDrawing, selectDrawing, setActiveTool, setPendingPoints, undo, redo]);

  const scanResult: ScannerAnalysisResult = useMemo(() => {
    return runChartScan(
      symbol,
      timeframe,
      candles,
      {
        latestCandleVolume: candles.length > 0 ? candles[candles.length - 1].volume : 0,
        total24hVolume: ticker?.volume || '0',
        quoteVolume: ticker?.quoteVolume
      },
      marketStructure,
      currentPriceVal
    );
  }, [symbol, timeframe, candles, marketStructure, currentPriceVal, ticker]);

  // Reset View to latest price & auto-scale
  const handleResetView = useCallback(() => {
    setCandleWidth(11);
    setPanOffset(-12);
    setPriceOffset(0);
    setPriceScaleRatio(1.0);
    setAutoScale(true);
  }, []);

  // Zoom controls (+ / - buttons)
  const handleZoom = useCallback((direction: 'in' | 'out') => {
    const factor = direction === 'in' ? 1.25 : 0.8;
    const { chartWidth } = chartDimsRef.current;
    const focalX = chartWidth / 2;

    setCandleWidth((prevWidth) => {
      const newWidth = Math.max(3, Math.min(65, prevWidth * factor));
      const panShift = (chartWidth - focalX) * (1 / prevWidth - 1 / newWidth);
      setPanOffset((prevPan) => prevPan + panShift);
      return newWidth;
    });
  }, []);

  // --- Focal-Point Mouse Wheel Zoom ---
  const handleWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const { chartWidth } = chartDimsRef.current;

    const zoomIn = e.deltaY < 0;
    const factor = zoomIn ? 1.12 : 0.89;

    // Wheel over right price scale -> zoom vertical price scale
    if (mouseX >= chartWidth) {
      setAutoScale(false);
      setPriceScaleRatio((prev) => Math.max(0.1, Math.min(10, prev * factor)));
      return;
    }

    // Wheel over chart or time scale -> focal point zoom centered exactly at mouseX!
    setCandleWidth((prevWidth) => {
      const newWidth = Math.max(3, Math.min(65, prevWidth * factor));
      const focalX = Math.min(chartWidth, Math.max(0, mouseX));
      // Exact focal point math: candle at focalX remains at focalX after zoom
      const panShift = (chartWidth - focalX) * (1 / prevWidth - 1 / newWidth);
      setPanOffset((prevPan) => prevPan + panShift);
      return newWidth;
    });
  }, []);

  // --- Pointer Down (Mouse & Touch start) ---
  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    try {
      canvas.setPointerCapture(e.pointerId);
    } catch (err) {}

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const { chartWidth, chartHeight } = chartDimsRef.current;
    const coordCtx = coordCtxRef.current;

    dragStartPosRef.current = { x: e.clientX, y: e.clientY };
    initialPanOffsetRef.current = panOffset;
    initialPriceOffsetRef.current = priceOffset;
    initialPriceScaleRef.current = priceScaleRatio;
    initialCandleWidthRef.current = candleWidth;

    if (x >= chartWidth) {
      dragModeRef.current = 'priceScale';
      setCursorStyle('ns-resize');
      return;
    } else if (y >= chartHeight) {
      dragModeRef.current = 'timeScale';
      setCursorStyle('ew-resize');
      return;
    }

    if (!coordCtx) {
      dragModeRef.current = 'chart';
      setCursorStyle('grabbing');
      return;
    }

    // DRAWING CREATION MODE
    if (activeTool !== 'cursor') {
      dragModeRef.current = 'none';

      let clickPoint: ChartPoint;
      if (isSnapEnabled && coordCtx) {
        const snap = findCandleSnap(x, y, coordCtx);
        clickPoint = snap ? { time: snap.time, price: snap.price } : { time: xToTime(x, coordCtx), price: convertYToPrice(y, coordCtx) };
        activeSnapRef.current = snap;
      } else {
        clickPoint = { time: xToTime(x, coordCtx), price: convertYToPrice(y, coordCtx) };
        activeSnapRef.current = null;
      }

      if (activeTool === 'horizontal_line' || activeTool === 'vertical_line') {
        completeNewDrawing(activeTool, [clickPoint]);
        isDrawingDragRef.current = false;
        drawingDragStartPosRef.current = null;
        drawingStartPointRef.current = null;
      } else {
        if (pendingPoints.length === 0) {
          isDrawingDragRef.current = true;
          drawingDragStartPosRef.current = { x, y };
          drawingStartPointRef.current = clickPoint;
          setPendingPoints([clickPoint]);
        } else {
          completeNewDrawing(activeTool, [...pendingPoints, clickPoint]);
          isDrawingDragRef.current = false;
          drawingDragStartPosRef.current = null;
          drawingStartPointRef.current = null;
          activeSnapRef.current = null;
        }
      }
      return;
    }

    // CURSOR SELECTION & MANIPULATION MODE
    const revDrawings = [...drawings].reverse();
    let hitItem: { drawing: ChartDrawing; handleIndex: number | null } | null = null;

    for (const d of revDrawings) {
      const res = hitTestDrawing(d, x, y, coordCtx, 9);
      if (res.isHit) {
        hitItem = { drawing: d, handleIndex: res.handleIndex };
        break;
      }
    }

    if (hitItem) {
      selectDrawing(hitItem.drawing.id);
      if (!hitItem.drawing.locked) {
        drawingDragModeRef.current = hitItem.handleIndex !== null ? 'handle' : 'drawing';
        activeHandleIndexRef.current = hitItem.handleIndex;
        drawingDragStartPointRef.current = {
          time: xToTime(x, coordCtx),
          price: convertYToPrice(y, coordCtx)
        };
        drawingSnapshotRef.current = {
          ...hitItem.drawing,
          points: hitItem.drawing.points.map((p) => ({ ...p }))
        };
        setCursorStyle(hitItem.handleIndex !== null ? 'crosshair' : 'move');
      }
      return;
    }

    // No drawing hit: deselect and allow standard chart pan
    selectDrawing(null);
    dragModeRef.current = 'chart';
    setCursorStyle('grabbing');
  }, [panOffset, priceOffset, priceScaleRatio, candleWidth, activeTool, pendingPoints, completeNewDrawing, setPendingPoints, drawings, selectDrawing, isSnapEnabled]);

  // --- Pointer Move (Mouse & Touch drag) ---
  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const { chartWidth, chartHeight } = chartDimsRef.current;
    const coordCtx = coordCtxRef.current;

    setMousePos({ x, y });

    // Update candle wick snapping point
    if (coordCtx && isSnapEnabled) {
      const snap = findCandleSnap(x, y, coordCtx);
      activeSnapRef.current = snap;
    } else {
      activeSnapRef.current = null;
    }

    // When a drawing tool is active, continuously display preview and prevent chart pan
    if (activeTool !== 'cursor') {
      dragModeRef.current = 'none';
      setCursorStyle('crosshair');
      return;
    }

    // Handling Drawing Drag / Resize
    if (drawingDragModeRef.current !== 'none' && drawingSnapshotRef.current && coordCtx && drawingDragStartPointRef.current) {
      let currentHoverPoint: ChartPoint;

      if (isSnapEnabled && activeSnapRef.current && drawingDragModeRef.current === 'handle') {
        currentHoverPoint = { time: activeSnapRef.current.time, price: activeSnapRef.current.price };
      } else {
        currentHoverPoint = {
          time: xToTime(x, coordCtx),
          price: convertYToPrice(y, coordCtx)
        };
      }

      const deltaPrice = currentHoverPoint.price - drawingDragStartPointRef.current.price;
      const deltaTime = currentHoverPoint.time - drawingDragStartPointRef.current.time;
      const initialDrawing = drawingSnapshotRef.current;

      if (drawingDragModeRef.current === 'drawing') {
        const newPoints = initialDrawing.points.map((p) => ({
          time: p.time + deltaTime,
          price: p.price + deltaPrice
        }));
        updateDrawing(initialDrawing.id, { points: newPoints });
      } else if (drawingDragModeRef.current === 'handle' && activeHandleIndexRef.current !== null) {
        const handleIdx = activeHandleIndexRef.current;
        const newPoints = initialDrawing.points.map((p, idx) =>
          idx === handleIdx ? currentHoverPoint : p
        );
        updateDrawing(initialDrawing.id, { points: newPoints });
      }
      return;
    }

    if (dragModeRef.current === 'none') {
      if (x >= chartWidth) {
        setCursorStyle('ns-resize');
      } else if (y >= chartHeight) {
        setCursorStyle('ew-resize');
      } else if (activeTool !== 'cursor') {
        setCursorStyle('crosshair');
      } else {
        // Hover test on drawings
        if (coordCtxRef.current) {
          const revDrawings = [...drawings].reverse();
          let hovered = false;
          for (const d of revDrawings) {
            const res = hitTestDrawing(d, x, y, coordCtxRef.current, 8);
            if (res.isHit) {
              setCursorStyle(res.handleIndex !== null ? 'pointer' : 'move');
              hovered = true;
              break;
            }
          }
          if (!hovered) setCursorStyle('crosshair');
        } else {
          setCursorStyle('crosshair');
        }
      }
      return;
    }

    const deltaX = e.clientX - dragStartPosRef.current.x;
    const deltaY = e.clientY - dragStartPosRef.current.y;

    if (dragModeRef.current === 'chart') {
      // 1. Horizontal Pan (free scrolling left and right)
      const candlesMoved = deltaX / candleWidth;
      const newPan = initialPanOffsetRef.current + candlesMoved;
      const maxPan = candles.length - 2;
      const minPan = -45;
      setPanOffset(Math.max(minPan, Math.min(maxPan, newPan)));

      // 2. Vertical Pan
      setAutoScale(false);
      setPriceOffset(initialPriceOffsetRef.current + deltaY);
    } else if (dragModeRef.current === 'priceScale') {
      setAutoScale(false);
      const scaleMultiplier = Math.pow(1.008, deltaY);
      setPriceScaleRatio(Math.max(0.1, Math.min(10, initialPriceScaleRef.current * scaleMultiplier)));
    } else if (dragModeRef.current === 'timeScale') {
      const scaleMultiplier = Math.pow(1.008, deltaX);
      const newWidth = Math.max(3, Math.min(65, initialCandleWidthRef.current * scaleMultiplier));
      setCandleWidth(newWidth);
    }
  }, [candleWidth, candles.length, activeTool, drawings, updateDrawing, isSnapEnabled]);

  // --- Pointer Up (Mouse & Touch end) ---
  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (canvas) {
      try {
        canvas.releasePointerCapture(e.pointerId);
      } catch (err) {}
    }

    const rect = canvas ? canvas.getBoundingClientRect() : null;
    const x = rect ? e.clientX - rect.left : 0;
    const y = rect ? e.clientY - rect.top : 0;
    const coordCtx = coordCtxRef.current;

    // 1. DRAG-TO-DRAW LIFECYCLE (Fix for disappearing drawings during drag)
    if (
      isDrawingDragRef.current &&
      pendingPoints.length === 1 &&
      drawingStartPointRef.current &&
      drawingDragStartPosRef.current &&
      coordCtx &&
      activeTool !== 'cursor'
    ) {
      const startPos = drawingDragStartPosRef.current;
      const dist = Math.hypot(x - startPos.x, y - startPos.y);

      // If finger or mouse dragged more than 8 pixels, finalize immediately!
      if (dist >= 8) {
        let endPt: ChartPoint;
        if (isSnapEnabled && activeSnapRef.current) {
          endPt = { time: activeSnapRef.current.time, price: activeSnapRef.current.price };
        } else {
          endPt = { time: xToTime(x, coordCtx), price: convertYToPrice(y, coordCtx) };
        }

        completeNewDrawing(activeTool, [drawingStartPointRef.current, endPt]);
        isDrawingDragRef.current = false;
        drawingDragStartPosRef.current = null;
        drawingStartPointRef.current = null;
        activeSnapRef.current = null;
        setCursorStyle('crosshair');
        return;
      } else {
        // Just a tap without dragging: keep pendingPoints so user can do click-move-click
        isDrawingDragRef.current = false;
      }
    }

    if (drawingDragModeRef.current !== 'none') {
      drawingDragModeRef.current = 'none';
      activeHandleIndexRef.current = null;
      drawingDragStartPointRef.current = null;
      drawingSnapshotRef.current = null;
      activeSnapRef.current = null;
      setCursorStyle('crosshair');
      return;
    }

    dragModeRef.current = 'none';
    setCursorStyle('crosshair');
  }, [activeTool, pendingPoints, completeNewDrawing, isSnapEnabled]);

  const handlePointerLeave = useCallback(() => {
    if (dragModeRef.current === 'none') {
      if (pendingPoints.length === 0 && activeTool === 'cursor') {
        setMousePos(null);
      }
      activeSnapRef.current = null;
      setCursorStyle('crosshair');
    }
  }, [pendingPoints.length, activeTool]);

  // Double click price scale to auto-fit
  const handleDoubleClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const { chartWidth } = chartDimsRef.current;

    if (x >= chartWidth) {
      setAutoScale(true);
      setPriceOffset(0);
      setPriceScaleRatio(1.0);
    }
  }, []);

  // Attach non-passive touch listeners directly to canvas so table NEVER scrolls while dragging chart
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        e.preventDefault();
        dragModeRef.current = 'none';
        const t1 = e.touches[0];
        const t2 = e.touches[1];
        const dist = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
        initialPinchDistanceRef.current = dist;
        initialCandleWidthRef.current = candleWidth;
        initialPanOffsetRef.current = panOffset;

        const rect = canvas.getBoundingClientRect();
        const midX = (t1.clientX + t2.clientX) / 2 - rect.left;
        const midY = (t1.clientY + t2.clientY) / 2 - rect.top;
        initialPinchCenterRef.current = { x: midX, y: midY };
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      // Prevent browser table scrolling when touching chart canvas
      e.preventDefault();

      if (e.touches.length === 2 && initialPinchDistanceRef.current !== null) {
        const t1 = e.touches[0];
        const t2 = e.touches[1];
        const currentDist = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
        const scale = currentDist / initialPinchDistanceRef.current;

        const newWidth = Math.max(3, Math.min(65, initialCandleWidthRef.current * scale));
        const focalX = initialPinchCenterRef.current
          ? initialPinchCenterRef.current.x
          : chartDimsRef.current.chartWidth / 2;
        const { chartWidth } = chartDimsRef.current;

        const panShift = (chartWidth - focalX) * (1 / initialCandleWidthRef.current - 1 / newWidth);
        setCandleWidth(newWidth);
        setPanOffset(initialPanOffsetRef.current + panShift);
      }
    };

    const onTouchEnd = () => {
      initialPinchDistanceRef.current = null;
      initialPinchCenterRef.current = null;
    };

    canvas.addEventListener('touchstart', onTouchStart, { passive: false });
    canvas.addEventListener('touchmove', onTouchMove, { passive: false });
    canvas.addEventListener('touchend', onTouchEnd, { passive: true });
    canvas.addEventListener('touchcancel', onTouchEnd, { passive: true });

    return () => {
      canvas.removeEventListener('touchstart', onTouchStart);
      canvas.removeEventListener('touchmove', onTouchMove);
      canvas.removeEventListener('touchend', onTouchEnd);
      canvas.removeEventListener('touchcancel', onTouchEnd);
    };
  }, [candleWidth, panOffset]);

  // --- Main Canvas Rendering Engine ---
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth || containerSize.width || 800;
    const height = canvas.clientHeight || containerSize.height || 450;

    if (width <= 0 || height <= 0) return;

    if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
      canvas.width = width * dpr;
      canvas.height = height * dpr;
    }

    ctx.save();
    ctx.scale(dpr, dpr);

    const rightMargin = 72; // Width of price axis
    const bottomMargin = 26; // Height of time axis
    const chartWidth = Math.max(50, width - rightMargin);
    const chartHeight = Math.max(50, height - bottomMargin);

    chartDimsRef.current = { width, height, chartWidth, chartHeight };

    // Dark TradingView Background
    ctx.fillStyle = '#08090d';
    ctx.fillRect(0, 0, width, height);

    if (candles.length === 0) {
      ctx.restore();
      return;
    }

    // Determine Visible Candle Range based on candleWidth and panOffset
    const visibleCount = Math.ceil(chartWidth / candleWidth) + 3;
    const rawEndIndex = Math.round(candles.length - 1 - panOffset);
    // Allow forward margin space while clamping to valid candle array
    const safeEndIndex = Math.min(candles.length - 1, Math.max(0, rawEndIndex));
    const startIndex = Math.max(0, safeEndIndex - visibleCount);

    const visibleCandles = safeEndIndex >= startIndex ? candles.slice(startIndex, safeEndIndex + 1) : [];

    // Determine Price Bounds
    let minPrice = Infinity;
    let maxPrice = -Infinity;

    if (visibleCandles.length > 0) {
      for (const c of visibleCandles) {
        if (c.low < minPrice) minPrice = c.low;
        if (c.high > maxPrice) maxPrice = c.high;
      }
    } else {
      const last = candles[candles.length - 1];
      minPrice = last ? last.low : 100;
      maxPrice = last ? last.high : 100;
    }

    const naturalSpan = maxPrice - minPrice || 1;
    const paddedNaturalMin = minPrice - naturalSpan * 0.08;
    const paddedNaturalMax = maxPrice + naturalSpan * 0.08;

    // Apply Vertical Price Offset and Price Scale Ratio (when user drags/scales price)
    let effectiveMin: number;
    let effectiveMax: number;

    if (autoScale) {
      effectiveMin = paddedNaturalMin;
      effectiveMax = paddedNaturalMax;
    } else {
      const centerPrice = (paddedNaturalMin + paddedNaturalMax) / 2;
      const halfSpan = ((paddedNaturalMax - paddedNaturalMin) / 2) * priceScaleRatio;
      const pricePerPixel = (halfSpan * 2) / chartHeight;
      const priceShift = priceOffset * pricePerPixel;

      effectiveMin = centerPrice - halfSpan + priceShift;
      effectiveMax = centerPrice + halfSpan + priceShift;
    }

    const effectiveRange = effectiveMax - effectiveMin || 1;

    const priceToY = (price: number) => {
      return chartHeight - ((price - effectiveMin) / effectiveRange) * chartHeight;
    };

    const yToPrice = (y: number) => {
      return effectiveMin + ((chartHeight - y) / chartHeight) * effectiveRange;
    };

    // 1. Draw Clean Grid Lines & Right Price Scale Axis
    const priceStep = getNicePriceStep(effectiveRange, 7);
    const firstTickPrice = Math.floor(effectiveMin / priceStep) * priceStep;

    ctx.lineWidth = 1;
    for (let p = firstTickPrice; p <= effectiveMax + priceStep; p += priceStep) {
      const y = priceToY(p);
      if (y >= 0 && y <= chartHeight) {
        // Horizontal grid line
        ctx.strokeStyle = '#1e222d';
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(chartWidth, y);
        ctx.stroke();

        // Right margin price label
        ctx.fillStyle = '#787b86';
        ctx.font = '10px monospace';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(formatPrice(p), chartWidth + 7, y);
      }
    }

    // Right scale border
    ctx.strokeStyle = '#2a2e39';
    ctx.beginPath();
    ctx.moveTo(chartWidth, 0);
    ctx.lineTo(chartWidth, height);
    ctx.stroke();

    // Bottom scale border
    ctx.beginPath();
    ctx.moveTo(0, chartHeight);
    ctx.lineTo(width, chartHeight);
    ctx.stroke();

    // 2. Draw Candlesticks & Time Axis Ticks
    const candleSpacing = Math.max(1, candleWidth * 0.22);
    const bodyWidth = Math.max(1.2, candleWidth - candleSpacing);

    const candleCoordinates: { index: number; x: number; candle: Candle }[] = [];

    for (let i = startIndex; i <= safeEndIndex; i++) {
      const c = candles[i];
      if (!c) continue;

      // Calculate center X coordinate of candle
      const x = chartWidth - (rawEndIndex - i + 0.5) * candleWidth;
      candleCoordinates.push({ index: i, x, candle: c });

      // Clip rendering to visible area with buffer
      if (x < -candleWidth || x > chartWidth + candleWidth) continue;

      const isUp = c.close >= c.open;
      const candleColor = isUp ? '#089981' : '#f23645'; // TradingView Bull Green / Bear Red

      const openY = priceToY(c.open);
      const closeY = priceToY(c.close);
      const highY = priceToY(c.high);
      const lowY = priceToY(c.low);

      // Wick
      ctx.strokeStyle = candleColor;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(x, highY);
      ctx.lineTo(x, lowY);
      ctx.stroke();

      // Body
      const bodyTop = Math.min(openY, closeY);
      const bodyHeight = Math.max(1.5, Math.abs(closeY - openY));

      ctx.fillStyle = candleColor;
      ctx.fillRect(x - bodyWidth / 2, bodyTop, bodyWidth, bodyHeight);

      // Time axis ticks
      if (Math.round(x) % 85 < Math.round(candleWidth)) {
        // Vertical grid line
        ctx.strokeStyle = '#181c27';
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, chartHeight);
        ctx.stroke();

        // Time axis label
        ctx.fillStyle = '#787b86';
        ctx.font = '9px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        const d = new Date(c.openTime);
        const timeStr = timeframe.includes('d') || timeframe.includes('w') || timeframe.includes('M')
          ? `${d.getUTCMonth() + 1}/${d.getUTCDate()}`
          : `${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
        ctx.fillText(timeStr, x, chartHeight + 6);
      }
    }

    // 3. Draw Market Structure (HH, HL, LH, LL, BOS, CHoCH)
    if (showMarketStructure) {
      const coordMap = new Map<number, number>();
      candleCoordinates.forEach((item) => coordMap.set(item.index, item.x));

      // Draw Structural Breaks (BOS / CHoCH horizontal lines) if enabled
      if (showStructureBreaks) {
        marketStructure.structureBreaks.forEach((sb) => {
          const originX = coordMap.get(sb.originIndex);
          const breakX = coordMap.get(sb.breakIndex);

          if (originX !== undefined || breakX !== undefined) {
            const startX = originX !== undefined ? originX : 0;
            const endX = breakX !== undefined ? breakX : chartWidth;
            const y = priceToY(sb.originPrice);

            if (y >= 0 && y <= chartHeight) {
              const isBull = sb.direction === 'bullish';
              const lineColor = sb.type === 'CHoCH'
                ? '#38bdf8' // Cyan for CHoCH
                : isBull ? '#34d399' : '#f87171'; // Green / Red for BOS

              ctx.save();
              ctx.setLineDash([4, 4]);
              ctx.strokeStyle = lineColor;
              ctx.lineWidth = 1.2;
              ctx.beginPath();
              ctx.moveTo(Math.max(0, startX), y);
              ctx.lineTo(Math.min(chartWidth, endX), y);
              ctx.stroke();
              ctx.restore();

              // Label badge
              const midX = (Math.max(0, startX) + Math.min(chartWidth, endX)) / 2;
              const label = `${sb.type}`;
              ctx.font = 'bold 9px sans-serif';
              const textWidth = ctx.measureText(label).width;

              ctx.fillStyle = '#1e222d';
              ctx.fillRect(midX - textWidth / 2 - 4, y - 7, textWidth + 8, 14);
              ctx.strokeStyle = lineColor;
              ctx.lineWidth = 1;
              ctx.strokeRect(midX - textWidth / 2 - 4, y - 7, textWidth + 8, 14);

              ctx.fillStyle = lineColor;
              ctx.textAlign = 'center';
              ctx.textBaseline = 'middle';
              ctx.fillText(label, midX, y);
            }
          }
        });
      }

      // Draw Swing Points (HH, HL, LH, LL markers) if enabled
      // Prioritize meaningful structural pivot points instead of flooding the chart with every small movement
      if (showStructureMarkers) {
        const breakOrigins = new Set(marketStructure.structureBreaks.map((sb) => sb.originIndex));

        // Filter to visible swing points on current canvas view
        const visiblePoints = marketStructure.swingPoints.filter((sp) => {
          const x = coordMap.get(sp.index);
          return x !== undefined && x >= 0 && x <= chartWidth;
        });

        // Prioritize key structure breaks and latest structural extremes (up to 8 points)
        const meaningfulPoints = [...visiblePoints]
          .sort((a, b) => {
            const aBreak = breakOrigins.has(a.index) ? 1 : 0;
            const bBreak = breakOrigins.has(b.index) ? 1 : 0;
            if (aBreak !== bBreak) return bBreak - aBreak;
            return b.index - a.index;
          })
          .slice(0, 8);

        meaningfulPoints.forEach((sp) => {
          const x = coordMap.get(sp.index);
          if (x !== undefined && x >= 0 && x <= chartWidth) {
            const y = priceToY(sp.price);
            if (y >= 0 && y <= chartHeight) {
              const isHigh = sp.isHigh;
              const labelY = isHigh ? y - 10 : y + 12;

              const isBullishType = sp.type === 'HH' || sp.type === 'HL';
              const badgeBg = isBullishType ? 'rgba(16, 185, 129, 0.25)' : 'rgba(239, 68, 68, 0.25)';
              const badgeBorder = isBullishType ? '#10b981' : '#ef4444';
              const badgeText = isBullishType ? '#34d399' : '#f87171';

              ctx.font = 'bold 8.5px monospace';
              const textWidth = ctx.measureText(sp.type).width;

              ctx.fillStyle = badgeBg;
              ctx.fillRect(x - textWidth / 2 - 3, labelY - 6, textWidth + 6, 12);
              ctx.strokeStyle = badgeBorder;
              ctx.lineWidth = 0.8;
              ctx.strokeRect(x - textWidth / 2 - 3, labelY - 6, textWidth + 6, 12);

              ctx.fillStyle = badgeText;
              ctx.textAlign = 'center';
              ctx.textBaseline = 'middle';
              ctx.fillText(sp.type, x, labelY);
            }
          }
        });
      }
    }

    // 3.5 Draw Active Signal Entry, Take Profit, and Stop Loss Levels
    // AUTO-REMOVAL: When either TP or SL is touched by live tick or candle wicks, both lines are immediately removed
    const isSignalCleared = activeSignal ? clearedSignalIds.has(activeSignal.id) : true;

    if (activeSignal && activeSignal.status === 'ACTIVE' && activeSignal.entryPrice && !isSignalCleared) {
      const livePrice = ticker && ticker.lastPrice !== '--'
        ? parseFloat(ticker.lastPrice)
        : (candles.length > 0 ? candles[candles.length - 1].close : null);
      const liveHigh = ticker && ticker.highPrice !== '--' ? parseFloat(ticker.highPrice) : undefined;
      const liveLow = ticker && ticker.lowPrice !== '--' ? parseFloat(ticker.lowPrice) : undefined;

      const frameTouch = checkSignalTouch(activeSignal, livePrice, liveHigh, liveLow, candles);

      if (frameTouch.isTouched && frameTouch.touchedLevel) {
        // Immediate frame suppression: register cleared so lines vanish immediately without waiting for state re-render
        addClearedSignalId(activeSignal.id);
        settleSignalOutcome(
          activeSignal.id,
          frameTouch.touchedLevel === 'TP' ? 'WIN' : 'LOSS',
          frameTouch.touchPrice,
          frameTouch.reason
        );
        // Both lines are removed immediately (do not draw)
      } else {
        const drawSignalLevel = (price: number, label: string, color: string, badgeBg: string) => {
          const y = priceToY(price);
          if (y >= 0 && y <= chartHeight) {
            ctx.save();
            ctx.setLineDash([5, 4]);
            ctx.strokeStyle = color;
            ctx.lineWidth = 1.3;
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(chartWidth, y);
            ctx.stroke();
            ctx.restore();

            // Right Price Scale Tag
            ctx.fillStyle = badgeBg;
            ctx.fillRect(chartWidth + 1, y - 8, rightMargin - 2, 16);
            ctx.strokeStyle = color;
            ctx.lineWidth = 1;
            ctx.strokeRect(chartWidth + 1, y - 8, rightMargin - 2, 16);

            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 9px monospace';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.fillText(`${label}`, chartWidth + 4, y);

            // Left Chart Watermark
            ctx.fillStyle = color;
            ctx.font = 'bold 9.5px monospace';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'bottom';
            ctx.fillText(`${label} $${formatPrice(price)}`, 10, y - 2);
          }
        };

        drawSignalLevel(activeSignal.entryPrice, 'ENTRY', '#f59e0b', '#b45309');
        drawSignalLevel(activeSignal.takeProfit, 'TP', '#10b981', '#047857');
        drawSignalLevel(activeSignal.stopLoss, 'SL', '#ef4444', '#b91c1c');
      }
    }

    // 3.6 Coordinate Context & User Chart Drawings
    const coordCtx: CoordinateContext = {
      candles,
      timeframe,
      candleWidth,
      panOffset,
      chartWidth,
      chartHeight,
      effectiveMin,
      effectiveRange
    };
    coordCtxRef.current = coordCtx;

    for (const drawing of drawings) {
      const isSelected = selectedDrawingId === drawing.id;
      drawChartElement(ctx, drawing, coordCtx, isSelected);
    }

    // 3.7 Draw In-Progress Drawing Preview
    if (pendingPoints.length > 0 && mousePos && activeTool !== 'cursor') {
      let hoverPt: ChartPoint;
      if (isSnapEnabled && activeSnapRef.current) {
        hoverPt = {
          time: activeSnapRef.current.time,
          price: activeSnapRef.current.price
        };
      } else {
        hoverPt = {
          time: xToTime(mousePos.x, coordCtx),
          price: convertYToPrice(mousePos.y, coordCtx)
        };
      }

      const previewDrawing: ChartDrawing = {
        id: 'preview',
        asset: symbol,
        type: activeTool,
        name: 'Preview',
        points: [...pendingPoints, hoverPt],
        color: '#f59e0b',
        fillColor: '#f59e0b',
        fillOpacity: 0.14,
        thickness: 2,
        lineStyle: 'dashed',
        glow: true,
        glowColor: '#f59e0b',
        glowIntensity: 6,
        locked: false,
        visible: true,
        alerts: [],
        createdAt: 0,
        updatedAt: 0
      };
      drawChartElement(ctx, previewDrawing, coordCtx, false);
    }

    // 3.8 Draw Candle Wick Snapping Magnet Reticle
    if (isSnapEnabled && activeSnapRef.current && (activeTool !== 'cursor' || drawingDragModeRef.current === 'handle')) {
      drawSnapIndicator(ctx, activeSnapRef.current);
    }

    // 4. Draw Current Live Market Price Line & Tag
    const latestCandle = candles[candles.length - 1];
    if (latestCandle) {
      const currentPrice = latestCandle.close;
      const currentY = priceToY(currentPrice);

      if (currentY >= 0 && currentY <= chartHeight) {
        ctx.save();
        ctx.setLineDash([3, 3]);
        ctx.strokeStyle = '#2962ff';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, currentY);
        ctx.lineTo(chartWidth, currentY);
        ctx.stroke();
        ctx.restore();

        // Right margin live price badge
        ctx.fillStyle = '#2962ff';
        ctx.fillRect(chartWidth + 1, currentY - 8, rightMargin - 2, 16);

        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 9.5px monospace';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(formatPrice(currentPrice), chartWidth + 5, currentY);
      }
    }

    // 5. Crosshair on Mouse Hover
    if (mousePos && mousePos.x >= 0 && mousePos.x <= chartWidth && mousePos.y >= 0 && mousePos.y <= chartHeight) {
      ctx.save();
      ctx.setLineDash([2, 2]);
      ctx.strokeStyle = '#4c525e';
      ctx.lineWidth = 1;

      // Vertical line
      ctx.beginPath();
      ctx.moveTo(mousePos.x, 0);
      ctx.lineTo(mousePos.x, chartHeight);
      ctx.stroke();

      // Horizontal line
      ctx.beginPath();
      ctx.moveTo(0, mousePos.y);
      ctx.lineTo(chartWidth, mousePos.y);
      ctx.stroke();
      ctx.restore();

      // Price tag on right axis
      const crossPrice = yToPrice(mousePos.y);
      ctx.fillStyle = '#363a45';
      ctx.fillRect(chartWidth + 1, mousePos.y - 7, rightMargin - 2, 14);
      ctx.fillStyle = '#d1d4dc';
      ctx.font = '9px monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(formatPrice(crossPrice), chartWidth + 5, mousePos.y);

      // Time tag on bottom axis
      const distFromRight = (chartWidth - mousePos.x) / candleWidth;
      const hoveredIndex = Math.round(rawEndIndex - distFromRight + 0.5);
      const hoveredCandle = candles[hoveredIndex];

      if (hoveredCandle) {
        const d = new Date(hoveredCandle.openTime);
        const timeLabel = `${d.toLocaleDateString([], { month: 'numeric', day: 'numeric' })} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
        ctx.font = '9px monospace';
        const tWidth = ctx.measureText(timeLabel).width;

        ctx.fillStyle = '#363a45';
        ctx.fillRect(mousePos.x - tWidth / 2 - 4, chartHeight + 1, tWidth + 8, 16);
        ctx.fillStyle = '#d1d4dc';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(timeLabel, mousePos.x, chartHeight + 4);
      }
    }

    // 6. Right scale interactive hints: Auto Button
    if (!autoScale) {
      ctx.fillStyle = '#1e222d';
      ctx.fillRect(chartWidth + 5, chartHeight - 20, rightMargin - 10, 16);
      ctx.strokeStyle = '#3b82f6';
      ctx.lineWidth = 1;
      ctx.strokeRect(chartWidth + 5, chartHeight - 20, rightMargin - 10, 16);

      ctx.fillStyle = '#60a5fa';
      ctx.font = 'bold 9px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('AUTO', chartWidth + (rightMargin / 2), chartHeight - 12);
    }

    ctx.restore();
  }, [
    candles,
    candleWidth,
    panOffset,
    priceOffset,
    priceScaleRatio,
    autoScale,
    showMarketStructure,
    mousePos,
    timeframe,
    marketStructure,
    containerSize,
    drawings,
    selectedDrawingId,
    pendingPoints,
    activeTool,
    isSnapEnabled,
    activeSignal,
    clearedSignalIds,
    ticker
  ]);

  // Current or inspected candle metrics for toolbar header
  const latestCandle = candles[candles.length - 1] || null;
  const isUp = latestCandle ? latestCandle.close >= latestCandle.open : true;
  const changePercent = latestCandle
    ? (((latestCandle.close - latestCandle.open) / latestCandle.open) * 100).toFixed(2)
    : '0.00';

  // 1. FULL SCREEN CHART MODE (Instruction 4)
  if (isFullScreen) {
    return (
      <div
        ref={containerRef}
        onWheel={handleWheel}
        className="fixed inset-0 z-50 bg-[#070709] text-slate-200 select-none overflow-hidden flex flex-col"
      >
        {/* Fullscreen Top Navigation Bar */}
        <div className="border-b border-[#181a24] bg-[#0c0d12] px-3.5 py-2 flex items-center justify-between gap-2 text-xs shrink-0">
          <div className="flex items-center gap-3">
            <span className="font-mono font-bold text-white text-base tracking-tight">{symbol}</span>
            <span className="font-mono font-black text-base text-white">
              ${formatPrice(ticker?.lastPrice || (latestCandle ? latestCandle.close : '--'))}
            </span>
            <span
              className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-mono font-bold ${
                parseFloat(ticker?.priceChangePercent || changePercent) >= 0
                  ? 'text-emerald-400 bg-emerald-500/10'
                  : 'text-red-400 bg-red-500/10'
              }`}
            >
              {parseFloat(ticker?.priceChangePercent || changePercent) >= 0 ? '+' : ''}
              {ticker?.priceChangePercent || changePercent}%
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            {/* Timeframe selector */}
            <div className="flex items-center bg-[#12131b] p-0.5 rounded border border-[#1e202d]">
              {['1m', '5m', '15m', '1h', '4h', '1d'].map((tf) => (
                <button
                  key={tf}
                  onClick={() => onTimeframeChange(tf as Timeframe)}
                  className={`px-2 py-0.5 rounded text-[11px] font-mono font-semibold transition cursor-pointer ${
                    timeframe === tf
                      ? 'bg-amber-500 text-black font-bold'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {tf}
                </button>
              ))}
            </div>

            {/* Auto Scale Button */}
            <button
              onClick={() => {
                setAutoScale(true);
                setPriceOffset(0);
                setPriceScaleRatio(1.0);
              }}
              className="px-2 py-1 rounded text-[11px] font-mono font-semibold bg-[#12131b] border border-[#1e202d] text-slate-300 hover:text-white cursor-pointer"
            >
              Auto
            </button>

            {/* Exit Full Screen Button */}
            <button
              onClick={() => setIsFullScreen(false)}
              className="flex items-center gap-1 px-3 py-1 rounded bg-amber-500 hover:bg-amber-400 text-black font-mono font-bold text-xs shadow transition cursor-pointer ml-1"
              title="Exit Full Screen"
            >
              <Minimize2 className="w-3.5 h-3.5" />
              <span>Exit</span>
            </button>
          </div>
        </div>

        {/* Active Signal HUD Banner */}
        {activeSignal && activeSignal.status === 'ACTIVE' && activeSignal.entryPrice && (
          <div className="px-3.5 py-1 bg-[#0d0f18] border-b border-[#1c1f2e] flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono shrink-0">
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1 font-bold text-amber-400">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                Setup: {activeSignal.direction} ({activeSignal.setupType})
              </span>
              <span className="text-slate-400">
                Entry: <strong className="text-white">${formatPrice(activeSignal.entryPrice)}</strong>
              </span>
              <span className="text-slate-400">
                TP: <strong className="text-emerald-400">${formatPrice(activeSignal.takeProfit)}</strong>
              </span>
              <span className="text-slate-400">
                SL: <strong className="text-red-400">${formatPrice(activeSignal.stopLoss)}</strong>
              </span>
            </div>
            <div className="flex items-center gap-2">
              {activeSignal.aiValidation && (
                <span
                  className={`px-1.5 py-0.2 rounded text-[10px] font-bold border ${
                    activeSignal.aiValidation.status === 'allow'
                      ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40'
                      : activeSignal.aiValidation.status === 'reject'
                      ? 'bg-rose-500/20 text-rose-400 border-rose-500/40'
                      : 'bg-amber-500/20 text-amber-400 border-amber-500/40'
                  }`}
                >
                  AI: {activeSignal.aiValidation.status.toUpperCase()}
                </span>
              )}
              {activeSignal.marketRegime && (
                <span className="px-1.5 py-0.2 rounded text-[10px] bg-[#1a1d28] text-slate-300 border border-[#282c3d] capitalize hidden sm:inline">
                  {activeSignal.marketRegime.replace(/_/g, ' ')}
                </span>
              )}
              <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-amber-500/20 text-amber-400 border border-amber-500/30 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                WATCHING LIVE
              </span>
              <span className="text-[10px] text-slate-500">{activeSignal.confidence}% Conf.</span>
            </div>
          </div>
        )}

        {/* Fullscreen Canvas Area with Left Drawing Toolbar */}
        <div className="flex-1 flex overflow-hidden w-full h-full relative">
          <DrawingToolbar
            activeTool={activeTool}
            onSelectTool={setActiveTool}
            drawingsCount={drawings.length}
            activeAlertsCount={drawings.reduce((acc, d) => acc + (d.alerts?.filter((a) => a.enabled).length || 0), 0)}
            canUndo={canUndo}
            canRedo={canRedo}
            onUndo={undo}
            onRedo={redo}
            onOpenManager={() => setIsManagerModalOpen(true)}
            onOpenAlerts={() => setIsManagerModalOpen(true)}
            onClearAll={clearAllDrawings}
            areAllVisible={areAllDrawingsVisible}
            onToggleAllVisibility={toggleAllVisibility}
            isSnapEnabled={isSnapEnabled}
            onToggleSnap={toggleSnap}
          />

          <div className="flex-1 relative overflow-hidden w-full h-full">
            {isLoading && (
              <div className="absolute inset-0 bg-[#070709]/80 backdrop-blur-xs flex items-center justify-center z-10">
                <div className="flex flex-col items-center gap-2">
                  <Activity className="w-6 h-6 text-amber-500 animate-spin" />
                  <span className="text-xs text-slate-300 font-mono">Loading market chart data...</span>
                </div>
              </div>
            )}

            <canvas
              ref={canvasRef}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
              onPointerLeave={handlePointerLeave}
              onDoubleClick={handleDoubleClick}
              style={{ cursor: cursorStyle }}
              className="absolute inset-0 w-full h-full block touch-none"
            />

            {/* Selected Drawing Floating Properties Bar / Mobile Drawer */}
            {selectedDrawing && (
              <DrawingPropertiesBar
                drawing={selectedDrawing}
                onUpdate={(updates) => updateDrawing(selectedDrawing.id, updates)}
                onDuplicate={() => duplicateDrawing(selectedDrawing.id)}
                onDelete={() => deleteDrawing(selectedDrawing.id)}
                onOpenAlertModal={() => setIsAlertModalOpen(true)}
                onClose={() => selectDrawing(null)}
                isSnapEnabled={isSnapEnabled}
                onToggleSnap={toggleSnap}
                symbol={symbol}
                timeframe={timeframe}
                onAddAlert={(alertData) => addAlertToDrawing(selectedDrawing.id, alertData)}
                onRemoveAlert={(alertId) => removeAlertFromDrawing(selectedDrawing.id, alertId)}
                onToggleAlert={(alertId, enabled) => toggleAlertStatus(selectedDrawing.id, alertId, enabled)}
              />
            )}

            {/* Floating Alert Notification Toast */}
            <AlertNotificationToast
              notifications={notifications}
              onDismiss={dismissNotification}
            />
          </div>
        </div>

        {/* Alert Configuration Modal in Fullscreen */}
        {isAlertModalOpen && selectedDrawing && (
          <DrawingAlertModal
            drawing={selectedDrawing}
            timeframe={timeframe}
            symbol={symbol}
            onClose={() => setIsAlertModalOpen(false)}
            onAddAlert={(alertData) => addAlertToDrawing(selectedDrawing.id, alertData)}
            onRemoveAlert={(alertId) => removeAlertFromDrawing(selectedDrawing.id, alertId)}
            onToggleAlert={(alertId, enabled) => toggleAlertStatus(selectedDrawing.id, alertId, enabled)}
          />
        )}

        {/* Drawings Object Tree & Global Alerts Manager Modal in Fullscreen */}
        {isManagerModalOpen && (
          <DrawingManagerModal
            symbol={symbol}
            drawings={drawings}
            selectedDrawingId={selectedDrawingId}
            onSelectDrawing={selectDrawing}
            onToggleVisibility={toggleVisibility}
            onToggleLock={toggleLock}
            onRenameDrawing={renameDrawing}
            onDuplicateDrawing={duplicateDrawing}
            onDeleteDrawing={deleteDrawing}
            onToggleAlert={toggleAlertStatus}
            onDeleteAlert={removeAlertFromDrawing}
            notificationHistory={notificationHistory}
            onClearHistory={clearNotificationHistory}
            onClose={() => setIsManagerModalOpen(false)}
          />
        )}
      </div>
    );
  }

  // 2. STANDARD COMPACT MODE (Requirements 3, 4, 6)
  return (
    <div
      ref={containerRef}
      onWheel={handleWheel}
      className="flex flex-col h-full w-full bg-[#070709] text-slate-200 select-none overflow-y-auto lg:overflow-hidden relative pb-24 lg:pb-0 overscroll-contain"
    >
      {/* ============================================================== */}
      {/* 1. NWWT STRUCTURE SCANNER (Top of Chart Experience - Requirement 3) */}
      {/* ============================================================== */}
      <div className="border-b border-[#181a24] bg-[#0c0e15] px-3 sm:px-3.5 py-2 sm:py-2.5 flex flex-col gap-2 shrink-0">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="w-5 h-5 rounded bg-amber-500/10 border border-amber-500/40 flex items-center justify-center font-black text-amber-400 text-[10px]">
              NW
            </div>
            <span className="font-extrabold text-xs tracking-wider text-white font-mono uppercase">
              NWWT Structure Scanner
            </span>
            <span
              className={`px-1.5 py-0.2 rounded text-[10px] font-mono font-bold uppercase ${
                marketStructure.currentTrend === 'bullish'
                  ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                  : marketStructure.currentTrend === 'bearish'
                  ? 'bg-red-500/15 text-red-400 border border-red-500/30'
                  : 'bg-slate-500/15 text-slate-300 border border-slate-500/30'
              }`}
            >
              {marketStructure.currentTrend} Structure
            </span>

            {/* Signal Badge */}
            <span
              className={`px-1.5 py-0.2 rounded text-[10px] font-mono font-bold uppercase border flex items-center gap-1 ${
                scanResult.decision.signal === 'UP'
                  ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                  : scanResult.decision.signal === 'DOWN'
                  ? 'bg-red-500/15 text-red-400 border border-red-500/30'
                  : 'bg-slate-800 text-slate-400 border-slate-700'
              }`}
            >
              {scanResult.decision.signal === 'UP' && <TrendingUp className="w-3 h-3 text-emerald-400" />}
              {scanResult.decision.signal === 'DOWN' && <TrendingDown className="w-3 h-3 text-red-400" />}
              <span>{scanResult.decision.signal}</span>
            </span>

            {scanResult.decision.setupQuality !== 'NONE' && (
              <span className="px-1.5 py-0.2 rounded text-[9.5px] font-mono uppercase font-semibold bg-[#141724] text-slate-400 border border-[#23273c] hidden sm:inline">
                {scanResult.decision.setupQuality}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {/* Dedicated Scan Market Button (Requirement 7) */}
            <button
              onClick={handleScanChartAsset}
              disabled={isScanningAsset}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-amber-500 hover:bg-amber-400 active:scale-95 text-black font-mono font-bold text-xs shadow-sm transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
              title={`Scan market structure on ${symbol} (${timeframe})`}
            >
              <Search className={`w-3 h-3 ${isScanningAsset ? 'animate-spin' : ''}`} />
              <span>Scan Market</span>
              <span className="text-[9.5px] bg-black/20 text-black px-1 rounded font-bold">
                {symbol.replace(/USDT$/, '')}
              </span>
            </button>
          </div>
        </div>

        {/* Setup Condition Display (Answers "Is there a setup?" - Requirement 6) */}
        {activeSignal && activeSignal.status === 'ACTIVE' && activeSignal.entryPrice ? (
          <div className="p-2 rounded bg-[#10131d] border border-amber-500/30 flex flex-wrap items-center justify-between gap-2 text-xs font-mono">
            <div className="flex items-center gap-2.5 flex-wrap">
              <span
                className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                  activeSignal.direction === 'UP'
                    ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                    : 'bg-red-500/20 text-red-400 border border-red-500/40'
                }`}
              >
                {activeSignal.direction === 'UP' ? 'LONG SETUP' : 'SHORT SETUP'}
              </span>
              <span className="font-semibold text-white">{activeSignal.setupType}</span>
              <span className="text-slate-400">
                Entry: <strong className="text-white">${formatPrice(activeSignal.entryPrice)}</strong>
              </span>
              <span className="text-slate-400">
                TP: <strong className="text-emerald-400">${formatPrice(activeSignal.takeProfit)}</strong>
              </span>
              <span className="text-slate-400">
                SL: <strong className="text-red-400">${formatPrice(activeSignal.stopLoss)}</strong>
              </span>
            </div>
            <div className="flex items-center gap-2">
              {activeSignal.aiValidation && (
                <span
                  className={`px-1.5 py-0.2 rounded text-[10px] font-bold border ${
                    activeSignal.aiValidation.status === 'allow'
                      ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40'
                      : activeSignal.aiValidation.status === 'reject'
                      ? 'bg-rose-500/20 text-rose-400 border-rose-500/40'
                      : 'bg-amber-500/20 text-amber-400 border-amber-500/40'
                  }`}
                >
                  AI: {activeSignal.aiValidation.status.toUpperCase()}
                </span>
              )}
              {activeSignal.marketRegime && (
                <span className="px-1.5 py-0.2 rounded text-[10px] bg-[#1a1d28] text-slate-300 border border-[#282c3d] capitalize hidden sm:inline">
                  {activeSignal.marketRegime.replace(/_/g, ' ')}
                </span>
              )}
              <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-amber-500/20 text-amber-400 border border-amber-500/30 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                WATCHING LIVE
              </span>
              <span className="text-[10px] text-slate-400">{activeSignal.confidence}% Conf.</span>
            </div>
          </div>
        ) : (
          <div className="p-2 rounded bg-[#0e1017] border border-[#1c1f2e] text-[11px] font-mono text-slate-400 flex items-center justify-between gap-2">
            <span>
              Market Structure: <strong className="text-slate-200 capitalize">{marketStructure.currentTrend}</strong>. {scanResult.decision.signal === 'NO SETUP' ? `No active setup on ${timeframe}. Monitoring for breakout confirmation.` : `Setup identified: ${scanResult.decision.signal} (${scanResult.decision.setupQuality} Quality).`}
            </span>
            <button
              onClick={() => setIsStructureDetailsOpen((prev) => !prev)}
              className="text-amber-400 hover:text-amber-300 text-[10px] font-bold flex items-center gap-1 cursor-pointer shrink-0"
            >
              <span>{isStructureDetailsOpen ? 'Hide Details' : 'Show Details'}</span>
              {isStructureDetailsOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            </button>
          </div>
        )}

        {/* Scan Feedback Banner */}
        {scanFeedback && (
          <div className="px-2.5 py-1 rounded bg-[#131724] border border-amber-500/30 text-amber-300 text-[11px] font-mono flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 overflow-hidden">
              <Sparkles className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              <span className="truncate">{scanFeedback}</span>
            </div>
            <button onClick={() => setScanFeedback(null)} className="text-slate-400 hover:text-white p-0.5">
              <X className="w-3 h-3" />
            </button>
          </div>
        )}

        {/* Progressive Disclosure: Structured Evidence Grid (Requirement 6) */}
        {isStructureDetailsOpen && (
          <div className="pt-1.5 space-y-2">
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-1.5 text-xs font-mono">
              <div className="p-1.5 rounded bg-[#080a0f] border border-[#181a24]">
                <div className="text-[9px] text-slate-500 uppercase">Regime</div>
                <div className="font-bold text-[10px] uppercase truncate text-amber-400">
                  {scanResult.decision.marketCondition}
                </div>
              </div>
              <div className="p-1.5 rounded bg-[#080a0f] border border-[#181a24]">
                <div className="text-[9px] text-slate-500 uppercase">Structure</div>
                <div className="text-slate-200 font-semibold text-[10px] truncate">
                  {scanResult.decision.marketStructure}
                </div>
              </div>
              <div className="p-1.5 rounded bg-[#080a0f] border border-[#181a24]">
                <div className="text-[9px] text-slate-500 uppercase">Trend</div>
                <div className="text-slate-200 font-semibold text-[10px] truncate">
                  {scanResult.decision.trendCondition}
                </div>
              </div>
              <div className="p-1.5 rounded bg-[#080a0f] border border-[#181a24]">
                <div className="text-[9px] text-slate-500 uppercase">Volume</div>
                <div className="text-slate-200 font-semibold text-[10px] truncate">
                  {scanResult.decision.volumeCondition}
                </div>
              </div>
              <div className="p-1.5 rounded bg-[#080a0f] border border-[#181a24] col-span-2 sm:col-span-1">
                <div className="text-[9px] text-slate-500 uppercase">Key Level</div>
                <div className="text-slate-200 font-semibold text-[10px] truncate">
                  {scanResult.decision.keyPriceArea}
                </div>
              </div>
            </div>
            {scanResult.decision.reason && (
              <p className="text-[10.5px] text-slate-400 font-mono leading-relaxed bg-[#080a0f] p-2 rounded border border-[#181a24]">
                {scanResult.decision.reason}
              </p>
            )}
          </div>
        )}
      </div>

      {/* ============================================================== */}
      {/* 2. ASSET AND PRICE (Requirement 3) */}
      {/* ============================================================== */}
      <div className="border-b border-[#181a24] bg-[#0c0d12] px-3 sm:px-3.5 py-2 flex flex-wrap items-center justify-between gap-2 text-xs shrink-0">
        <div className="flex items-center gap-3">
          {/* Asset Dropdown Selector */}
          <div className="relative" ref={assetDropdownRef}>
            <button
              onClick={() => {
                setIsAssetDropdownOpen((prev) => !prev);
                setAssetSearchQuery('');
              }}
              className="flex items-center gap-2 px-2.5 py-1 rounded bg-[#12141c] hover:bg-[#1a1d28] border border-[#222533] hover:border-amber-500/50 text-white font-mono font-bold text-sm transition cursor-pointer select-none shadow-sm"
              title="Click to switch active asset"
            >
              <span>{symbol}</span>
              <ChevronDown className={`w-3.5 h-3.5 text-amber-400 transition-transform ${isAssetDropdownOpen ? 'rotate-180' : ''}`} />
            </button>

            {/* Asset Dropdown Menu */}
            {isAssetDropdownOpen && (
              <div className="absolute left-0 top-full mt-1.5 w-72 sm:w-80 bg-[#0c0e14] border border-[#262a3d] rounded-lg shadow-2xl z-50 overflow-hidden flex flex-col">
                <div className="p-2 border-b border-[#1c1f2e] bg-[#0a0c12]">
                  <input
                    type="text"
                    autoFocus
                    value={assetSearchQuery}
                    onChange={(e) => setAssetSearchQuery(e.target.value)}
                    placeholder="Search asset (e.g. BTC, ETH, SOL)..."
                    className="w-full bg-[#151824] border border-[#262a3d] focus:border-amber-500 focus:outline-none rounded px-2.5 py-1 text-xs font-mono text-white placeholder-slate-500"
                  />
                </div>

                <div className="max-h-72 overflow-y-auto divide-y divide-[#151824]">
                  {filteredDropdownSymbols.length === 0 ? (
                    <div className="p-3 text-center text-xs text-slate-500 font-mono">
                      No matching pairs
                    </div>
                  ) : (
                    filteredDropdownSymbols.map((item) => {
                      const isCurr = item.symbol === symbol;
                      const pctNum = parseFloat(item.priceChangePercent);
                      const isPos = !isNaN(pctNum) && pctNum >= 0;

                      return (
                        <div
                          key={item.symbol}
                          onClick={() => {
                            if (onSelectSymbol) onSelectSymbol(item.symbol);
                            setIsAssetDropdownOpen(false);
                          }}
                          className={`p-2.5 flex items-center justify-between hover:bg-[#171b29] cursor-pointer transition ${
                            isCurr ? 'bg-amber-500/15 border-l-2 border-l-amber-500' : ''
                          }`}
                        >
                          <div className="flex items-center gap-1.5">
                            <span className="font-mono font-bold text-xs text-white">
                              {item.symbol.replace(/USDT$/, '')}
                            </span>
                            <span className="text-[10px] text-slate-400 font-mono">
                              /USDT
                            </span>
                          </div>

                          <div className="flex items-center gap-2 text-right font-mono">
                            <span className="text-xs font-semibold text-white">
                              ${formatPrice(item.lastPrice)}
                            </span>
                            <span
                              className={`text-[10px] font-bold px-1.5 py-0.2 rounded min-w-[50px] text-right ${
                                isPos
                                  ? 'text-emerald-400 bg-emerald-500/10'
                                  : 'text-red-400 bg-red-500/10'
                              }`}
                            >
                              {isPos ? '+' : ''}{!isNaN(pctNum) ? pctNum.toFixed(2) : '0.00'}%
                            </span>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Large Live Price */}
          <div className="flex items-baseline gap-2 pl-3 border-l border-[#1a1c27]">
            <span className="font-mono font-black text-xl text-white tracking-tight">
              ${formatPrice(ticker?.lastPrice || (latestCandle ? latestCandle.close : '--'))}
            </span>
            <span
              className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-mono font-bold ${
                parseFloat(ticker?.priceChangePercent || changePercent) >= 0
                  ? 'text-emerald-400 bg-emerald-500/10'
                  : 'text-red-400 bg-red-500/10'
              }`}
            >
              {parseFloat(ticker?.priceChangePercent || changePercent) >= 0 ? '+' : ''}
              {ticker?.priceChangePercent || changePercent}%
            </span>
          </div>
        </div>

        {/* 24h High & Low */}
        {ticker && ticker.highPrice !== '--' && (
          <div className="hidden sm:flex items-center gap-3 text-[11px] font-mono text-slate-400">
            <span>24h H: <strong className="text-slate-200">${formatPrice(ticker.highPrice)}</strong></span>
            <span>24h L: <strong className="text-slate-200">${formatPrice(ticker.lowPrice)}</strong></span>
          </div>
        )}
      </div>

      {/* ============================================================== */}
      {/* 3. TIMEFRAME CONTROLS & CHART OPTIONS (Requirement 3 & 4)      */}
      {/* ============================================================== */}
      <div className="border-b border-[#181a24] bg-[#0c0d12] px-3 sm:px-3.5 py-1.5 flex flex-wrap items-center justify-between gap-1.5 text-xs shrink-0">
        {/* Timeframe Quick Buttons */}
        <div className="flex items-center bg-[#12131b] p-0.5 rounded border border-[#1e202d]">
          {['1m', '5m', '15m', '1h', '4h', '1d'].map((tf) => (
            <button
              key={tf}
              onClick={() => onTimeframeChange(tf as Timeframe)}
              className={`px-2 py-0.5 rounded text-[11px] font-mono font-semibold transition cursor-pointer ${
                timeframe === tf
                  ? 'bg-amber-500 text-black font-bold'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              {tf}
            </button>
          ))}
        </div>

        {/* Right Tools: Structure Toggle, Settings, Auto, Zoom, and Clear Full Screen Button */}
        <div className="flex items-center gap-1.5 text-xs flex-wrap">
          {/* Market Structure Toggle */}
          <button
            onClick={() => {
              const next = !showMarketStructure;
              setShowMarketStructure(next);
              localStorage.setItem('nwwt_show_market_structure', String(next));
            }}
            className={`flex items-center gap-1 px-2 py-1 rounded border text-xs font-mono transition-colors cursor-pointer ${
              showMarketStructure
                ? 'bg-amber-500/20 text-amber-300 border-amber-500/50 font-semibold'
                : 'bg-[#12131b] text-slate-400 border-[#1e202d] hover:text-white'
            }`}
            title="Toggle Market Structure"
          >
            <Layers className="w-3.5 h-3.5 text-amber-400" />
            <span className="hidden sm:inline">Structure</span>
          </button>

          {/* Visible Structure Settings Button & Popover */}
          <div className="relative" ref={structureSettingsRef}>
            <button
              onClick={() => setIsStructureSettingsOpen((prev) => !prev)}
              className={`flex items-center gap-1 px-2 py-1 rounded border text-xs font-mono transition-colors cursor-pointer ${
                isStructureSettingsOpen
                  ? 'bg-amber-500 text-black font-bold'
                  : 'bg-[#12131b] text-slate-300 border-[#1e202d] hover:text-white'
              }`}
              title="Swing Structure Settings"
            >
              <SlidersHorizontal className="w-3.5 h-3.5 text-amber-400" />
              <span className="hidden sm:inline">Settings</span>
            </button>

            {/* Structure Settings Popover Dropdown */}
            {isStructureSettingsOpen && (
              <div className="absolute right-0 top-full mt-1.5 w-72 max-w-[calc(100vw-32px)] bg-[#0e1017] border border-[#26293a] rounded-lg shadow-2xl p-3 z-50 text-xs font-mono select-none">
                <div className="flex items-center justify-between pb-2 mb-2.5 border-b border-[#1c1f2e]">
                  <span className="font-bold text-white uppercase text-[11px] tracking-wider flex items-center gap-1.5">
                    <SlidersHorizontal className="w-3.5 h-3.5 text-amber-400" />
                    Structure Settings
                  </span>
                  <button
                    onClick={() => setIsStructureSettingsOpen(false)}
                    className="text-slate-400 hover:text-white p-0.5"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* Master Structure Toggle */}
                <div className="flex items-center justify-between py-1.5 mb-2">
                  <span className="text-slate-300">Market Structure</span>
                  <button
                    onClick={() => {
                      const next = !showMarketStructure;
                      setShowMarketStructure(next);
                      localStorage.setItem('nwwt_show_market_structure', String(next));
                    }}
                    className={`px-2 py-0.5 rounded text-[10px] font-bold transition cursor-pointer ${
                      showMarketStructure
                        ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                        : 'bg-[#181a24] text-slate-500 border border-[#222533]'
                    }`}
                  >
                    {showMarketStructure ? 'ENABLED' : 'DISABLED'}
                  </button>
                </div>

                {/* Structure Markers Toggle (HH, HL, LH, LL) */}
                <div className="flex items-center justify-between py-1.5 mb-2">
                  <div>
                    <div className="text-slate-200">Swing Markers</div>
                    <div className="text-[10px] text-slate-500">HH, HL, LH, LL labels</div>
                  </div>
                  <button
                    onClick={() => {
                      const next = !showStructureMarkers;
                      setShowStructureMarkers(next);
                      localStorage.setItem('nwwt_show_structure_markers', String(next));
                    }}
                    className={`px-2 py-0.5 rounded text-[10px] font-bold transition cursor-pointer ${
                      showStructureMarkers
                        ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40'
                        : 'bg-[#181a24] text-slate-500 border border-[#222533]'
                    }`}
                  >
                    {showStructureMarkers ? 'SHOW' : 'HIDE'}
                  </button>
                </div>

                {/* Structure Breaks Toggle (BOS, CHoCH) */}
                <div className="flex items-center justify-between py-1.5 mb-2.5">
                  <div>
                    <div className="text-slate-200">Structure Breaks</div>
                    <div className="text-[10px] text-slate-500">BOS & CHoCH lines</div>
                  </div>
                  <button
                    onClick={() => {
                      const next = !showStructureBreaks;
                      setShowStructureBreaks(next);
                      localStorage.setItem('nwwt_show_structure_breaks', String(next));
                    }}
                    className={`px-2 py-0.5 rounded text-[10px] font-bold transition cursor-pointer ${
                      showStructureBreaks
                        ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40'
                        : 'bg-[#181a24] text-slate-500 border border-[#222533]'
                    }`}
                  >
                    {showStructureBreaks ? 'SHOW' : 'HIDE'}
                  </button>
                </div>

                {/* Swing Sensitivity (Pivot Lookback) */}
                <div className="pt-2 border-t border-[#1c1f2e]">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-slate-200 font-semibold">Swing Sensitivity</span>
                    <span className="text-amber-400 font-bold text-[11px]">
                      {swingSensitivity === 1 ? 'Fast (1-bar)' : swingSensitivity === 2 ? 'Normal (2-bar)' : swingSensitivity === 3 ? 'Deep (3-bar)' : 'Macro (4-bar)'}
                    </span>
                  </div>
                  <div className="grid grid-cols-4 gap-1">
                    {[1, 2, 3, 4].map((val) => (
                      <button
                        key={val}
                        onClick={() => {
                          setSwingSensitivity(val);
                          localStorage.setItem('nwwt_swing_sensitivity', String(val));
                        }}
                        className={`py-1 rounded text-center text-[10px] font-bold transition cursor-pointer ${
                          swingSensitivity === val
                            ? 'bg-amber-500 text-black'
                            : 'bg-[#141622] text-slate-400 hover:text-white border border-[#202334]'
                        }`}
                      >
                        {val === 1 ? 'Fast' : val === 2 ? 'Normal' : val === 3 ? 'Deep' : 'Macro'}
                      </button>
                    ))}
                  </div>
                  <div className="text-[10px] text-slate-500 mt-2 leading-relaxed">
                    Prioritizes genuine structural extremes without flooding the chart with minor noise.
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Auto Scale Reset */}
          <button
            onClick={() => {
              setAutoScale(true);
              setPriceOffset(0);
              setPriceScaleRatio(1.0);
            }}
            className={`px-2 py-1 rounded text-[11px] font-mono font-semibold border transition-colors cursor-pointer ${
              autoScale
                ? 'bg-amber-500/20 text-amber-400 border-amber-500/40'
                : 'bg-[#12131b] text-slate-400 hover:text-white border-[#1e202d]'
            }`}
            title="Auto-fit price scale"
          >
            Auto
          </button>

          <button
            onClick={() => handleZoom('in')}
            className="p-1 rounded bg-[#12131b] hover:bg-[#1a1d28] border border-[#1e202d] text-slate-300 hover:text-white transition cursor-pointer"
            title="Zoom In"
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => handleZoom('out')}
            className="p-1 rounded bg-[#12131b] hover:bg-[#1a1d28] border border-[#1e202d] text-slate-300 hover:text-white transition cursor-pointer"
            title="Zoom Out"
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={handleResetView}
            className="flex items-center gap-1 px-2 py-1 rounded bg-[#12131b] hover:bg-[#1a1d28] border border-[#1e202d] text-slate-300 hover:text-white transition cursor-pointer text-[11px] font-mono"
            title="Reset Chart View"
          >
            <RotateCcw className="w-3 h-3 text-amber-400" />
            <span className="hidden lg:inline">Reset</span>
          </button>

          {/* Clear Full Screen Chart Button (Requirement 4) */}
          <button
            onClick={() => setIsFullScreen(true)}
            className="flex items-center gap-1 px-2.5 py-1 rounded bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/40 text-amber-400 hover:text-amber-300 transition cursor-pointer text-[11px] font-mono font-bold"
            title="Open Full Screen Chart"
          >
            <Maximize2 className="w-3.5 h-3.5" />
            <span>Full Screen</span>
          </button>

          {onClose && (
            <button
              onClick={onClose}
              className="p-1 rounded bg-[#12131b] hover:bg-[#1a1d28] border border-[#1e202d] text-slate-400 hover:text-red-400 transition cursor-pointer ml-1"
              title="Close Chart"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* ============================================================== */}
      {/* 4. COMPACT CHART WITH DRAWING TOOLBAR (Requirement 3 & 4)      */}
      {/* ============================================================== */}
      <div className="relative overflow-hidden w-full h-[270px] sm:h-[310px] lg:h-full lg:flex-1 min-h-[250px] shrink-0 lg:shrink flex border-y border-[#181a24]">
        {/* Drawing Tools Left Toolbar */}
        <DrawingToolbar
          activeTool={activeTool}
          onSelectTool={setActiveTool}
          drawingsCount={drawings.length}
          activeAlertsCount={drawings.reduce((acc, d) => acc + (d.alerts?.filter((a) => a.enabled).length || 0), 0)}
          canUndo={canUndo}
          canRedo={canRedo}
          onUndo={undo}
          onRedo={redo}
          onOpenManager={() => setIsManagerModalOpen(true)}
          onOpenAlerts={() => setIsManagerModalOpen(true)}
          onClearAll={clearAllDrawings}
          areAllVisible={areAllDrawingsVisible}
          onToggleAllVisibility={toggleAllVisibility}
          isSnapEnabled={isSnapEnabled}
          onToggleSnap={toggleSnap}
        />

        <div className="flex-1 relative overflow-hidden w-full h-full">
          {isLoading && (
            <div className="absolute inset-0 bg-[#070709]/80 backdrop-blur-xs flex items-center justify-center z-10">
              <div className="flex flex-col items-center gap-2">
                <Activity className="w-6 h-6 text-amber-500 animate-spin" />
                <span className="text-xs text-slate-300 font-mono">Loading historical market data...</span>
              </div>
            </div>
          )}

          {!isLoading && !fetchError && candles.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center p-4 bg-[#070709]/80 z-10 text-center">
              <div className="max-w-sm space-y-2 p-4 rounded-lg bg-[#0c0d12] border border-[#1e202d] shadow-xl">
                <div className="text-amber-400 text-sm font-semibold flex items-center justify-center gap-1.5">
                  Waiting for Market Trades
                </div>
                <div className="text-xs text-slate-400">
                  No historical market data recorded for <span className="font-mono text-slate-200">{symbol}</span> yet.
                  The live chart will start updating as trades arrive.
                </div>
              </div>
            </div>
          )}

          {fetchError && (
            <div className="absolute inset-0 flex items-center justify-center p-4 bg-[#070709]/90 z-10 text-center">
              <div className="max-w-xs space-y-2">
                <div className="text-red-400 text-sm font-semibold">Failed to load candles</div>
                <div className="text-xs text-slate-400">{fetchError}</div>
                <button
                  onClick={handleManualRetry}
                  className="px-3 py-1 bg-amber-500 hover:bg-amber-400 text-black font-bold rounded text-xs transition-colors cursor-pointer"
                >
                  Retry
                </button>
              </div>
            </div>
          )}

          <canvas
            ref={canvasRef}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            onPointerLeave={handlePointerLeave}
            onDoubleClick={handleDoubleClick}
            style={{ cursor: cursorStyle }}
            className="absolute inset-0 w-full h-full block touch-none"
          />

          {/* Selected Drawing Floating Properties Bar / Mobile Drawer */}
          {selectedDrawing && (
            <DrawingPropertiesBar
              drawing={selectedDrawing}
              onUpdate={(updates) => updateDrawing(selectedDrawing.id, updates)}
              onDuplicate={() => duplicateDrawing(selectedDrawing.id)}
              onDelete={() => deleteDrawing(selectedDrawing.id)}
              onOpenAlertModal={() => setIsAlertModalOpen(true)}
              onClose={() => selectDrawing(null)}
              isSnapEnabled={isSnapEnabled}
              onToggleSnap={toggleSnap}
              symbol={symbol}
              timeframe={timeframe}
              onAddAlert={(alertData) => addAlertToDrawing(selectedDrawing.id, alertData)}
              onRemoveAlert={(alertId) => removeAlertFromDrawing(selectedDrawing.id, alertId)}
              onToggleAlert={(alertId, enabled) => toggleAlertStatus(selectedDrawing.id, alertId, enabled)}
            />
          )}

          {/* Floating Alert Notification Toast */}
          <AlertNotificationToast
            notifications={notifications}
            onDismiss={dismissNotification}
          />
        </div>
      </div>

      {/* ============================================================== */}
      {/* 5. ADDITIONAL INFORMATION (Requirement 3 & 6)                   */}
      {/* ============================================================== */}
      <div className="border-t border-[#181a24] bg-[#090a0e] shrink-0">
        {/* Real OHLC Bar */}
        {latestCandle && (
          <div className="px-3.5 py-1.5 border-b border-[#141620] flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-[11px] font-mono">
            <div className="flex items-center gap-3 flex-wrap">
              <span>O: <span className="text-white font-medium">{formatPrice(latestCandle.open)}</span></span>
              <span>H: <span className="text-emerald-400 font-medium">{formatPrice(latestCandle.high)}</span></span>
              <span>L: <span className="text-red-400 font-medium">{formatPrice(latestCandle.low)}</span></span>
              <span>
                C: <span className={`font-semibold ${isUp ? 'text-emerald-400' : 'text-red-400'}`}>{formatPrice(latestCandle.close)}</span>
              </span>
              <span className={`font-medium ${isUp ? 'text-emerald-400' : 'text-red-400'}`}>
                {isUp ? '+' : ''}{changePercent}%
              </span>
            </div>

            <div className="flex items-center gap-2 text-[10px] text-slate-500">
              <span>Candles: {candles.length}</span>
              <span>•</span>
              <span>Pan: Drag</span>
              <span>•</span>
              <span>Zoom: Wheel / Pinch</span>
            </div>
          </div>
        )}

        {/* Candlestick Formations (Progressive Disclosure - Requirement 6) */}
        {scanResult.patterns.length > 0 && (
          <div className="p-3 border-b border-[#141620]">
            <div
              onClick={() => setIsPatternsOpen((prev) => !prev)}
              className="flex items-center justify-between cursor-pointer text-xs font-semibold text-slate-300 hover:text-white"
            >
              <div className="flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                <span>Detected Candlestick Formations ({scanResult.patterns.length})</span>
              </div>
              {isPatternsOpen ? <ChevronUp className="w-3.5 h-3.5 text-slate-400" /> : <ChevronDown className="w-3.5 h-3.5 text-slate-400" />}
            </div>

            {isPatternsOpen && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2 pt-2 border-t border-[#151722]">
                {scanResult.patterns.map((p) => {
                  const isBull = p.bias === 'bullish';
                  return (
                    <div
                      key={p.id}
                      className="p-2 rounded bg-[#0b0c12] border border-[#1a1d2a] text-xs font-mono"
                    >
                      <div className="flex items-center justify-between">
                        <span className={`font-bold ${isBull ? 'text-emerald-400' : 'text-red-400'}`}>
                          {p.name}
                        </span>
                        <span className="text-[10px] text-slate-500">{p.confidence}% Score</span>
                      </div>
                      <p className="text-[11px] text-slate-400 mt-1 leading-snug">
                        {p.description}
                      </p>
                      <div className="mt-1 pt-1 border-t border-[#141622] flex items-center justify-between text-[10px] text-slate-500">
                        <span>Level: ${formatPrice(p.priceLevel)}</span>
                        <span>Invalidation: ${formatPrice(p.invalidationPrice)}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Educational Market Disclaimer */}
        <div className="px-3.5 py-2 text-[10px] text-slate-500 font-mono flex items-center justify-between">
          <span>Educational market analysis terminal. Not financial advice.</span>
          <span>NWWT Confluence</span>
        </div>
      </div>

      {/* Alert Configuration Modal */}
      {isAlertModalOpen && selectedDrawing && (
        <DrawingAlertModal
          drawing={selectedDrawing}
          timeframe={timeframe}
          symbol={symbol}
          onClose={() => setIsAlertModalOpen(false)}
          onAddAlert={(alertData) => addAlertToDrawing(selectedDrawing.id, alertData)}
          onRemoveAlert={(alertId) => removeAlertFromDrawing(selectedDrawing.id, alertId)}
          onToggleAlert={(alertId, enabled) => toggleAlertStatus(selectedDrawing.id, alertId, enabled)}
        />
      )}

      {/* Drawings Object Tree & Global Alerts Manager Modal */}
      {isManagerModalOpen && (
        <DrawingManagerModal
          symbol={symbol}
          drawings={drawings}
          selectedDrawingId={selectedDrawingId}
          onSelectDrawing={selectDrawing}
          onToggleVisibility={toggleVisibility}
          onToggleLock={toggleLock}
          onRenameDrawing={renameDrawing}
          onDuplicateDrawing={duplicateDrawing}
          onDeleteDrawing={deleteDrawing}
          onToggleAlert={toggleAlertStatus}
          onDeleteAlert={removeAlertFromDrawing}
          notificationHistory={notificationHistory}
          onClearHistory={clearNotificationHistory}
          onClose={() => setIsManagerModalOpen(false)}
        />
      )}
    </div>
  );
};

export default CandlestickChart;
