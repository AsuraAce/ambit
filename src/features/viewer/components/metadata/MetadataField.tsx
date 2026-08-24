import * as React from 'react';
import type { LucideIcon } from 'lucide-react';
import { MetadataSourceBadge } from './MetadataSourceBadge';
import { MetadataSectionHeader } from './MetadataSectionHeader';

interface MetadataFieldProps {
    label: string;
    icon: LucideIcon;
    source?: string;
    modified?: boolean;
    children: React.ReactNode;
    className?: string;
}

export const MetadataField: React.FC<MetadataFieldProps> = ({
    label,
    icon,
    source,
    modified = false,
    children,
    className = '',
}) => {
    const isModified = modified || source === 'user_override';

    return (
        <section className={className}>
            <MetadataSectionHeader
                title={label}
                icon={icon}
                modified={isModified}
                trailing={isModified || source
                    ? <MetadataSourceBadge source={isModified ? 'user_override' : source} />
                    : undefined}
                className="mb-2"
            />
            {children}
        </section>
    );
};
