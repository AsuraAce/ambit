import React from 'react';

interface ParamItemProps {
    label: string;
    value: string;
    fullWidth?: boolean;
    isModified?: boolean;
    allowZero?: boolean;
    showUnknown?: boolean;
}

export const ParamItem = ({
    label,
    value,
    fullWidth = false,
    isModified = false,
    allowZero = false,
    showUnknown = false
}: ParamItemProps) => {
    if (!value || (!allowZero && value === '0') || (!showUnknown && value === 'Unknown')) return null;

    return (
        <div className={`relative bg-white dark:bg-zinc-800/50 p-3 rounded-xl ${fullWidth ? 'col-span-2' : ''} border transition-colors group ${isModified ? 'border-amber-500/30 dark:border-amber-500/30 bg-amber-50/50 dark:bg-amber-900/10' : 'border-gray-200 dark:border-white/5 hover:border-gray-300 dark:hover:border-white/10'}`}>
            <div className="flex items-center justify-between mb-1">
                <div className={`text-[10px] uppercase font-bold tracking-wider ${isModified ? 'text-amber-600 dark:text-amber-500' : 'text-gray-400 dark:text-zinc-500'}`}>{label}</div>
                {isModified && <div className="w-1.5 h-1.5 rounded-full bg-amber-500" title="Modified from original" />}
            </div>
            <div className="text-sm text-gray-700 dark:text-gray-300 truncate font-mono" title={value}>{value}</div>
        </div>
    );
};
