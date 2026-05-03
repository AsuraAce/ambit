import * as React from 'react';
import { useState, useRef, useCallback } from 'react';
import {
  CENTER_ANCHOR,
  Point,
  getAnchorPoint,
  getZoomTransform
} from '../utils/zoomMath';

interface UseZoomPanProps {
  initialScale?: number;
  maxScale?: number;
  minScale?: number;
}

interface ZoomPanState {
  scale: number;
  position: Point;
}

const getEventAnchor = (e: React.MouseEvent | React.WheelEvent): Point => {
  const currentTarget = e.currentTarget as EventTarget & {
    getBoundingClientRect?: () => DOMRect;
  };

  if (typeof currentTarget.getBoundingClientRect !== 'function') {
    return CENTER_ANCHOR;
  }

  return getAnchorPoint(
    { x: e.clientX, y: e.clientY },
    currentTarget.getBoundingClientRect()
  );
};

export const useZoomPan = ({ initialScale = 1, maxScale = 5, minScale = 1 }: UseZoomPanProps = {}) => {
  const [view, setView] = useState<ZoomPanState>({
    scale: initialScale,
    position: CENTER_ANCHOR
  });
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef({ x: 0, y: 0 });

  const { scale, position } = view;

  const setScale = useCallback<React.Dispatch<React.SetStateAction<number>>>((nextScale) => {
    setView((current) => ({
      ...current,
      scale: typeof nextScale === 'function' ? nextScale(current.scale) : nextScale
    }));
  }, []);

  const setPosition = useCallback<React.Dispatch<React.SetStateAction<Point>>>((nextPosition) => {
    setView((current) => ({
      ...current,
      position: typeof nextPosition === 'function' ? nextPosition(current.position) : nextPosition
    }));
  }, []);

  const resetZoom = useCallback(() => {
    setView({ scale: minScale, position: CENTER_ANCHOR });
  }, [minScale]);

  const zoomAt = useCallback((anchor: Point, targetScale: number) => {
    setView((current) => getZoomTransform({
      currentPosition: current.position,
      currentScale: current.scale,
      targetScale,
      minScale,
      maxScale,
      anchor
    }));
  }, [maxScale, minScale]);

  const zoomBy = useCallback((delta: number, anchor: Point = CENTER_ANCHOR) => {
    setView((current) => getZoomTransform({
      currentPosition: current.position,
      currentScale: current.scale,
      targetScale: current.scale + delta,
      minScale,
      maxScale,
      anchor
    }));
  }, [maxScale, minScale]);

  const zoomIn = useCallback(() => {
    zoomBy(0.1);
  }, [zoomBy]);

  const zoomOut = useCallback(() => {
    zoomBy(-0.1);
  }, [zoomBy]);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    e.stopPropagation();
    zoomBy(e.deltaY * -0.001, getEventAnchor(e));
  }, [zoomBy]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (scale > minScale) {
      e.preventDefault();
      setIsDragging(true);
      dragStartRef.current = { x: e.clientX - position.x, y: e.clientY - position.y };
    }
  }, [scale, minScale, position]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (isDragging && scale > minScale) {
      e.preventDefault();
      setPosition({
        x: e.clientX - dragStartRef.current.x,
        y: e.clientY - dragStartRef.current.y
      });
    }
  }, [isDragging, scale, minScale, setPosition]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (scale > minScale) {
      resetZoom();
    } else {
      zoomAt(getEventAnchor(e), 2);
    }
  }, [scale, minScale, resetZoom, zoomAt]);

  return {
    scale,
    setScale,
    position,
    setPosition,
    isDragging,
    resetZoom,
    zoomAt,
    zoomBy,
    zoomIn,
    zoomOut,
    handlers: {
      onWheel: handleWheel,
      onMouseDown: handleMouseDown,
      onMouseMove: handleMouseMove,
      onMouseUp: handleMouseUp,
      onMouseLeave: handleMouseUp,
      onDoubleClick: handleDoubleClick
    }
  };
};
