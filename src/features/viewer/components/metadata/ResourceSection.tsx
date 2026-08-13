import React from 'react';
import { LucideIcon } from 'lucide-react';
import { buildResourceSearchTerm, ResourceChips, type ResourceFilterKind } from './ResourceChips';
import { MetadataSourceBadge } from './MetadataSourceBadge';
import { MetadataDisclosureSection } from './MetadataDisclosureSection';

interface ResourceSectionProps {
    title: string;
    items: (string | unknown)[]; // Keeping looser type for compatibility with current data shape
    icon: LucideIcon;
    filterKind?: ResourceFilterKind;
    onSearch?: (term: string) => void;
    onClose?: () => void;
    source?: string;
    expanded?: boolean;
    onExpandedChange?: (expanded: boolean) => void;
}

export const ResourceSection = ({ title, items, icon: Icon, filterKind, onSearch, onClose, source, expanded, onExpandedChange }: ResourceSectionProps) => {
    if (!items || !Array.isArray(items) || items.length === 0) return null;
    return (
        <MetadataDisclosureSection
            title={title}
            icon={Icon}
            count={items.length}
            trailing={source ? <MetadataSourceBadge source={source} /> : undefined}
            expanded={expanded}
            onExpandedChange={onExpandedChange}
        >
            <ResourceChips
                items={items}
                onSelect={onSearch ? name => {
                    onSearch(filterKind ? buildResourceSearchTerm(filterKind, name) : name);
                    onClose?.();
                } : undefined}
            />
        </MetadataDisclosureSection>
    );
};
