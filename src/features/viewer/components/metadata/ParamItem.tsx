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
        <div className={`relative bg-white dark:bg-zinc-800/50 p-3 rounded-xl ${fullWidth ? 'col-span-2' : ''} border transition-colors group ${isModified ? 'border-ember-300 bg-ember-50/70 dark:border-ember-500/30 dark:bg-ember-500/10' : 'border-gray-200 dark:border-white/5 hover:border-gray-300 dark:hover:border-white/10'}`}>
            <div className="flex items-center justify-between mb-1">
                <div className={`text-[10px] uppercase font-bold tracking-wider ${isModified ? 'text-ember-600 dark:text-ember-300' : 'text-gray-400 dark:text-zinc-500'}`}>{label}</div>
                {isModified && <div className="w-1.5 h-1.5 rounded-full bg-ember-500" title="Modified from original" />}
            </div>
            <div className="text-sm text-gray-700 dark:text-gray-300 truncate font-mono" title={value}>{value}</div>
        </div>
    );
};
