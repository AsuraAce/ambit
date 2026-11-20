import * as React from 'react';
import { LayoutMode } from '../../../types';

interface GridSkeletonProps {
    layout?: LayoutMode;
}

interface SkeletonSize {
    height?: string;
    width?: string;
    flexGrow?: number;
}

const SKELETON_ITEM_COUNT = 24;

const generateSizes = (layout: 'masonry' | 'justified'): SkeletonSize[] =>
    Array.from({ length: SKELETON_ITEM_COUNT }, () =>
        layout === 'masonry'
            ? // Random height between 200px and 400px for masonry
              { height: Math.floor(Math.random() * 200) + 200 + 'px' }
            : // Random width for flex rows
              { width: Math.floor(Math.random() * 200) + 200 + 'px', flexGrow: Math.random() + 0.5 }
    );

export const GridSkeleton: React.FC<GridSkeletonProps> = ({ layout = 'masonry' }) => {
    // Generate a fixed number of skeleton items
    const items = Array.from({ length: SKELETON_ITEM_COUNT });

    // Randomize once per mount so sizes do not flicker on re-renders. Grid uses aspect-square.
    const [sizesByLayout] = React.useState(() => ({
        masonry: generateSizes('masonry'),
        justified: generateSizes('justified'),
    }));
    const randomSizes: SkeletonSize[] = layout === 'masonry' || layout === 'justified' ? sizesByLayout[layout] : [];

    if (layout === 'masonry') {
        return (
            <div className="p-6 columns-2 md:columns-3 lg:columns-4 xl:columns-5 2xl:columns-6 gap-4 space-y-4 animate-in fade-in duration-300 block">
                {items.map((_, i) => (
                    <div
                        key={i}
                        className="w-full rounded-xl bg-gray-200 dark:bg-white/5 overflow-hidden relative break-inside-avoid"
                        style={{
                            height: randomSizes[i].height,
                            animation: `pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite`,
                            animationDelay: `${i * 50}ms`,
                        }}
                    >
                        <div className="absolute inset-0 bg-gradient-to-tr from-transparent via-white/10 to-transparent -translate-x-full animate-shimmer" />
                    </div>
                ))}
            </div>
        );
    }

    if (layout === 'justified') {
        return (
            <div className="p-6 flex flex-wrap gap-4 animate-in fade-in duration-300">
                {items.map((_, i) => (
                    <div
                        key={i}
                        className="h-64 rounded-xl bg-gray-200 dark:bg-white/5 overflow-hidden relative"
                        style={{
                            width: randomSizes[i].width,
                            flexGrow: randomSizes[i].flexGrow,
                            animation: `pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite`,
                            animationDelay: `${i * 50}ms`,
                        }}
                    >
                        <div className="absolute inset-0 bg-gradient-to-tr from-transparent via-white/10 to-transparent -translate-x-full animate-shimmer" />
                    </div>
                ))}
            </div>
        );
    }

    // Default: Grid
    return (
        <div className="p-6 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-4 animate-in fade-in duration-300">
            {items.map((_, i) => (
                <div
                    key={i}
                    className="aspect-square rounded-xl bg-gray-200 dark:bg-white/5 overflow-hidden relative"
                    style={{
                        animation: `pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite`,
                        animationDelay: `${i * 50}ms`,
                    }}
                >
                    <div className="absolute inset-0 bg-gradient-to-tr from-transparent via-white/10 to-transparent -translate-x-full animate-shimmer" />
                </div>
            ))}
        </div>
    );
};
