import * as React from 'react';
import { CircleHelp, FileCheck2, FileCode2, Pencil, Workflow } from 'lucide-react';
import { TooltipButton } from '../../../../components/ui/InfoTooltip';

interface MetadataSourceBadgeProps {
    source?: string;
}

const SOURCE_DETAILS = {
    trusted_sidecar: { label: 'trusted sidecar', icon: FileCheck2 },
    embedded: { label: 'embedded metadata', icon: FileCode2 },
    user_override: { label: 'user override', icon: Pencil },
    workflow_default: { label: 'workflow default', icon: Workflow },
    unknown: { label: 'unknown', icon: CircleHelp },
} as const;

export const MetadataSourceBadge: React.FC<MetadataSourceBadgeProps> = ({ source }) => {
    if (!source) return null;

    const details = SOURCE_DETAILS[source as keyof typeof SOURCE_DETAILS] ?? {
        label: source.replaceAll('_', ' '),
        icon: CircleHelp,
    };
    const Icon = details.icon;
    const tooltip = `Source: ${details.label}`;

    return (
        <TooltipButton
            label={tooltip}
            content={tooltip}
            persistOnClick
            className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-zinc-600 transition-colors hover:bg-white/5 hover:text-zinc-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sage-500/50"
        >
            <Icon aria-hidden="true" className="h-3.5 w-3.5" />
        </TooltipButton>
    );
};
