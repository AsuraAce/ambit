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

    const parameterList = <dl aria-label={ariaLabel} className="space-y-2 bg-black p-3 text-xs">
            {visibleRows.map(row => (
                <div
                    key={row.label}
                    className={`grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-x-3 rounded px-1 py-0.5 ${row.modified ? 'bg-amber-400/5' : ''}`}
                >
                    <dt className={row.modified ? 'text-amber-400/80' : 'text-zinc-500'}>{row.label}</dt>
                    <dd className="break-words text-zinc-200">{row.value || 'Unknown'}</dd>
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
            <div className="overflow-hidden rounded-lg border border-white/10 bg-black">
                {parameterList}
            </div>
        </MetadataDisclosureSection>
    );
};
