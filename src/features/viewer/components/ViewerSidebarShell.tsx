import * as React from 'react';
import { ViewerTabs, type ViewerTabDefinition } from './ViewerTabs';

interface ViewerSidebarShellProps<T extends string> {
    mediaLabel: 'Image' | 'Video';
    tabs: readonly ViewerTabDefinition<T>[];
    activeTab: T;
    onTabChange: (tab: T) => void;
    ariaLabel: string;
    children: React.ReactNode;
}

export function ViewerSidebarShell<T extends string>({
    mediaLabel,
    tabs,
    activeTab,
    onTabChange,
    ariaLabel,
    children,
}: ViewerSidebarShellProps<T>) {
    return (
        <aside className="flex h-full w-[420px] shrink-0 flex-col border-l border-white/10 bg-zinc-950 text-white shadow-2xl">
            <div className="shrink-0 border-b border-white/10 p-5">
                <h2 className="text-lg font-bold">{mediaLabel}</h2>
                <ViewerTabs
                    tabs={tabs}
                    activeTab={activeTab}
                    onTabChange={onTabChange}
                    ariaLabel={ariaLabel}
                    className="mt-4"
                />
            </div>
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{children}</div>
        </aside>
    );
}
