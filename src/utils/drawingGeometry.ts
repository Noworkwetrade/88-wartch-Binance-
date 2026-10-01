/**
 * Mathematical & Canvas Rendering Engine for NWWT Drawing Tools
 * High precision anchoring, hit-testing, and geometry calculations
 */

import { ChartDrawing, ChartPoint, LineStyleType } from '../types/drawings.ts';
import { Candle, Timeframe } from '../types.ts';

export interface CoordinateContext {
  candles: Candle[];
  timeframe: Timeframe;
  candleWidth: number;
  panOffset: number;
  chartWidth: number;
  chartHeight: number;
  effectiveMin: number;
  effectiveRange: number;
}

export function getTimeframeMs(tf: Timeframe): number {
  switch (tf) {
    case '1m': return 60 * 1000;
    case '5m': return 5 * 60 * 1000;
    case '15m': return 15 * 60 * 1000;
    case '30m': return 30 * 60 * 1000;
    case '1h': return 60 * 60 * 1000;
    case '2h': return 2 * 60 * 60 * 1000;
    case '4h': return 4 * 60 * 60 * 1000;
    case '6h': return 6 * 60 * 60 * 1000;
    case '8h': return 8 * 60 * 60 * 1000;
    case '12h': return 12 * 60 * 60 * 1000;
    case '1d': return 24 * 60 * 60 * 1000;
    case '1w': return 7 * 24 * 60 * 60 * 1000;
    case '1M': return 30 * 24 * 60 * 60 * 1000;
    default: return 15 * 60 * 1000;
  }
}

/**
 * Converts a Unix timestamp (ms) to canvas X pixel coordinate
 */
export function timeToX(time: number, ctx: CoordinateContext): number {
  const { candles, timeframe, candleWidth, panOffset, chartWidth } = ctx;
  if (!candles || candles.length === 0) return chartWidth / 2;

  const tfMs = getTimeframeMs(timeframe);
  const rawEndIndex = Math.round(candles.length - 1 - panOffset);

  const firstTime = candles[0].openTime;
  const lastTime = candles[candles.length - 1].openTime;

  let approxIndex = 0;
  if (time <= firstTime) {
    approxIndex = (time - firstTime) / tfMs;
  } else if (time >= lastTime) {
    approxIndex = candles.length - 1 + (time - lastTime) / tfMs;
  } else {
    // Binary search to find closest candle
    let low = 0;
    let high = candles.length - 1;
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      if (candles[mid].openTime <= time) {
        approxIndex = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    const baseCandle = candles[approxIndex];
    const nextCandle = candles[Math.min(candles.length - 1, approxIndex + 1)];
    const interval = nextCandle.openTime > baseCandle.openTime ? nextCandle.openTime - baseCandle.openTime : tfMs;
    const fraction = Math.max(0, Math.min(1, (time - baseCandle.openTime) / interval));
    approxIndex += fraction;
  }

  return chartWidth - (rawEndIndex - approxIndex + 0.5) * candleWidth;
}

/**
 * Converts canvas X pixel coordinate to Unix timestamp (ms)
 */
export function xToTime(x: number, ctx: CoordinateContext): number {
  const { candles, timeframe, candleWidth, panOffset, chartWidth } = ctx;
  if (!candles || candles.length === 0) return Date.now();

  const tfMs = getTimeframeMs(timeframe);
  const rawEndIndex = Math.round(candles.length - 1 - panOffset);
  const approxIndex = rawEndIndex + 0.5 - (chartWidth - x) / candleWidth;

  if (approxIndex < 0) {
    return candles[0].openTime + approxIndex * tfMs;
  } else if (approxIndex >= candles.length - 1) {
    return candles[candles.length - 1].openTime + (approxIndex - (candles.length - 1)) * tfMs;
  } else {
    const baseIdx = Math.floor(approxIndex);
    const fraction = approxIndex - baseIdx;
    const baseCandle = candles[baseIdx];
    const nextCandle = candles[Math.min(candles.length - 1, baseIdx + 1)];
    const interval = nextCandle.openTime > baseCandle.openTime ? nextCandle.openTime - baseCandle.openTime : tfMs;
    return Math.round(baseCandle.openTime + fraction * interval);
  }
}

/**
 * Converts asset price to canvas Y pixel coordinate
 */
export function priceToY(price: number, ctx: CoordinateContext): number {
  const { chartHeight, effectiveMin, effectiveRange } = ctx;
  return chartHeight - ((price - effectiveMin) / (effectiveRange || 1)) * chartHeight;
}

/**
 * Converts canvas Y pixel coordinate to asset price
 */
export function yToPrice(y: number, ctx: CoordinateContext): number {
  const { chartHeight, effectiveMin, effectiveRange } = ctx;
  return effectiveMin + ((chartHeight - y) / (chartHeight || 1)) * effectiveRange;
}

/**
 * Sets stroke style for canvas (solid, dashed, dotted)
 */
export function applyLineStyle(ctx: CanvasRenderingContext2D, style: LineStyleType, thickness: number) {
  if (style === 'dashed') {
    ctx.setLineDash([thickness * 4, thickness * 3]);
  } else if (style === 'dotted') {
    ctx.setLineDash([thickness * 1.5, thickness * 2]);
  } else {
    ctx.setLineDash([]);
  }
}

/**
 * Calculates Euclidean distance between point (px, py) and line segment (x1, y1)-(x2, y2)
 */
export function distToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - x1, py - y1);

  let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const projX = x1 + t * dx;
  const projY = y1 + t * dy;
  return Math.hypot(px - projX, py - projY);
}

