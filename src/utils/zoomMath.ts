export interface Point {
  x: number;
  y: number;
}

export interface ViewportRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface ZoomTransformInput {
  currentPosition: Point;
  currentScale: number;
  targetScale: number;
  minScale: number;
  maxScale: number;
  anchor: Point;
}

export const CENTER_ANCHOR: Point = { x: 0, y: 0 };

export const clampScale = (scale: number, minScale: number, maxScale: number): number => {
  return Math.min(Math.max(minScale, scale), maxScale);
};

export const getAnchorPoint = (clientPoint: Point, viewportRect: ViewportRect): Point => {
  return {
    x: clientPoint.x - viewportRect.left - viewportRect.width / 2,
    y: clientPoint.y - viewportRect.top - viewportRect.height / 2
  };
};

export const getAnchoredPosition = (
  currentPosition: Point,
  currentScale: number,
  nextScale: number,
  anchor: Point
): Point => {
  if (currentScale <= 0 || nextScale <= 0 || currentScale === nextScale) {
    return currentPosition;
  }

  const scaleRatio = nextScale / currentScale;

  return {
    x: anchor.x - (anchor.x - currentPosition.x) * scaleRatio,
    y: anchor.y - (anchor.y - currentPosition.y) * scaleRatio
  };
};

export const getZoomTransform = ({
  currentPosition,
  currentScale,
  targetScale,
  minScale,
  maxScale,
  anchor
}: ZoomTransformInput): { scale: number; position: Point } => {
  const nextScale = clampScale(targetScale, minScale, maxScale);

  if (nextScale === minScale) {
    return { scale: nextScale, position: CENTER_ANCHOR };
  }

  return {
    scale: nextScale,
    position: getAnchoredPosition(currentPosition, currentScale, nextScale, anchor)
  };
};
