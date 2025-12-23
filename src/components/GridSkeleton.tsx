import * as React from 'react';

export const GridSkeleton: React.FC = () => {
    // Generate a fixed number of skeleton items
    const items = Array.from({ length: 24 });

    return (
        <div className="p-6 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-4 animate-in fade-in duration-300">
            {items.map((_, i) => (
                <div
                    key={i}
                    className="aspect-square rounded-xl bg-gray-200 dark:bg-white/5 animate-pulse overflow-hidden relative"
                    style={{ animationDelay: `${i * 50}ms` }}
                >
                    <div className="absolute inset-0 bg-gradient-to-tr from-transparent via-white/10 to-transparent -translate-x-full animate-shimmer" />
                </div>
            ))}
        </div>
    );
};