/**
 * Calculates Euclidean distance between point (px, py) and infinite line through (x1, y1)-(x2, y2)
 */
export function distToLine(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  if (len === 0) return Math.hypot(px - x1, py - y1);
  return Math.abs(dy * px - dx * py + x2 * y1 - y2 * x1) / len;
}

/**
 * Calculates Euclidean distance between point (px, py) and ray starting at (x1, y1) through (x2, y2)
 */
export function distToRay(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - x1, py - y1);

  const t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
  if (t < 0) {
    return Math.hypot(px - x1, py - y1);
  }
  const projX = x1 + t * dx;
  const projY = y1 + t * dy;
  return Math.hypot(px - projX, py - projY);
}

const DEFAULT_FIB_LEVELS = [
  { level: 0, color: '#787b86', label: '0.0% (0.0)' },
  { level: 0.236, color: '#f23645', label: '23.6% (0.236)' },
  { level: 0.382, color: '#ff9800', label: '38.2% (0.382)' },
  { level: 0.5, color: '#4caf50', label: '50.0% (0.5)' },
  { level: 0.618, color: '#089981', label: '61.8% (0.618)' },
  { level: 0.786, color: '#2962ff', label: '78.6% (0.786)' },
  { level: 1.0, color: '#787b86', label: '100.0% (1.0)' }
];

const DEFAULT_FIB_EXTENSIONS = [
  { level: 0, color: '#787b86', label: '0.0 (0%)' },
  { level: 0.618, color: '#ff9800', label: '0.618 (61.8%)' },
  { level: 1.0, color: '#4caf50', label: '1.0 (100%)' },
  { level: 1.272, color: '#089981', label: '1.272 (127.2%)' },
  { level: 1.618, color: '#2962ff', label: '1.618 (161.8%)' },
  { level: 2.0, color: '#9c27b0', label: '2.0 (200%)' },
  { level: 2.618, color: '#e91e63', label: '2.618 (261.8%)' }
];

/**
 * Main Canvas Drawing Renderer
 */
