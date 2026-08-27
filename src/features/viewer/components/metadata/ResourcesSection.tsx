import * as React from 'react';
import { Boxes, type LucideIcon } from 'lucide-react';
import { MetadataDisclosureSection } from './MetadataDisclosureSection';
import { MetadataSourceBadge } from './MetadataSourceBadge';
import { buildResourceSearchTerm, ResourceChips, type ResourceFilterKind } from './ResourceChips';

export interface MetadataResourceGroup {
    title: string;
    icon: LucideIcon;
    items: readonly unknown[] | null | undefined;
    filterKind?: ResourceFilterKind;
    source?: string;
}

interface ResourcesSectionProps {
    groups: readonly MetadataResourceGroup[];
    onSearch?: (term: string) => void;
    onClose?: () => void;
    expanded?: boolean;
    onExpandedChange?: (expanded: boolean) => void;
}

export const ResourcesSection: React.FC<ResourcesSectionProps> = ({
    groups,
    onSearch,
    onClose,
    expanded,
    onExpandedChange,
}) => {
    const visibleGroups = groups.filter(group => Array.isArray(group.items) && group.items.length > 0);
    const totalCount = visibleGroups.reduce((total, group) => total + (group.items?.length ?? 0), 0);

    if (visibleGroups.length === 0) return null;

    return (
        <MetadataDisclosureSection
            title="Resources"
            icon={Boxes}
            count={totalCount}
            expanded={expanded}
            onExpandedChange={onExpandedChange}
            contentClassName="mt-3 space-y-4 pl-6"
        >
            {visibleGroups.map(group => {
                const Icon = group.icon;
                const items = group.items ?? [];
                return (
                    <section key={group.title} aria-label={group.title} className="space-y-2">
                        <div className="flex items-center justify-between gap-2">
                            <h4 className="flex min-w-0 items-center gap-2 text-xs font-bold uppercase tracking-wider text-zinc-500">
                                <Icon aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
                                <span className="truncate">{group.title}</span>
                                <span aria-hidden="true" className="text-[10px] font-medium text-zinc-600">{items.length}</span>
                            </h4>
                            {group.source ? <MetadataSourceBadge source={group.source} /> : null}
                        </div>
                        <ResourceChips
                            items={items}
                            onSelect={onSearch ? name => {
                                onSearch(group.filterKind ? buildResourceSearchTerm(group.filterKind, name) : name);
                                onClose?.();
                            } : undefined}
                        />
                    </section>
                );
            })}
        </MetadataDisclosureSection>
    );
};
