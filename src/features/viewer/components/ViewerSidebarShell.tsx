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
        <aside className="flex h-full w-[420px] shrink-0 flex-col border-l border-white/10 bg-zinc-950 text-white shadow-2xl">
            <div className="shrink-0 border-b border-white/10 p-5">
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
