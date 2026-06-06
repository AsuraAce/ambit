import React from 'react';
import { Eraser } from 'lucide-react';
import { MaintenanceTab } from '../../../hooks/useMaintenanceData';

interface MaintenanceTabsProps {
    activeTab: MaintenanceTab;
    onTabChange: (tab: MaintenanceTab) => void;
    intermediatesCount?: number;
}

export const MaintenanceTabs: React.FC<MaintenanceTabsProps> = ({ activeTab, onTabChange, intermediatesCount = 0 }) => {
    const allTabs = [
        { id: 'missing', label: 'Missing', color: 'text-orange-500' },
        { id: 'thumbnails', label: 'Thumbnails', color: 'text-blue-500' },
        { id: 'duplicates', label: 'Duplicates', color: 'text-sage-600 dark:text-sage-400' },
        { id: 'untagged', label: 'Untagged', color: 'text-amber-500' },
        { id: 'intermediates', label: 'Intermediates', color: 'text-blue-500' },
        { id: 'trash', label: 'Removed', color: 'text-red-500' },
    ];

    // Hide Intermediates tab if there are no intermediate images
    const tabs = allTabs.filter(tab =>
        tab.id !== 'intermediates' || intermediatesCount > 0
    );

    return (
        <div className="flex-shrink-0 pt-4 pl-6 pr-8 pb-4 z-20">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-4 bg-white/80 dark:bg-zinc-900/80 backdrop-blur-xl border border-gray-200 dark:border-white/10 rounded-2xl shadow-lg">
                <div>
                    <div className="flex items-center gap-3 mb-1">
                        <div className="p-2 bg-sage-100 dark:bg-sage-900/30 rounded-lg text-sage-600 dark:text-sage-400">
                            <Eraser className="w-5 h-5" />
                        </div>
                        <h2 className="text-xl font-bold text-gray-900 dark:text-white">Gallery Maintenance</h2>
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400 pl-1">Organize your library, resolve conflicts, and manage removed items.</p>
                </div>

                <div className="bg-gray-100 dark:bg-zinc-800 p-1 rounded-xl flex items-center shadow-inner self-start md:self-auto overflow-x-auto max-w-full">
                    {tabs.map((tab) => (
                        <button
                            key={tab.id}
                            onClick={() => onTabChange(tab.id as MaintenanceTab)}
                            className={`flex items-center gap-2 px-6 py-2.5 rounded-lg text-sm font-black transition-all whitespace-nowrap ${activeTab === tab.id
                                ? 'bg-white dark:bg-zinc-700 text-sage-600 shadow-md transform scale-105 z-10'
                                : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-200'
                                }`}
                        >
                            <span className={activeTab === tab.id ? tab.color : 'text-current'}>{tab.label}</span>
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
};
