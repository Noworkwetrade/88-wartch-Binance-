/**
 * Interactive Drawing Tools State Management Hook
 *
 * Implements:
 * - Full CRUD & History (Undo / Redo)
 * - Persistent per-asset localStorage storage
 * - Point creation state machine (1-point, 2-point, and 3-point tools)
 * - Selection, Dragging, Resizing, and Lock/Hide states
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { ChartDrawing, ChartPoint, DrawingToolType, LineStyleType, DrawingAlert } from '../types/drawings.ts';
import { CoordinateContext, hitTestDrawing } from '../utils/drawingGeometry.ts';

function getStorageKey(symbol: string): string {
  return `nwwt_drawings_${symbol.toUpperCase()}`;
}

export function useChartDrawings(symbol: string) {
  const [drawings, setDrawings] = useState<ChartDrawing[]>(() => {
    try {
      const raw = localStorage.getItem(getStorageKey(symbol));
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  });

  const [activeTool, setActiveTool] = useState<DrawingToolType>('cursor');
  const [selectedDrawingId, setSelectedDrawingId] = useState<string | null>(null);

  // In-progress drawing points
  const [pendingPoints, setPendingPoints] = useState<ChartPoint[]>([]);

  // Interactive Drag & Resize state
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [dragMode, setDragMode] = useState<'none' | 'move_drawing' | 'move_handle'>('none');
  const [activeHandleIndex, setActiveHandleIndex] = useState<number | null>(null);
  const dragStartPointRef = useRef<ChartPoint | null>(null);
  const initialDrawingSnapshotRef = useRef<ChartDrawing | null>(null);

  // Undo / Redo Stacks
  const [undoStack, setUndoStack] = useState<ChartDrawing[][]>([]);
  const [redoStack, setRedoStack] = useState<ChartDrawing[][]>([]);

  // Reload drawings when symbol changes
  useEffect(() => {
    try {
      const raw = localStorage.getItem(getStorageKey(symbol));
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          setDrawings(parsed);
          setSelectedDrawingId(null);
          setPendingPoints([]);
          setUndoStack([]);
          setRedoStack([]);
          return;
        }
      }
    } catch {}
    setDrawings([]);
    setSelectedDrawingId(null);
    setPendingPoints([]);
    setUndoStack([]);
    setRedoStack([]);
  }, [symbol]);

  // Persist drawings to localStorage
  const saveDrawings = useCallback(
    (newDrawings: ChartDrawing[]) => {
      setDrawings(newDrawings);
      try {
        localStorage.setItem(getStorageKey(symbol), JSON.stringify(newDrawings));
      } catch (err) {
        console.warn('Failed to save drawings to localStorage:', err);
      }
    },
    [symbol]
  );

  // Push state to undo stack before mutation
  const pushUndo = useCallback(
    (current: ChartDrawing[]) => {
      setUndoStack((prev) => [...prev.slice(-25), current]);
      setRedoStack([]); // Clear redo upon new action
    },
    []
  );

  const undo = useCallback(() => {
    if (undoStack.length === 0) return;
    const previous = undoStack[undoStack.length - 1];
    setUndoStack((prev) => prev.slice(0, prev.length - 1));
    setRedoStack((prev) => [...prev, drawings]);
    saveDrawings(previous);
  }, [undoStack, drawings, saveDrawings]);

  const redo = useCallback(() => {
    if (redoStack.length === 0) return;
    const next = redoStack[redoStack.length - 1];
    setRedoStack((prev) => prev.slice(0, prev.length - 1));
    setUndoStack((prev) => [...prev, drawings]);
    saveDrawings(next);
  }, [redoStack, drawings, saveDrawings]);

  const selectDrawing = useCallback((id: string | null) => {
    setSelectedDrawingId(id);
  }, []);

  const updateDrawing = useCallback(
    (id: string, updates: Partial<ChartDrawing>) => {
      pushUndo(drawings);
      const next = drawings.map((d) => (d.id === id ? { ...d, ...updates, updatedAt: Date.now() } : d));
      saveDrawings(next);
    },
    [drawings, pushUndo, saveDrawings]
  );

  const deleteDrawing = useCallback(
    (id: string) => {
      pushUndo(drawings);
      const next = drawings.filter((d) => d.id !== id);
      saveDrawings(next);
      if (selectedDrawingId === id) setSelectedDrawingId(null);
    },
    [drawings, pushUndo, saveDrawings, selectedDrawingId]
  );

  const duplicateDrawing = useCallback(
    (id: string) => {
      const target = drawings.find((d) => d.id === id);
      if (!target) return;

      pushUndo(drawings);
      const priceOffset = target.points[0] ? target.points[0].price * 0.006 : 0;
      const duplicated: ChartDrawing = {
        ...target,
        id: `drawing-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
        name: `${target.name} (Copy)`,
        points: target.points.map((p) => ({
          time: p.time,
          price: p.price + priceOffset
        })),
        createdAt: Date.now(),
        updatedAt: Date.now(),
        alerts: [] // Alerts are not copied by default
      };

      const next = [...drawings, duplicated];
      saveDrawings(next);
      setSelectedDrawingId(duplicated.id);
    },
    [drawings, pushUndo, saveDrawings]
  );

  const toggleLock = useCallback(
    (id: string) => {
      const target = drawings.find((d) => d.id === id);
      if (!target) return;
      updateDrawing(id, { locked: !target.locked });
    },
    [drawings, updateDrawing]
  );

  const toggleVisibility = useCallback(
    (id: string) => {
      const target = drawings.find((d) => d.id === id);
      if (!target) return;
      updateDrawing(id, { visible: !target.visible });
    },
    [drawings, updateDrawing]
  );

  const renameDrawing = useCallback(
    (id: string, name: string) => {
      updateDrawing(id, { name });
    },
    [updateDrawing]
  );

  const clearAllDrawings = useCallback(() => {
    if (drawings.length === 0) return;
    pushUndo(drawings);
    saveDrawings([]);
    setSelectedDrawingId(null);
  }, [drawings, pushUndo, saveDrawings]);

  // Alert management for selected drawing
  const addAlertToDrawing = useCallback(
    (drawingId: string, alertData: Omit<DrawingAlert, 'id' | 'drawingId' | 'createdAt'>) => {
      const target = drawings.find((d) => d.id === drawingId);
      if (!target) return;

      const newAlert: DrawingAlert = {
        ...alertData,
        id: `alert-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
        drawingId,
        createdAt: Date.now()
      };

      const updatedAlerts = [...(target.alerts || []), newAlert];
      updateDrawing(drawingId, { alerts: updatedAlerts });
    },
    [drawings, updateDrawing]
  );

  const removeAlertFromDrawing = useCallback(
    (drawingId: string, alertId: string) => {
      const target = drawings.find((d) => d.id === drawingId);
      if (!target) return;

      const updatedAlerts = (target.alerts || []).filter((a) => a.id !== alertId);
      updateDrawing(drawingId, { alerts: updatedAlerts });
    },
    [drawings, updateDrawing]
  );

  const toggleAlertStatus = useCallback(
    (drawingId: string, alertId: string, enabled: boolean) => {
      const target = drawings.find((d) => d.id === drawingId);
      if (!target) return;

      const updatedAlerts = (target.alerts || []).map((a) => (a.id === alertId ? { ...a, enabled } : a));
      updateDrawing(drawingId, { alerts: updatedAlerts });
    },
    [drawings, updateDrawing]
  );

  // Helper to get friendly drawing tool label
  const getToolDisplayName = (type: DrawingToolType): string => {
    switch (type) {
      case 'trendline': return 'Trendline';
      case 'horizontal_line': return 'Horizontal Line';
      case 'horizontal_ray': return 'Horizontal Ray';
      case 'extended_line': return 'Extended Line';
      case 'vertical_line': return 'Vertical Line';
      case 'fibonacci_retracement': return 'Fib Retracement';
      case 'fibonacci_extension': return 'Fib Extension';
      case 'parallel_channel': return 'Parallel Channel';
      case 'rectangle': return 'Rectangle Zone';
      case 'price_zone': return 'Support / Resistance Zone';
      default: return 'Drawing';
    }
  };

  /**
   * Finalize a newly completed drawing
   */
  const completeNewDrawing = useCallback(
    (tool: DrawingToolType, points: ChartPoint[]) => {
      pushUndo(drawings);

      let defaultColor = '#f59e0b'; // Gold / Amber
      let glow = true;
      let glowColor = '#f59e0b';

      // Default up green / down red for trendlines
      if (tool === 'trendline' && points.length >= 2) {
        const isUp = points[1].price >= points[0].price;
        defaultColor = isUp ? '#10b981' : '#ef4444';
        glowColor = defaultColor;
      } else if (tool === 'price_zone') {
        defaultColor = '#3b82f6'; // Blue zone
        glowColor = '#3b82f6';
      } else if (tool === 'rectangle') {
        defaultColor = '#8b5cf6'; // Purple
        glowColor = '#8b5cf6';
      }

      const newDrawing: ChartDrawing = {
        id: `drawing-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
        asset: symbol,
        type: tool,
        name: `${getToolDisplayName(tool)} ${drawings.length + 1}`,
        points,
        color: defaultColor,
        fillColor: defaultColor,
        fillOpacity: 0.12,
        thickness: 2,
        lineStyle: 'solid',
        glow,
        glowColor,
        glowIntensity: 6,
        locked: false,
        visible: true,
        alerts: [],
        createdAt: Date.now(),
        updatedAt: Date.now()
      };

      const next = [...drawings, newDrawing];
      saveDrawings(next);
      setSelectedDrawingId(newDrawing.id);
      setPendingPoints([]);
      setActiveTool('cursor'); // Switch back to pointer for immediate manipulation
    },
    [drawings, pushUndo, saveDrawings, symbol]
  );

  return {
    drawings,
    setDrawings: saveDrawings,
    activeTool,
    setActiveTool,
    selectedDrawingId,
    selectDrawing,
    pendingPoints,
    setPendingPoints,
    isDragging,
    setIsDragging,
    dragMode,
    setDragMode,
    activeHandleIndex,
    setActiveHandleIndex,
    dragStartPointRef,
    initialDrawingSnapshotRef,
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
    canUndo: undoStack.length > 0,
    canRedo: redoStack.length > 0,
    addAlertToDrawing,
    removeAlertFromDrawing,
    toggleAlertStatus
  };
}
