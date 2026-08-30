import * as React from 'react';
import type { LucideIcon } from 'lucide-react';

interface MetadataSectionHeaderProps {
    title: string;
    icon: LucideIcon;
    trailing?: React.ReactNode;
    modified?: boolean;
    iconClassName?: string;
    headingId?: string;
    labelFor?: string;
    className?: string;
}

export const MetadataSectionHeader: React.FC<MetadataSectionHeaderProps> = ({
    title,
    icon: Icon,
    trailing,
    modified = false,
    iconClassName = 'text-gray-500 dark:text-zinc-500',
    headingId,
    labelFor,
    className = '',
}) => {
    const textClassName = `whitespace-nowrap text-xs font-bold uppercase tracking-wider ${modified ? 'text-ember-600 dark:text-ember-300' : 'text-gray-500 dark:text-zinc-400'}`;
    const resolvedIconClassName = modified ? 'text-ember-600 dark:text-ember-300' : iconClassName;
    const content = (
        <>
            <Icon aria-hidden="true" className={`h-3.5 w-3.5 shrink-0 ${resolvedIconClassName}`} />
            {labelFor ? (
                <label htmlFor={labelFor} className={textClassName}>{title}</label>
            ) : (
                <h3 id={headingId} className={textClassName}>{title}</h3>
            )}
        </>
    );

    return (
        <div className={`flex items-center justify-between gap-2 ${className}`}>
            <div className="flex shrink-0 items-center gap-2">{content}</div>
            {trailing ? <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">{trailing}</div> : null}
        </div>
    );
};
