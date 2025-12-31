import React from 'react';
import { MaintenanceTab } from '../../../hooks/useMaintenanceData';

interface MaintenanceHeaderProps {
    title: string;
    description: string;
    icon: React.ReactNode;
    count?: number;
    selectedCount?: number;
    actions?: React.ReactNode;
    extraControls?: React.ReactNode;
    onSelectAll?: () => void;
    onClearSelection?: () => void;
    variant?: 'sage' | 'blue' | 'orange' | 'red';
}

export const MaintenanceHeader: React.FC<MaintenanceHeaderProps> = ({
    title,
    description,
    icon,
    count = 0,
    selectedCount = 0,
    actions,
    extraControls,
    onSelectAll,
    onClearSelection,
    variant = 'sage'
}) => {
    const bgColors = {
        sage: 'bg-sage-500/10 text-sage-600 dark:text-sage-400',
        blue: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
        orange: 'bg-orange-500/10 text-orange-600 dark:text-orange-400',
        red: 'bg-red-500/10 text-red-600 dark:text-red-400'
    };

    const textColor = bgColors[variant];

    return (
        <div className="flex-shrink-0 px-6 py-2 z-10">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-4 bg-white/50 dark:bg-zinc-900/50 backdrop-blur-md rounded-2xl border border-gray-100 dark:border-white/5">
                <div className="flex items-center gap-4">
                    <div className={`p-3 rounded-xl ${textColor}`}>
                        {icon}
                    </div>
                    <div>
                        <div className="flex items-center gap-2">
                            <h3 className="text-lg font-bold text-gray-900 dark:text-white">{title}</h3>
                            <span className="px-2 py-0.5 bg-gray-100 dark:bg-zinc-800 rounded-md text-xs font-bold text-gray-500">
                                {count.toLocaleString()}
                            </span>
                        </div>
                        <p className="text-xs text-gray-500 dark:text-gray-400 max-w-lg">{description}</p>
                    </div>
                </div>

                <div className="flex items-center gap-4">
                    {extraControls}

                    {/* Selection Controls */}
                    {onSelectAll && (
                        <div className="flex items-center gap-2">
                            {selectedCount > 0 ? (
                                <button
                                    onClick={onClearSelection}
                                    className="text-xs font-bold text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                                >
                                    Deselect All
                                </button>
                            ) : (
                                <button
                                    onClick={onSelectAll}
                                    className="text-xs font-bold text-sage-600 hover:text-sage-500"
                                >
                                    Select All
                                </button>
                            )}
                        </div>
                    )}

                    {actions}
                </div>
            </div>
        </div>
    );
};