export function drawChartElement(
  ctx: CanvasRenderingContext2D,
  drawing: ChartDrawing,
  coordCtx: CoordinateContext,
  isSelected: boolean
): void {
  if (!drawing.visible || drawing.points.length === 0) return;

  const { points, type, color, thickness, lineStyle, glow, glowColor, glowIntensity = 6 } = drawing;

  const pts = points.map((p) => ({
    x: timeToX(p.time, coordCtx),
    y: priceToY(p.price, coordCtx)
  }));

  const p1 = pts[0];
  const p2 = pts.length > 1 ? pts[1] : pts[0];
  const p3 = pts.length > 2 ? pts[2] : null;

  ctx.save();

  // Configure Glow
  if (glow) {
    ctx.shadowColor = glowColor || color;
    ctx.shadowBlur = glowIntensity * 1.5;
  } else {
    ctx.shadowBlur = 0;
  }

  // Determine Default Up/Down Glow for Trendlines if not overridden
  let activeColor = color;
  if (type === 'trendline' && drawing.points.length >= 2) {
    const isUpward = drawing.points[1].price >= drawing.points[0].price;
    if (color === '#10b981' || color === '#ef4444' || color === '#f59e0b') {
      activeColor = isUpward ? '#10b981' : '#ef4444';
      if (glow) ctx.shadowColor = activeColor;
    }
  }

  ctx.strokeStyle = activeColor;
  ctx.lineWidth = thickness;
  applyLineStyle(ctx, lineStyle, thickness);

  switch (type) {
    case 'trendline': {
      if (pts.length < 2) break;
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
      break;
    }

    case 'horizontal_line': {
      ctx.beginPath();
      ctx.moveTo(0, p1.y);
      ctx.lineTo(coordCtx.chartWidth, p1.y);
      ctx.stroke();

      // Right tag
      ctx.fillStyle = activeColor;
      ctx.font = 'bold 9.5px monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(`$${drawing.points[0].price.toFixed(2)}`, coordCtx.chartWidth + 4, p1.y);
      break;
    }

    case 'horizontal_ray': {
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(coordCtx.chartWidth, p1.y);
      ctx.stroke();

      // Anchor dot
      ctx.fillStyle = activeColor;
      ctx.beginPath();
      ctx.arc(p1.x, p1.y, thickness + 1.5, 0, Math.PI * 2);
      ctx.fill();
      break;
    }

    case 'extended_line': {
      if (pts.length < 2) break;
      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      if (dx === 0 && dy === 0) break;

      // Extend to left and right canvas bounds
      const x0 = 0;
      const y0 = p1.y + ((x0 - p1.x) / (dx || 0.0001)) * dy;
      const x1 = coordCtx.chartWidth;
      const y1 = p1.y + ((x1 - p1.x) / (dx || 0.0001)) * dy;

      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
      break;
    }

    case 'vertical_line': {
      ctx.beginPath();
      ctx.moveTo(p1.x, 0);
      ctx.lineTo(p1.x, coordCtx.chartHeight);
      ctx.stroke();
      break;
    }

    case 'fibonacci_retracement': {
      if (pts.length < 2) break;
      const highY = Math.min(p1.y, p2.y);
      const lowY = Math.max(p1.y, p2.y);
      const span = lowY - highY;
      const startX = Math.min(p1.x, p2.x);
      const endX = Math.max(p1.x, p2.x, coordCtx.chartWidth);

      // Base diagonal reference line
      ctx.save();
      ctx.setLineDash([3, 3]);
      ctx.strokeStyle = '#55596b';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
      ctx.restore();

      const levels = drawing.fibLevels || DEFAULT_FIB_LEVELS;
      const pTop = Math.max(drawing.points[0].price, drawing.points[1].price);
      const pBot = Math.min(drawing.points[0].price, drawing.points[1].price);
      const pSpan = pTop - pBot;

      for (let i = 0; i < levels.length; i++) {
        const lvl = levels[i];
        const y = p1.y < p2.y ? p1.y + span * lvl.level : p1.y - span * lvl.level;
        const price = p1.y < p2.y ? pTop - pSpan * lvl.level : pBot + pSpan * lvl.level;

        ctx.strokeStyle = lvl.color;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(startX, y);
        ctx.lineTo(endX, y);
        ctx.stroke();

        // Level label & price
        ctx.fillStyle = lvl.color;
        ctx.font = '9px monospace';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'bottom';
        ctx.fillText(`${lvl.label} - $${price.toFixed(2)}`, startX + 4, y - 2);

        // Fill band between levels
        if (i < levels.length - 1) {
          const nextLvl = levels[i + 1];
          const nextY = p1.y < p2.y ? p1.y + span * nextLvl.level : p1.y - span * nextLvl.level;
          ctx.fillStyle = lvl.color;
          ctx.globalAlpha = 0.04;
          ctx.fillRect(startX, Math.min(y, nextY), endX - startX, Math.abs(nextY - y));
          ctx.globalAlpha = 1.0;
        }
      }
      break;
    }

    case 'fibonacci_extension': {
      if (pts.length < 2) break;
      const baseSpan = Math.abs(p2.y - p1.y);
      const startX = Math.min(p1.x, p2.x);
      const endX = Math.max(p1.x, p2.x, coordCtx.chartWidth);
      const levels = DEFAULT_FIB_EXTENSIONS;
      const isUp = p2.y < p1.y;

      for (const lvl of levels) {
        const y = isUp ? p2.y - baseSpan * lvl.level : p2.y + baseSpan * lvl.level;
        ctx.strokeStyle = lvl.color;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(startX, y);
        ctx.lineTo(endX, y);
        ctx.stroke();

        ctx.fillStyle = lvl.color;
        ctx.font = '9px monospace';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'bottom';
        ctx.fillText(`Ext ${lvl.label}`, startX + 4, y - 2);
      }
      break;
    }

    case 'parallel_channel': {
      if (pts.length < 2) break;
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();

      const offsetPrice = drawing.channelOffsetPrice || (drawing.points[0].price * 0.015);
      const offsetY = priceToY(drawing.points[0].price + offsetPrice, coordCtx) - p1.y;

      // Parallel upper/lower line
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y + offsetY);
      ctx.lineTo(p2.x, p2.y + offsetY);
      ctx.stroke();

      // Midline (dashed 50%)
      ctx.save();
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = activeColor;
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y + offsetY / 2);
      ctx.lineTo(p2.x, p2.y + offsetY / 2);
      ctx.stroke();
      ctx.restore();

      // Channel shaded fill
      ctx.fillStyle = drawing.fillColor || activeColor;
      ctx.globalAlpha = drawing.fillOpacity ?? 0.08;
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.lineTo(p2.x, p2.y + offsetY);
      ctx.lineTo(p1.x, p1.y + offsetY);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1.0;
      break;
    }

    case 'rectangle': {
      if (pts.length < 2) break;
      const rx = Math.min(p1.x, p2.x);
      const ry = Math.min(p1.y, p2.y);
      const rw = Math.abs(p2.x - p1.x);
      const rh = Math.abs(p2.y - p1.y);

      // Shaded Fill
      ctx.fillStyle = drawing.fillColor || activeColor;
      ctx.globalAlpha = drawing.fillOpacity ?? 0.12;
      ctx.fillRect(rx, ry, rw, rh);
      ctx.globalAlpha = 1.0;

      // Border
      ctx.strokeRect(rx, ry, rw, rh);
      break;
    }

    case 'price_zone': {
      if (pts.length < 2) break;
      const topY = Math.min(p1.y, p2.y);
      const botY = Math.max(p1.y, p2.y);
      const zoneH = botY - topY;

      // Full horizontal width zone
      ctx.fillStyle = drawing.fillColor || activeColor;
      ctx.globalAlpha = drawing.fillOpacity ?? 0.14;
      ctx.fillRect(0, topY, coordCtx.chartWidth, zoneH);
      ctx.globalAlpha = 1.0;

      // Top and bottom boundary lines
      ctx.beginPath();
      ctx.moveTo(0, topY);
      ctx.lineTo(coordCtx.chartWidth, topY);
      ctx.moveTo(0, botY);
      ctx.lineTo(coordCtx.chartWidth, botY);
      ctx.stroke();

      // Right zone price range tags
      const topP = Math.max(drawing.points[0].price, drawing.points[1].price);
      const botP = Math.min(drawing.points[0].price, drawing.points[1].price);
      ctx.fillStyle = activeColor;
      ctx.font = 'bold 9px monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(`Zone: $${botP.toFixed(2)} - $${topP.toFixed(2)}`, coordCtx.chartWidth + 4, (topY + botY) / 2);
      break;
    }
  }

  // Draw Anchor Selection Handles when drawing is actively selected
  if (isSelected) {
    ctx.shadowBlur = 0;
    ctx.setLineDash([]);
    ctx.fillStyle = '#f59e0b'; // Amber/Gold handle
    ctx.strokeStyle = '#08090d';
    ctx.lineWidth = 1.5;

    pts.forEach((pt, idx) => {
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    });
  }

  ctx.restore();
}

