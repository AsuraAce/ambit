import React from 'react';
import { Eraser } from 'lucide-react';
import { MaintenanceTab } from '../../../hooks/useMaintenanceData';

interface MaintenanceTabDefinition {
    id: MaintenanceTab;
    label: string;
    color: string;
}

export const MAINTENANCE_TABS: readonly MaintenanceTabDefinition[] = [
    { id: 'missing', label: 'Missing', color: 'text-orange-500' },
    { id: 'thumbnails', label: 'Thumbnails', color: 'text-blue-500' },
    { id: 'duplicates', label: 'Duplicates', color: 'text-sage-600 dark:text-sage-400' },
    { id: 'untagged', label: 'Untagged', color: 'text-amber-500' },
    { id: 'intermediates', label: 'Intermediates', color: 'text-blue-500' },
    { id: 'trash', label: 'Removed', color: 'text-red-500' },
];

interface MaintenanceTabsProps {
    activeTab: MaintenanceTab;
    onTabChange: (tab: MaintenanceTab) => void;
    intermediatesCount?: number;
}

export const MaintenanceTabs: React.FC<MaintenanceTabsProps> = ({ activeTab, onTabChange, intermediatesCount = 0 }) => {
    const tabRefs = React.useRef<Partial<Record<MaintenanceTab, HTMLButtonElement | null>>>({});

    // Hide Intermediates tab if there are no intermediate images
    const tabs = MAINTENANCE_TABS.filter(tab =>
        tab.id !== 'intermediates' || intermediatesCount > 0 || activeTab === 'intermediates'
    );

    const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, tab: MaintenanceTab) => {
        const currentIndex = tabs.findIndex(candidate => candidate.id === tab);
        if (currentIndex === -1) return;

        let nextIndex: number | null = null;
        if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % tabs.length;
        else if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
        else if (event.key === 'Home') nextIndex = 0;
        else if (event.key === 'End') nextIndex = tabs.length - 1;

        if (nextIndex === null) return;
        event.preventDefault();

        const nextTab = tabs[nextIndex];
        if (!nextTab) return;
        onTabChange(nextTab.id);
        tabRefs.current[nextTab.id]?.focus();
    };

    return (
        <div className="flex-shrink-0 pt-4 pl-6 pr-8 pb-4 z-20">
            <div className="flex flex-col 2xl:flex-row 2xl:items-center justify-between gap-4 p-4 bg-white/80 dark:bg-zinc-900/80 backdrop-blur-xl border border-gray-200 dark:border-white/10 rounded-2xl shadow-lg">
                <div className="shrink-0">
                    <div className="flex items-center gap-3 mb-1">
                        <div className="p-2 bg-sage-100 dark:bg-sage-900/30 rounded-lg text-sage-600 dark:text-sage-400">
                            <Eraser className="w-5 h-5" />
                        </div>
                        <h2 className="text-xl font-bold text-gray-900 dark:text-white">Gallery Maintenance</h2>
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400 pl-1">Organize your library, resolve conflicts, and manage removed items.</p>
                </div>

                <div
                    role="tablist"
                    aria-label="Maintenance sections"
                    className="grid w-full grid-cols-[repeat(auto-fit,minmax(7.5rem,1fr))] items-center gap-1 self-stretch rounded-xl bg-gray-100 p-1 shadow-inner dark:bg-zinc-800 2xl:flex-1"
                >
                    {tabs.map((tab) => (
                        <button
                            key={tab.id}
                            ref={element => { tabRefs.current[tab.id] = element; }}
                            id={`maintenance-tab-${tab.id}`}
                            type="button"
                            role="tab"
                            aria-selected={activeTab === tab.id}
                            aria-controls={`maintenance-panel-${tab.id}`}
                            tabIndex={activeTab === tab.id ? 0 : -1}
                            onClick={() => {
                                if (activeTab !== tab.id) onTabChange(tab.id);
                            }}
                            onKeyDown={(event) => handleKeyDown(event, tab.id)}
                            className={`flex min-w-0 items-center justify-center gap-2 whitespace-nowrap rounded-lg px-3 py-2.5 text-sm font-black transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sage-500 focus-visible:ring-offset-1 dark:focus-visible:ring-offset-zinc-800 ${activeTab === tab.id
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
