import * as React from 'react';

export interface ViewerTabDefinition<T extends string> {
    id: T;
    label: string;
}

interface ViewerTabsProps<T extends string> {
    tabs: readonly ViewerTabDefinition<T>[];
    activeTab: T;
    onTabChange: (tab: T) => void;
    ariaLabel: string;
    className?: string;
}

export function ViewerTabs<T extends string>({
    tabs,
    activeTab,
    onTabChange,
    ariaLabel,
    className = '',
}: ViewerTabsProps<T>) {
    const tabRefs = React.useRef<Array<HTMLButtonElement | null>>([]);

    const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
        let nextIndex: number | null = null;
        if (event.key === 'ArrowRight') nextIndex = (index + 1) % tabs.length;
        else if (event.key === 'ArrowLeft') nextIndex = (index - 1 + tabs.length) % tabs.length;
        else if (event.key === 'Home') nextIndex = 0;
        else if (event.key === 'End') nextIndex = tabs.length - 1;

        if (nextIndex === null) return;
        event.preventDefault();
        event.stopPropagation();

        const nextTab = tabs[nextIndex];
        if (!nextTab) return;
        onTabChange(nextTab.id);
        tabRefs.current[nextIndex]?.focus();
    };

    return (
        <div
            role="tablist"
            aria-label={ariaLabel}
            className={`flex gap-1 rounded-lg bg-black p-1 ${className}`}
        >
            {tabs.map((tab, index) => {
                const isActive = activeTab === tab.id;
                return (
                    <button
                        key={tab.id}
                        ref={element => { tabRefs.current[index] = element; }}
                        type="button"
                        role="tab"
                        aria-selected={isActive}
                        tabIndex={isActive ? 0 : -1}
                        onClick={() => {
                            if (!isActive) onTabChange(tab.id);
                        }}
                        onKeyDown={event => handleKeyDown(event, index)}
                        className={`flex-1 rounded-md px-2 py-2 text-xs font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sage-500 ${isActive
                            ? 'bg-sage-600 text-white shadow-lg shadow-sage-500/20'
                            : 'text-zinc-400 hover:bg-white/10 hover:text-zinc-200'
                            }`}
                    >
                        {tab.label}
                    </button>
                );
            })}
        </div>
    );
}
