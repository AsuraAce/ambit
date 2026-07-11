import { LayoutMode } from '../types';

export interface LayoutConfig<T> {
  items: T[];
  layoutMode: LayoutMode;
  containerWidth: number;
  minItemWidth: number;
  gap: number;
  padding: number;
  getItemRatio: (item: T) => number;
}

export interface ItemPosition {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface LayoutResult {
  positions: ItemPosition[];
  totalHeight: number;
  columns: number;
  rowHeight: number;
}

/**
 * Pure function to calculate layout positions.
 * Can be easily moved to a Web Worker in the future.
 */
export const calculateLayout = <T>(config: LayoutConfig<T>): LayoutResult => {
  const { 
    items, 
    layoutMode, 
    containerWidth, 
    minItemWidth, 
    gap, 
    padding, 
    getItemRatio 
  } = config;

  // We need effective width to calculate columns
  // Subtract padding (left + right)
  const effectiveWidth = containerWidth - (padding * 2);
  
  if (effectiveWidth <= 0 || items.length === 0) {
    return { positions: [], totalHeight: 0, columns: 1, rowHeight: 0 };
  }

  const positions: ItemPosition[] = [];
  let finalHeight = 0;
  let metaCols = 1;
  let metaRowHeight = minItemWidth;

  // --- GRID ---
  if (layoutMode === 'grid') {
    const cols = Math.max(1, Math.floor((effectiveWidth + gap) / (minItemWidth + gap)));
    const itemWidth = Math.floor((effectiveWidth - (cols - 1) * gap) / cols);
    const itemHeight = itemWidth; // Square grid
    
    items.forEach((_, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      positions.push({
        left: padding + col * (itemWidth + gap),
        top: padding + row * (itemHeight + gap),
        width: itemWidth,
        height: itemHeight
      });
    });
    
    const totalRows = Math.ceil(items.length / cols);
    finalHeight = totalRows * (itemHeight + gap);
    metaCols = cols;
    metaRowHeight = itemHeight;
  }
  // --- MASONRY ---
  else if (layoutMode === 'masonry') {
    const cols = Math.max(1, Math.floor((effectiveWidth + gap) / (minItemWidth + gap)));
    const itemWidth = Math.floor((effectiveWidth - (cols - 1) * gap) / cols);
    const colHeights = new Array(cols).fill(padding); // Start at padding-top
    
    items.forEach(item => {
      // Find shortest column
      let minH = colHeights[0];
      let colIdx = 0;
      for (let i = 1; i < cols; i++) {
        if (colHeights[i] < minH) {
          minH = colHeights[i];
          colIdx = i;
        }
      }
      
      const ratio = getItemRatio(item);
      const safeRatio = Math.max(0.5, Math.min(2, ratio));
      const height = Math.floor(itemWidth / safeRatio);

      positions.push({
        left: padding + colIdx * (itemWidth + gap),
        top: minH,
        width: itemWidth,
        height: height
      });
      
      colHeights[colIdx] += height + gap;
    });

    finalHeight = Math.max(...colHeights);
    metaCols = cols;
    metaRowHeight = itemWidth;
  }
  // --- JUSTIFIED ---
  else {
    const targetRowHeight = minItemWidth * 1.2; 
    let currentRow: { index: number, ratio: number }[] = [];
    let currentWidth = 0;
    let yOffset = padding;

    items.forEach((item, i) => {
      const ratio = getItemRatio(item);
      const safeRatio = Math.max(0.5, Math.min(2.5, ratio)); 
      const itemWidth = targetRowHeight * safeRatio;
      
      currentRow.push({ index: i, ratio: safeRatio });
      currentWidth += itemWidth;

      const rowGaps = (currentRow.length - 1) * gap;
      if (currentWidth + rowGaps > effectiveWidth) {
        // Balance row
        const totalRatio = currentRow.reduce((acc, curr) => acc + curr.ratio, 0);
        const availableWidth = effectiveWidth - rowGaps;
        const actualHeight = availableWidth / totalRatio;

        let xOffset = padding;
        currentRow.forEach(({ index, ratio }) => {
          const w = actualHeight * ratio;
          positions[index] = { top: yOffset, left: xOffset, width: w, height: actualHeight };
          xOffset += w + gap;
        });

        yOffset += actualHeight + gap;
        currentRow = [];
        currentWidth = 0;
      }
    });

    // Last row (don't expand)
    if (currentRow.length > 0) {
      let xOffset = padding;
      currentRow.forEach(({ index, ratio }) => {
        const w = targetRowHeight * ratio;
        positions[index] = { top: yOffset, left: xOffset, width: w, height: targetRowHeight };
        xOffset += w + gap;
      });
      yOffset += targetRowHeight + gap;
    }
    finalHeight = yOffset;
    metaCols = Math.floor(effectiveWidth / minItemWidth); 
    metaRowHeight = targetRowHeight;
  }

  // Add bottom padding
  finalHeight += padding;

  return { positions, totalHeight: finalHeight, columns: metaCols, rowHeight: metaRowHeight };
};
