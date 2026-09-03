import * as React from 'react';
import { ChevronDown, type LucideIcon } from 'lucide-react';

interface MetadataDisclosureSectionProps {
    title: string;
    icon: LucideIcon;
    children: React.ReactNode;
    expanded?: boolean;
    onExpandedChange?: (expanded: boolean) => void;
    count?: number;
    trailing?: React.ReactNode;
    iconClassName?: string;
    className?: string;
    contentClassName?: string;
}

export const MetadataDisclosureSection: React.FC<MetadataDisclosureSectionProps> = ({
    title,
    icon: Icon,
    children,
    expanded,
    onExpandedChange,
    count,
    trailing,
    iconClassName = 'text-gray-500 dark:text-zinc-500',
    className = '',
    contentClassName = 'mt-2',
}) => {
    const [internalExpanded, setInternalExpanded] = React.useState(true);
    const isExpanded = expanded ?? internalExpanded;
    const headingId = React.useId();
    const contentId = React.useId();

    const setExpanded = (next: boolean) => {
        if (expanded === undefined) setInternalExpanded(next);
        onExpandedChange?.(next);
    };

    return (
        <section className={className}>
            <div className="flex items-center justify-between gap-2">
                <h3 id={headingId} className="min-w-0 flex-1">
                    <button
                        type="button"
                        aria-expanded={isExpanded}
                        aria-controls={contentId}
                        onClick={() => setExpanded(!isExpanded)}
                        className="flex w-full min-w-0 items-center gap-2 rounded px-2 py-1.5 text-left text-xs font-bold uppercase tracking-wider text-gray-500 outline-none transition-colors hover:bg-gray-100 hover:text-gray-700 focus-visible:ring-2 focus-visible:ring-sage-500/70 dark:text-zinc-400 dark:hover:bg-white/[0.04] dark:hover:text-zinc-200"
                    >
                        <Icon aria-hidden="true" className={`h-3.5 w-3.5 shrink-0 ${iconClassName}`} />
                        <span className="truncate">{title}</span>
                        {count !== undefined ? <span aria-hidden="true" className="text-[10px] font-medium text-gray-400 dark:text-zinc-600">{count}</span> : null}
                        <ChevronDown aria-hidden="true" className={`h-3.5 w-3.5 shrink-0 transition-transform motion-reduce:transition-none ${isExpanded ? '' : '-rotate-90'}`} />
                    </button>
                </h3>
                {trailing ? <div className="flex shrink-0 items-center gap-2">{trailing}</div> : null}
            </div>
            {isExpanded ? (
                <div id={contentId} className={contentClassName}>
                    {children}
                </div>
            ) : null}
        </section>
    );
};
