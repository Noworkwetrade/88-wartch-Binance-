/**
 * NWWT Drawing Tools & Alert Engine Type Definitions
 * Professional Trading Drawing System with Real-Time Price/Time Anchoring
 */

export type DrawingToolType =
  | 'cursor'
  | 'trendline'
  | 'horizontal_line'
  | 'horizontal_ray'
  | 'extended_line'
  | 'vertical_line'
  | 'fibonacci_retracement'
  | 'fibonacci_extension'
  | 'parallel_channel'
  | 'rectangle'
  | 'price_zone';

export type LineStyleType = 'solid' | 'dashed' | 'dotted';

export interface ChartPoint {
  time: number; // Unix timestamp in ms
  price: number; // Asset price
}

export type AlertTriggerType = 'price_touch' | 'price_cross' | 'price_rejection';
export type AlertDirection = 'any' | 'crossing_up' | 'crossing_down';

export interface DrawingAlert {
  id: string;
  drawingId: string;
  asset: string;
  timeframe: string;
  type: AlertTriggerType;
  direction: AlertDirection;
  targetPrice?: number; // Calculated or explicit price
  tolerancePercent: number; // E.g. 0.15% touch tolerance
  rejectionBufferPercent?: number; // E.g. 0.3% move away required for confirmation
  rejectionConfirmed?: boolean;
  cooldownMs: number; // E.g. 60,000 ms
  repeat: boolean;
  enabled: boolean;
  lastTriggeredAt?: number;
  lastTriggeredPrice?: number;
  message?: string;
  createdAt: number;
}

export interface DrawingAlertNotification {
  id: string;
  alertId: string;
  drawingId: string;
  drawingName: string;
  asset: string;
  timeframe: string;
  alertType: AlertTriggerType;
  direction?: AlertDirection;
  triggerPrice: number;
  triggerTime: number;
  message: string;
}

export interface ChartDrawing {
  id: string;
  asset: string; // E.g. 'BTCUSDT'
  type: DrawingToolType;
  name: string;
  points: ChartPoint[]; // 1 to 3 anchor points
  color: string;
  fillColor?: string;
  fillOpacity?: number; // 0 to 1
  thickness: number; // 1 to 5
  lineStyle: LineStyleType;
  glow: boolean;
  glowColor?: string;
  glowIntensity?: number; // 1 to 10
  locked: boolean;
  visible: boolean;
  alerts: DrawingAlert[];
  createdAt: number;
  updatedAt: number;
  // Fibonacci specific configuration
  fibLevels?: { level: number; color: string; label: string; enabled: boolean }[];
  // Channel width offset
  channelOffsetPrice?: number;
}

export interface DrawingInteractionState {
  isDrawing: boolean;
  tool: DrawingToolType;
  currentPoints: ChartPoint[];
  selectedDrawingId: string | null;
  dragMode: 'none' | 'drawing_point' | 'move_drawing' | 'move_handle';
  activeHandleIndex: number | null;
  dragStartPoint: ChartPoint | null;
  initialDrawingSnapshot: ChartDrawing | null;
}
