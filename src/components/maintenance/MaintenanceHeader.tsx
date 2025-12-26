import * as React from 'react';
import { CheckSquare, XSquare, Zap } from 'lucide-react';

interface MaintenanceHeaderProps {
    title: string;
    description: string;
    icon: React.ReactNode;
    count: number;
    totalCount?: number;
    onSelectAll?: () => void;
    onClearSelection?: () => void;
    selectedCount?: number;
    onRefresh?: () => void;
    actions?: React.ReactNode;
    extraControls?: React.ReactNode;
    variant?: 'blue' | 'sage' | 'orange' | 'red';
}

export const MaintenanceHeader: React.FC<MaintenanceHeaderProps> = ({
    title,
    description,
    icon,
    count,
    totalCount,
    onSelectAll,
    onClearSelection,
    selectedCount = 0,
    onRefresh,
    actions,
    extraControls,
    variant = 'blue'
}) => {
    const colorClasses = {
        blue: 'bg-blue-50/30 dark:bg-blue-900/10 border-blue-200/50 dark:border-blue-800/30 text-blue-600 dark:text-blue-400',
        sage: 'bg-sage-50/30 dark:bg-sage-900/10 border-sage-200/50 dark:border-sage-800/30 text-sage-600 dark:text-sage-400',
        orange: 'bg-orange-50/30 dark:bg-orange-900/10 border-orange-200/50 dark:border-orange-800/30 text-orange-600 dark:text-orange-400',
        red: 'bg-red-50/30 dark:bg-red-900/10 border-red-200/50 dark:border-red-800/30 text-red-600 dark:text-red-400',
    };

    const variantClass = colorClasses[variant];
    const iconBaseClass = variant === 'blue' ? 'text-blue-600 dark:text-blue-400' :
        variant === 'sage' ? 'text-sage-600 dark:text-sage-400' :
            variant === 'orange' ? 'text-orange-600 dark:text-orange-400' :
                'text-red-600 dark:text-red-400';

    return (
        <div className={`mb-6 p-4 border rounded-2xl flex flex-col lg:flex-row items-center justify-between gap-6 shadow-sm shrink-0 ${variantClass}`}>
            <div className="flex items-center gap-4 flex-1">
                <div className="p-3 bg-white dark:bg-black/20 rounded-xl shadow-sm border border-current opacity-50 relative">
                    <div className={iconBaseClass}>{icon}</div>
                    {count > 0 && (
                        <div className="absolute -top-1 -right-1 w-3 h-3 bg-current rounded-full border-2 border-white dark:border-slate-900 shadow-sm" />
                    )}
                </div>
                <div>
                    <div className="flex items-center gap-2">
                        <h3 className="text-sm font-bold text-gray-800 dark:text-gray-200">{title}</h3>
                        {totalCount !== undefined && (
                            <span className="px-1.5 py-0.5 bg-black/5 dark:bg-white/5 rounded text-[9px] font-bold uppercase tracking-tighter">
                                {count} / {totalCount}
                            </span>
                        )}
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                        {description}
                    </p>
                </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
                {extraControls}

                {onRefresh && (
                    <button
                        onClick={onRefresh}
                        className="p-2.5 text-gray-500 hover:text-current hover:bg-white dark:hover:bg-zinc-800 rounded-xl transition-all border border-transparent hover:border-current"
                        title="Refresh results"
                    >
                        <Zap className="w-4 h-4" />
                    </button>
                )}

                {(onSelectAll || onClearSelection) && (
                    <div className="h-8 w-[1px] bg-gray-200 dark:bg-white/5 mx-1" />
                )}

                {count > 0 && (
                    <div className="flex items-center gap-2">
                        {onSelectAll && (
                            <button onClick={onSelectAll} className="text-xs font-bold text-gray-500 hover:text-gray-900 dark:hover:text-white flex items-center gap-1 px-3 py-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-white/5 transition-colors">
                                <CheckSquare className="w-4 h-4" /> Select All
                            </button>
                        )}
                        {selectedCount > 0 && onClearSelection && (
                            <button onClick={onClearSelection} className="text-xs font-bold text-gray-500 hover:text-gray-900 dark:hover:text-white flex items-center gap-1 px-3 py-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-white/5 transition-colors">
                                <XSquare className="w-4 h-4" /> Clear
                            </button>
                        )}
                    </div>
                )}

                {actions}
            </div>
        </div>
    );
};
