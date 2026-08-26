import * as React from 'react';
import { ViewerTabs, type ViewerTabDefinition } from './ViewerTabs';

interface ViewerSidebarShellProps<T extends string> {
    tabs: readonly ViewerTabDefinition<T>[];
    activeTab: T;
    onTabChange: (tab: T) => void;
    ariaLabel: string;
    children: React.ReactNode;
}

export function ViewerSidebarShell<T extends string>({
    tabs,
    activeTab,
    onTabChange,
    ariaLabel,
    children,
}: ViewerSidebarShellProps<T>) {
    return (
        <aside className="flex h-full w-[420px] shrink-0 flex-col border-l border-gray-200 bg-white text-gray-900 shadow-2xl dark:border-white/10 dark:bg-zinc-950 dark:text-white">
            <div className="shrink-0 border-b border-gray-200 p-5 dark:border-white/10">
                <ViewerTabs
                    tabs={tabs}
                    activeTab={activeTab}
                    onTabChange={onTabChange}
                    ariaLabel={ariaLabel}
                />
            </div>
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{children}</div>
        </aside>
    );
}
