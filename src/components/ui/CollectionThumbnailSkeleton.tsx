import * as React from 'react';

interface CollectionThumbnailSkeletonProps {
    className?: string;
}

export const CollectionThumbnailSkeleton: React.FC<CollectionThumbnailSkeletonProps> = ({
    className = ''
}) => (
    <div
        aria-label="Collection thumbnail loading"
        data-testid="collection-thumbnail-skeleton"
        className={`relative overflow-hidden bg-gray-200 dark:bg-white/10 border border-gray-200 dark:border-white/5 ${className}`}
    >
        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/40 dark:via-white/10 to-transparent -translate-x-full animate-shimmer" />
    </div>
);
