import * as React from 'react';
import { useState, useRef, useCallback } from 'react';

interface UseZoomPanProps {
  initialScale?: number;
  maxScale?: number;
  minScale?: number;
}

export const useZoomPan = ({ initialScale = 1, maxScale = 5, minScale = 1 }: UseZoomPanProps = {}) => {
  const [scale, setScale] = useState(initialScale);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef({ x: 0, y: 0 });

  const resetZoom = useCallback(() => {
    setScale(1);
    setPosition({ x: 0, y: 0 });
  }, []);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.stopPropagation();
    const delta = e.deltaY * -0.001;
    const newScale = Math.min(Math.max(minScale, scale + delta), maxScale);
    setScale(newScale);
    if (newScale === minScale) setPosition({ x: 0, y: 0 });
  }, [scale, maxScale, minScale]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (scale > 1) {
      e.preventDefault();
      setIsDragging(true);
      dragStartRef.current = { x: e.clientX - position.x, y: e.clientY - position.y };
    }
  }, [scale, position]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (isDragging && scale > 1) {
      e.preventDefault();
      setPosition({
        x: e.clientX - dragStartRef.current.x,
        y: e.clientY - dragStartRef.current.y
      });
    }
  }, [isDragging, scale]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (scale > 1) {
        resetZoom();
    } else {
        setScale(2);
        setPosition({ x: 0, y: 0 });
    }
  }, [scale, resetZoom]);

  return {
    scale,
    setScale,
    position,
    setPosition,
    isDragging,
    resetZoom,
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