/**
 * Hit Test to determine if mouse coordinates clicked/hovered over a drawing or handle
 */
export function hitTestDrawing(
  drawing: ChartDrawing,
  mouseX: number,
  mouseY: number,
  coordCtx: CoordinateContext,
  threshold = 8
): { isHit: boolean; handleIndex: number | null } {
  if (!drawing.visible || drawing.points.length === 0) {
    return { isHit: false, handleIndex: null };
  }

  const pts = drawing.points.map((p) => ({
    x: timeToX(p.time, coordCtx),
    y: priceToY(p.price, coordCtx)
  }));

  // 1. Check anchor handles first (within 7px radius)
  for (let i = 0; i < pts.length; i++) {
    const dist = Math.hypot(mouseX - pts[i].x, mouseY - pts[i].y);
    if (dist <= threshold + 2) {
      return { isHit: true, handleIndex: i };
    }
  }

  const p1 = pts[0];
  const p2 = pts.length > 1 ? pts[1] : pts[0];

  // 2. Check drawing body/lines
  switch (drawing.type) {
    case 'trendline': {
      if (pts.length < 2) return { isHit: false, handleIndex: null };
      const d = distToSegment(mouseX, mouseY, p1.x, p1.y, p2.x, p2.y);
      return { isHit: d <= threshold, handleIndex: null };
    }

    case 'horizontal_line': {
      const d = Math.abs(mouseY - p1.y);
      return { isHit: d <= threshold, handleIndex: null };
    }

    case 'horizontal_ray': {
      const d = Math.abs(mouseY - p1.y);
      const isRightOfStart = mouseX >= p1.x - threshold;
      return { isHit: d <= threshold && isRightOfStart, handleIndex: null };
    }

    case 'extended_line': {
      if (pts.length < 2) return { isHit: false, handleIndex: null };
      const d = distToLine(mouseX, mouseY, p1.x, p1.y, p2.x, p2.y);
      return { isHit: d <= threshold, handleIndex: null };
    }

    case 'vertical_line': {
      const d = Math.abs(mouseX - p1.x);
      return { isHit: d <= threshold, handleIndex: null };
    }

    case 'rectangle': {
      if (pts.length < 2) return { isHit: false, handleIndex: null };
      const minX = Math.min(p1.x, p2.x);
      const maxX = Math.max(p1.x, p2.x);
      const minY = Math.min(p1.y, p2.y);
      const maxY = Math.max(p1.y, p2.y);

      // Hit boundary edges or inside fill
      const isInside = mouseX >= minX && mouseX <= maxX && mouseY >= minY && mouseY <= maxY;
      const nearBorder =
        distToSegment(mouseX, mouseY, minX, minY, maxX, minY) <= threshold ||
        distToSegment(mouseX, mouseY, maxX, minY, maxX, maxY) <= threshold ||
        distToSegment(mouseX, mouseY, maxX, maxY, minX, maxY) <= threshold ||
        distToSegment(mouseX, mouseY, minX, maxY, minX, minY) <= threshold;

      return { isHit: isInside || nearBorder, handleIndex: null };
    }

    case 'price_zone': {
      if (pts.length < 2) return { isHit: false, handleIndex: null };
      const minY = Math.min(p1.y, p2.y);
      const maxY = Math.max(p1.y, p2.y);
      const isInside = mouseY >= minY - threshold && mouseY <= maxY + threshold;
      return { isHit: isInside, handleIndex: null };
    }

    case 'parallel_channel': {
      if (pts.length < 2) return { isHit: false, handleIndex: null };
      const dBase = distToSegment(mouseX, mouseY, p1.x, p1.y, p2.x, p2.y);
      const offsetPrice = drawing.channelOffsetPrice || (drawing.points[0].price * 0.015);
      const offsetY = priceToY(drawing.points[0].price + offsetPrice, coordCtx) - p1.y;
      const dOffset = distToSegment(mouseX, mouseY, p1.x, p1.y + offsetY, p2.x, p2.y + offsetY);
      return { isHit: dBase <= threshold || dOffset <= threshold, handleIndex: null };
    }

    case 'fibonacci_retracement':
    case 'fibonacci_extension': {
      if (pts.length < 2) return { isHit: false, handleIndex: null };
      const minX = Math.min(p1.x, p2.x) - threshold;
      const maxX = coordCtx.chartWidth;
      if (mouseX >= minX && mouseX <= maxX) {
        const span = Math.abs(p2.y - p1.y);
        const topY = Math.min(p1.y, p2.y);
        if (mouseY >= topY - threshold && mouseY <= topY + span + threshold) {
          return { isHit: true, handleIndex: null };
        }
      }
      return { isHit: false, handleIndex: null };
    }

    default:
      return { isHit: false, handleIndex: null };
  }
}

/**
 * Calculates the exact price level of a drawing at a specific timestamp
 */
export function getDrawingPriceAtTime(drawing: ChartDrawing, time: number): number | null {
  if (!drawing.points || drawing.points.length === 0) return null;

  switch (drawing.type) {
    case 'horizontal_line':
    case 'horizontal_ray':
      return drawing.points[0].price;

    case 'price_zone':
      return (drawing.points[0].price + (drawing.points[1]?.price || drawing.points[0].price)) / 2;

    case 'trendline':
    case 'extended_line': {
      if (drawing.points.length < 2) return drawing.points[0].price;
      const p1 = drawing.points[0];
      const p2 = drawing.points[1];
      const dt = p2.time - p1.time;
      if (dt === 0) return p1.price;
      const slope = (p2.price - p1.price) / dt;
      return p1.price + slope * (time - p1.time);
    }

    default:
      return drawing.points[0].price;
  }
}
