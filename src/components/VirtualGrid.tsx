
import * as React from 'react';
import { useEffect, useState, useRef, useLayoutEffect, useMemo, useImperativeHandle, forwardRef } from 'react';
import { LayoutMode } from '../types';
import { calculateLayout, LayoutResult } from '../services/layoutEngine';

interface VirtualGridProps<T> {
  items: T[];
  layout: LayoutMode;
  minItemWidth: number;
  gap?: number;
  padding?: number;
  scrollContainerRef: React.RefObject<HTMLElement | null>;
  renderItem: (item: T, style: React.CSSProperties, index: number, layout?: { x: number, y: number, width: number, height: number }) => React.ReactNode;
  getItemRatio?: (item: T) => number;
  onLayoutChange?: (columns: number, rowHeight: number) => void;
  onRangeSelection?: (selectedIndexes: number[], isAdditive: boolean) => void;
  onBackgroundClick?: () => void;
  onEndReached?: () => void;
}

export interface VirtualGridHandle {
  // ... existing handle interface
  navigate: (currentIndex: number, key: string) => number;
  scrollToItem: (index: number) => void;
}

const VirtualGridInternal = <T extends { id: string }>(
  {
    items,
    layout,
    minItemWidth,
    gap = 16,
    padding = 16,
    scrollContainerRef,
    renderItem,
    getItemRatio = () => 1,
    onLayoutChange,
    onRangeSelection,
    onBackgroundClick,
    onEndReached
  }: VirtualGridProps<T>,
  ref: React.Ref<VirtualGridHandle>
) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);

  // --- Visual State for Selection Box ---
  const [dragBox, setDragBox] = useState<{ x: number, y: number, w: number, h: number } | null>(null);

  // --- Refs ---
  const layoutResultRef = useRef<LayoutResult>({ positions: [], totalHeight: 0, columns: 1, rowHeight: 0 });
  const onRangeSelectionRef = useRef(onRangeSelection);
  const onBackgroundClickRef = useRef(onBackgroundClick);
  const onEndReachedRef = useRef(onEndReached);
  const isDraggingRef = useRef(false);
  const dragStartRef = useRef<{ x: number, y: number } | null>(null);

  useEffect(() => {
    onRangeSelectionRef.current = onRangeSelection;
    onBackgroundClickRef.current = onBackgroundClick;
    onEndReachedRef.current = onEndReached;
  }, [onRangeSelection, onBackgroundClick, onEndReached]);

  // Measure container width
  useLayoutEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver(entries => {
      if (entries[0]) {
        setContainerWidth(entries[0].contentRect.width);
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  // Track scroll position with requestAnimationFrame
  useEffect(() => {
    const scrollContainer = scrollContainerRef.current;
    if (!scrollContainer) return;

    let rafId: number;
    let lastCallTime = 0;

    const handleScroll = () => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        setScrollTop(scrollContainer.scrollTop);

        // Infinite Scroll Trigger
        const { scrollHeight, clientHeight, scrollTop } = scrollContainer;
        // Threshold: 3000px from bottom (approx 3-5 screen heights)
        if (scrollHeight - (scrollTop + clientHeight) < 3000) {
          // Debounce slightly to avoid spamming per frame if logic is fast
          const now = Date.now();
          if (now - lastCallTime > 200) {
            lastCallTime = now;
            onEndReachedRef.current?.();
          }
        }
      });
    };

    handleScroll();
    scrollContainer.addEventListener('scroll', handleScroll, { passive: true });

    return () => {
      scrollContainer.removeEventListener('scroll', handleScroll);
      cancelAnimationFrame(rafId);
    };
  }, [scrollContainerRef]);

  // --- Layout Engine Integration ---
  const { positions, totalHeight, columns, rowHeight } = useMemo(() => {
    const result = calculateLayout({
      items,
      layoutMode: layout,
      containerWidth,
      minItemWidth,
      gap,
      padding,
      getItemRatio
    });
    return result;
  }, [items, layout, containerWidth, minItemWidth, gap, padding, getItemRatio]);

  // Sync positions for event handlers and imperative handle
  useEffect(() => {
    layoutResultRef.current = { positions, totalHeight, columns, rowHeight };
  }, [positions, totalHeight, columns, rowHeight]);

  useEffect(() => {
    if (onLayoutChange) {
      onLayoutChange(columns, rowHeight);
    }
  }, [columns, rowHeight, onLayoutChange]);

  // --- Exposed Methods ---
  useImperativeHandle(ref, () => ({
    navigate: (currentIndex: number, key: string) => {
      const { positions } = layoutResultRef.current;
      if (!positions || positions.length === 0) return 0;
      if (currentIndex < 0) return 0;
      if (currentIndex >= positions.length) return positions.length - 1;

      // Sequential Nav
      if (key === 'ArrowLeft') return Math.max(0, currentIndex - 1);
      if (key === 'ArrowRight') return Math.min(positions.length - 1, currentIndex + 1);

      // Spatial Nav
      const currentPos = positions[currentIndex];
      const cx = currentPos.left + currentPos.width / 2;
      const cy = currentPos.top + currentPos.height / 2;

      let bestIndex = -1;
      let minScore = Infinity;

      // Use a localized search for better performance in spatial nav too
      // Only check items within a reasonable vertical range
      const visibleRange = 2000;

      positions.forEach((pos, index) => {
        if (index === currentIndex) return;

        // Optimization: Skip items too far away vertically
        if (Math.abs(pos.top - currentPos.top) > visibleRange) return;

        const tcx = pos.left + pos.width / 2;
        const tcy = pos.top + pos.height / 2;

        let isValid = false;
        if (key === 'ArrowUp') {
          if (tcy < cy) isValid = true;
        } else if (key === 'ArrowDown') {
          if (tcy > cy) isValid = true;
        }

        if (isValid) {
          const dy = tcy - cy;
          const dx = Math.abs(tcx - cx);
          const score = (dx * dx * 4) + (dy * dy);

          if (score < minScore) {
            minScore = score;
            bestIndex = index;
          }
        }
      });

      return bestIndex !== -1 ? bestIndex : currentIndex;
    },
    scrollToItem: (index: number) => {
      const { positions } = layoutResultRef.current;
      const container = scrollContainerRef.current;
      if (!positions || !positions[index] || !container) return;

      const pos = positions[index];
      const itemTop = pos.top;
      const itemBottom = pos.top + pos.height;
      const viewportTop = container.scrollTop;
      const viewportHeight = container.clientHeight;
      const viewportBottom = viewportTop + viewportHeight;

      const paddingOffset = 20;

      if (itemTop < viewportTop + paddingOffset) {
        container.scrollTo({ top: Math.max(0, itemTop - paddingOffset), behavior: 'smooth' });
      } else if (itemBottom > viewportBottom - paddingOffset) {
        container.scrollTo({ top: itemBottom - viewportHeight + paddingOffset, behavior: 'smooth' });
      }
    }
  }));


  // --- Selection Interaction ---
  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;

    if (!containerRef.current) return;

    e.preventDefault();

    const rect = containerRef.current.getBoundingClientRect();
    const startX = e.clientX - rect.left;
    const startY = e.clientY - rect.top + containerRef.current.scrollTop; // Adjust for scroll

    dragStartRef.current = { x: startX, y: startY };
    isDraggingRef.current = false;

    const handleWindowMove = (we: MouseEvent) => {
      if (!dragStartRef.current || !containerRef.current) return;

      const currentRect = containerRef.current.getBoundingClientRect();
      // Mouse position relative to container, PLUS scroll offset
      const currentX = we.clientX - currentRect.left;
      const currentY = we.clientY - currentRect.top + containerRef.current.scrollTop;

      if (!isDraggingRef.current) {
        const dx = Math.abs(currentX - dragStartRef.current.x);
        const dy = Math.abs(currentY - dragStartRef.current.y);
        if (dx > 5 || dy > 5) {
          isDraggingRef.current = true;
        }
      }

      if (isDraggingRef.current) {
        const x = Math.min(dragStartRef.current.x, currentX);
        const y = Math.min(dragStartRef.current.y, currentY);
        const w = Math.abs(currentX - dragStartRef.current.x);
        const h = Math.abs(currentY - dragStartRef.current.y);

        setDragBox({ x, y, w, h });
      }
    };

    const handleWindowUp = (we: MouseEvent) => {
      window.removeEventListener('mousemove', handleWindowMove);
      window.removeEventListener('mouseup', handleWindowUp);

      if (isDraggingRef.current && dragStartRef.current && onRangeSelectionRef.current) {
        const currentRect = containerRef.current!.getBoundingClientRect();
        // Note: We use the final mouse position logic same as move
        const currentX = we.clientX - currentRect.left;
        const currentY = we.clientY - currentRect.top + containerRef.current!.scrollTop;

        const bx = Math.min(dragStartRef.current.x, currentX);
        const by = Math.min(dragStartRef.current.y, currentY);
        const bw = Math.abs(currentX - dragStartRef.current.x);
        const bh = Math.abs(currentY - dragStartRef.current.y);

        const selectedIndexes: number[] = [];
        const currentPositions = layoutResultRef.current.positions;

        // Optimization: Only check items that could possibly overlap vertically
        currentPositions.forEach((pos, index) => {
          // Vertical bounds check first
          if (pos.top > by + bh || pos.top + pos.height < by) return;

          const overlap = (
            pos.left < bx + bw &&
            pos.left + pos.width > bx &&
            pos.top < by + bh &&
            pos.top + pos.height > by
          );

          if (overlap) selectedIndexes.push(index);
        });

        onRangeSelectionRef.current(selectedIndexes, we.shiftKey);
      } else if (!isDraggingRef.current && onBackgroundClickRef.current) {
        // Check if we clicked background
        // Simple check: did we click strictly in background?
        // Since we handle click on items in GridItem, if we reached here it's likely background
        // BUT we check if we are Over an item just in case bubbling happened weirdly
        // Actually, usually easier to let GridItem handle its own clicks.
        // We'll trust that if target wasn't an item interactive, it's background.
        // However, let's verify if 'target' is the container itself or the 'virtual-track'

        // If the click didn't move much, treat as click
        onBackgroundClickRef.current();
      }

      setDragBox(null);
      dragStartRef.current = null;
      isDraggingRef.current = false;
    };

    window.addEventListener('mousemove', handleWindowMove);
    window.addEventListener('mouseup', handleWindowUp);
  };

  // --- Virtualization Rendering ---
  const visibleItems = [];


  // Use container height if possible, fallback to window
  const visibleHeight = scrollContainerRef.current ? scrollContainerRef.current.clientHeight : (typeof window !== 'undefined' ? window.innerHeight : 1000);
  const buffer = 1500; // Reduced buffer to avoid texture thrashing

  const minVisible = scrollTop - buffer;
  const maxVisible = scrollTop + visibleHeight + buffer;

  // Render Loop Optimization
  // Since positions are generally sorted by 'top' (or close to it in masonry),
  // we can optimize. However, Masonry isn't strictly sorted by index, but it IS roughly sorted.
  // We can't do a strict binary search on 'positions' because index 10 might be above index 9 in masonry.
  // But they are monotonic-ish.
  // For safety and simplicity with performance:
  // iterate, but if we find items significantly below maxVisible, we can STOP if we are sure subsequent items start lower.
  // In our layout engine, items are added in order. In Masonry, an item might be placed higher than previous, 
  // but generally top values increase.
  // Let's stick to full iteration but FAST checks, or finding a start index.

  // Actually, 'positions' array is ordered by Index.
  // In Grid: pos[i].top is non-decreasing.
  // In Masonry: pos[i].top is roughly non-decreasing but can jitter.

  // Optimization: Find start index using binary search approximation or just linear search that breaks?
  // Linear search that breaks is unsafe for Masonry if a small item is placed high up later.
  // BUT, usually Masonry fills top-down. It's very unlikely item 1000 is at top:0 if item 500 is at top:5000.
  // So we can find a safe start index.

  // Let's implement a "Safe Find":
  // Scan blocks of 100? No, let's just iterate all for now but with the simple bound check.
  // JS loops are fast. 10k items is 1ms. 
  // The React.createElement is the slow part.
  // Binary search for the first potentially visible item
  // We look for the first item where (item.top + item.height) > minVisible
  let startIndex = 0;
  let low = 0;
  let high = positions.length - 1;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const pos = positions[mid];

    // If this item ends before our view starts, we need to look higher up the array (later items)
    if (pos.top + pos.height < minVisible) {
      low = mid + 1;
    } else {
      // This item is potentially visible, but maybe there's an earlier one too
      startIndex = mid;
      high = mid - 1;
    }
  }

  const len = positions.length;
  for (let i = startIndex; i < len; i++) {
    const pos = positions[i];
    if (!pos) continue;

    // Fast bounds check
    // Overlap: pos.bottom > minVisible && pos.top < maxVisible
    if ((pos.top + pos.height) > minVisible && (pos.top) < maxVisible) {
      visibleItems.push(
        renderItem(items[i], {
          position: 'absolute',
          top: 0,
          left: 0,
          width: pos.width,
          height: pos.height,
          transform: `translate3d(${pos.left}px, ${pos.top}px, 0)`,
          willChange: 'transform' // Hint to browser to promote layer
        }, i, { x: pos.left, y: pos.top, width: pos.width, height: pos.height })
      );
    }

    // Optimization break: If we are WAY past maxVisible, we can stop.
    // In masonry, it's possible the next item is higher, so we give a generous buffer before breaking.
    // If current item top is > maxVisible + 2000, it's very unlikely a subsequent item is visible.
    if (pos.top > maxVisible + 3000) {
      break;
    }
  }

  return (
    <div
      ref={containerRef}
      style={{
        height: Math.max(100, totalHeight),
        position: 'relative',
        width: '100%',
        minHeight: '100%',
      }}
      className="outline-none"
    >
      {/* Background Selection Layer - Only catches clicks on empty space */}
      <div
        onMouseDown={handleMouseDown}
        className="absolute inset-0 z-0 bg-transparent"
      />

      {visibleItems}

      {dragBox && (
        <div
          className="absolute bg-accent-500/20 border border-accent-500 z-50 pointer-events-none"
          style={{
            left: dragBox.x,
            top: dragBox.y,
            width: dragBox.w,
            height: dragBox.h
          }}
        />
      )}
    </div>
  );
};

export const VirtualGrid = forwardRef(VirtualGridInternal) as <T>(
  props: VirtualGridProps<T> & { ref?: React.Ref<VirtualGridHandle> }
) => React.ReactElement;