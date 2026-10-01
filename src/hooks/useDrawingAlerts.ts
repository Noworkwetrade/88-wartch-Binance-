/**
 * Real-Time Drawing Alert Evaluation Engine
 *
 * Evaluates live market prices and closed candles against drawing geometry:
 * - Price Touch (reaches target tolerance buffer)
 * - Price Cross (directional crossing through drawing boundary)
 * - Price Rejection (touches level and moves away with confirmation)
 *
 * Features:
 * - Duplicate alert suppression at identical price levels
 * - Cooldown & repeat controls
 * - Per-drawing and global in-app notifications
 * - Sound / visual glow trigger pulse
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { ChartDrawing, DrawingAlert, DrawingAlertNotification, AlertTriggerType, AlertDirection } from '../types/drawings.ts';
import { getDrawingPriceAtTime } from '../utils/drawingGeometry.ts';
import { Candle } from '../types.ts';

const NOTIFICATIONS_STORAGE_KEY = 'nwwt_drawing_alert_notifications';

export function useDrawingAlerts(
  symbol: string,
  timeframe: string,
  drawings: ChartDrawing[],
  currentPrice: number | null,
  candles: Candle[],
  onUpdateDrawings: (updated: ChartDrawing[]) => void
) {
  const [notifications, setNotifications] = useState<DrawingAlertNotification[]>([]);
  const [notificationHistory, setNotificationHistory] = useState<DrawingAlertNotification[]>(() => {
    try {
      const saved = localStorage.getItem(NOTIFICATIONS_STORAGE_KEY);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const previousPriceRef = useRef<number | null>(currentPrice);
  const lastEvaluationTimeRef = useRef<number>(0);

  // Play subtle web audio notification chime (using Web Audio API, no external audio files required)
  const playAlertChime = useCallback(() => {
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, ctx.currentTime); // A5 note
      osc.frequency.exponentialRampToValueAtTime(1320, ctx.currentTime + 0.15); // E6

      gain.gain.setValueAtTime(0.2, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.35);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.35);
    } catch {
      // Audio playback silently caught if user hasn't interacted
    }
  }, []);

  // Main real-time alert evaluation loop
  useEffect(() => {
    if (!currentPrice || currentPrice <= 0 || isNaN(currentPrice)) return;
    const now = Date.now();

    // Limit evaluation frequency to at most once per 200ms
    if (now - lastEvaluationTimeRef.current < 200) return;
    lastEvaluationTimeRef.current = now;

    const prevPrice = previousPriceRef.current ?? currentPrice;
    previousPriceRef.current = currentPrice;

    if (!drawings || drawings.length === 0) return;

    let hasDrawingUpdates = false;
    const updatedDrawings = drawings.map((drawing) => {
      if (!drawing.alerts || drawing.alerts.length === 0 || !drawing.visible) {
        return drawing;
      }

      const drawingPrice = getDrawingPriceAtTime(drawing, now);
      if (drawingPrice === null || isNaN(drawingPrice)) return drawing;

      const updatedAlerts = drawing.alerts.map((alert) => {
        if (!alert.enabled) return alert;

        // Check Cooldown
        if (alert.lastTriggeredAt && now - alert.lastTriggeredAt < alert.cooldownMs) {
          return alert;
        }

        // Check Duplicate price level suppression (unless repeat is enabled and price shifted > 0.1%)
        if (
          alert.lastTriggeredPrice &&
          Math.abs(currentPrice - alert.lastTriggeredPrice) / (drawingPrice || 1) < 0.001 &&
          !alert.repeat
        ) {
          return alert;
        }

        let isTriggered = false;
        let triggerMessage = '';

        const distPct = Math.abs(currentPrice - drawingPrice) / (drawingPrice || 1) * 100;
        const tolerance = alert.tolerancePercent || 0.18;

        // 1. PRICE TOUCH
        if (alert.type === 'price_touch') {
          if (distPct <= tolerance) {
            isTriggered = true;
            triggerMessage = `Price touched ${drawing.name} at $${currentPrice.toFixed(2)}`;
          }
        }

        // 2. PRICE CROSS
        else if (alert.type === 'price_cross') {
          const crossedUp = prevPrice < drawingPrice && currentPrice >= drawingPrice;
          const crossedDown = prevPrice > drawingPrice && currentPrice <= drawingPrice;

          if (alert.direction === 'crossing_up' && crossedUp) {
            isTriggered = true;
            triggerMessage = `Price crossed UP above ${drawing.name} at $${currentPrice.toFixed(2)}`;
          } else if (alert.direction === 'crossing_down' && crossedDown) {
            isTriggered = true;
            triggerMessage = `Price crossed DOWN below ${drawing.name} at $${currentPrice.toFixed(2)}`;
          } else if (alert.direction === 'any' && (crossedUp || crossedDown)) {
            isTriggered = true;
            triggerMessage = `Price crossed ${crossedUp ? 'UP' : 'DOWN'} through ${drawing.name} at $${currentPrice.toFixed(2)}`;
          }
        }

        // 3. PRICE REJECTION WITH CONFIRMATION
        else if (alert.type === 'price_rejection') {
          const buffer = alert.rejectionBufferPercent || 0.25;
          // Check if previously touched level and now moved away
          const wasNear = Math.abs(prevPrice - drawingPrice) / (drawingPrice || 1) * 100 <= tolerance * 1.5;
          const nowAway = distPct >= buffer;

          if (wasNear && nowAway) {
            const isRejectionUp = currentPrice > drawingPrice;
            const isRejectionDown = currentPrice < drawingPrice;

            if (alert.direction === 'crossing_up' && isRejectionUp) {
              isTriggered = true;
              triggerMessage = `Price rejected off ${drawing.name} and bounced UP to $${currentPrice.toFixed(2)}`;
            } else if (alert.direction === 'crossing_down' && isRejectionDown) {
              isTriggered = true;
              triggerMessage = `Price rejected off ${drawing.name} and pulled DOWN to $${currentPrice.toFixed(2)}`;
            } else if (alert.direction === 'any') {
              isTriggered = true;
              triggerMessage = `Price confirmed rejection off ${drawing.name} at $${currentPrice.toFixed(2)}`;
            }
          }
        }

        if (isTriggered) {
          hasDrawingUpdates = true;

          // Create notification item
          const newNotif: DrawingAlertNotification = {
            id: `notif-${now}-${Math.random().toString(36).substr(2, 6)}`,
            alertId: alert.id,
            drawingId: drawing.id,
            drawingName: drawing.name,
            asset: symbol,
            timeframe,
            alertType: alert.type,
            direction: alert.direction,
            triggerPrice: currentPrice,
            triggerTime: now,
            message: triggerMessage
          };

          setNotifications((prev) => [newNotif, ...prev.slice(0, 4)]);
          setNotificationHistory((prev) => {
            const updated = [newNotif, ...prev.slice(0, 49)];
            try {
              localStorage.setItem(NOTIFICATIONS_STORAGE_KEY, JSON.stringify(updated));
            } catch {}
            return updated;
          });

          playAlertChime();

          return {
            ...alert,
            lastTriggeredAt: now,
            lastTriggeredPrice: currentPrice,
            enabled: alert.repeat ? true : false // Disable if repeat is false
          };
        }

        return alert;
      });

      return {
        ...drawing,
        alerts: updatedAlerts
      };
    });

    if (hasDrawingUpdates) {
      onUpdateDrawings(updatedDrawings);
    }
  }, [currentPrice, drawings, symbol, timeframe, onUpdateDrawings, playAlertChime]);

  const dismissNotification = useCallback((id: string) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  }, []);

  const clearNotificationHistory = useCallback(() => {
    setNotificationHistory([]);
    try {
      localStorage.removeItem(NOTIFICATIONS_STORAGE_KEY);
    } catch {}
  }, []);

  return {
    notifications,
    notificationHistory,
    dismissNotification,
    clearNotificationHistory
  };
}
