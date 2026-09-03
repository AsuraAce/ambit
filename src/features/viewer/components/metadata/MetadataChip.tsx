import * as React from 'react';

interface MetadataChipProps {
    children: React.ReactNode;
    onClick?: () => void;
    className?: string;
}

const CHIP_CLASS_NAME = 'group flex max-w-full items-center overflow-hidden rounded-lg border border-gray-200 bg-gray-100 transition-all dark:border-white/10 dark:bg-white/5';

export const MetadataChip: React.FC<MetadataChipProps> = ({ children, onClick, className = '' }) => {
    const classes = `${CHIP_CLASS_NAME} ${onClick ? 'hover:border-sage-500/30 hover:bg-gray-200 dark:hover:bg-white/10' : ''} ${className}`;
    return onClick ? (
        <button type="button" onClick={onClick} className={classes}>{children}</button>
    ) : (
        <span className={classes}>{children}</span>
    );
};
