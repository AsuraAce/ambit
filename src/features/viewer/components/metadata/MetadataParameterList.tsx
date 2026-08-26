import * as React from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { MetadataSourceBadge } from './MetadataSourceBadge';
import { MetadataDisclosureSection } from './MetadataDisclosureSection';

export interface MetadataParameterRow {
    label: string;
    value: string;
    source?: string;
    modified?: boolean;
    optional?: boolean;
}

interface MetadataParameterListProps {
    rows: readonly MetadataParameterRow[];
    ariaLabel?: string;
    headerAction?: React.ReactNode;
    expanded?: boolean;
    onExpandedChange?: (expanded: boolean) => void;
}

export const MetadataParameterList: React.FC<MetadataParameterListProps> = ({
    rows,
    ariaLabel = 'Generation parameters',
    headerAction,
    expanded,
    onExpandedChange,
}) => {
    const visibleRows = rows.filter(row => !row.optional || (row.value && row.value !== 'Unknown'));
    if (visibleRows.length === 0) return null;

    const parameterList = <dl aria-label={ariaLabel} className="space-y-2 bg-gray-50 p-3 text-xs dark:bg-black">
            {visibleRows.map(row => (
                <div
                    key={row.label}
                    className={`grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-x-3 rounded px-1 py-0.5 ${row.modified ? 'bg-ember-500/5' : ''}`}
                >
                    <dt className={row.modified ? 'text-ember-600 dark:text-ember-300' : 'text-gray-500 dark:text-zinc-500'}>{row.label}</dt>
                    <dd className="break-words text-gray-700 dark:text-zinc-200">{row.value || 'Unknown'}</dd>
                    <dd className="justify-self-end">
                        <MetadataSourceBadge source={row.modified ? 'user_override' : row.source} />
                    </dd>
                </div>
            ))}
        </dl>;

    return (
        <MetadataDisclosureSection
            title={ariaLabel}
            icon={SlidersHorizontal}
            trailing={headerAction}
            expanded={expanded}
            onExpandedChange={onExpandedChange}
        >
            <div className="overflow-hidden rounded-lg border border-gray-200 bg-gray-50 dark:border-white/10 dark:bg-black">
                {parameterList}
            </div>
        </MetadataDisclosureSection>
    );
};
