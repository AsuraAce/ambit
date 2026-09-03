import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowUpRight, Link2, LoaderCircle, RefreshCw } from 'lucide-react';
import {
    getInvokeReferenceGraph,
    INVOKE_REFERENCE_QUERY_KEY,
    INVOKE_REFERENCE_ROLE_LABELS,
    type InvokeReferenceGroup,
} from '../../../../services/db/invokeReferenceRepo';
import { MetadataSectionHeader } from './MetadataSectionHeader';

interface InvokeReferenceLinksProps {
    imageId: string;
    onOpenImage: (imageId: string) => Promise<boolean>;
}

interface ReferenceListProps {
    currentImageId: string;
    groups: InvokeReferenceGroup[];
    pendingImageId: string | null;
    title: 'Source Images' | 'Used By';
    onOpen: (group: InvokeReferenceGroup) => void;
}

const ReferenceList = ({
    currentImageId,
    groups,
    pendingImageId,
    title,
    onOpen,
}: ReferenceListProps) => {
    if (groups.length === 0) return null;
    const headingId = `invoke-${title === 'Source Images' ? 'source-images' : 'used-by'}-heading`;

    return (
        <section aria-labelledby={headingId}>
            <h3 id={headingId} className="mb-2 text-xs font-bold uppercase tracking-wider text-gray-500">
                {title}
            </h3>
            <ul className="space-y-2">
                {groups.map(group => {
                    const isCurrent = group.imageId === currentImageId;
                    const isAvailable = group.availability === 'available' && Boolean(group.imageId) && !isCurrent;
                    const isPending = isAvailable && pendingImageId === group.imageId;
                    const status = isCurrent
                        ? 'Current image'
                        : group.availability === 'removed'
                            ? 'Removed from library'
                            : group.availability === 'unresolved'
                                ? 'Unavailable in Ambit'
                                : null;

                    return (
                        <li key={`${group.availability}\u0000${group.imageId ?? ''}\u0000${group.invokeImageName}`}>
                            <button
                                type="button"
                                disabled={!isAvailable || pendingImageId !== null}
                                aria-label={isAvailable ? `Open ${group.invokeImageName}` : undefined}
                                aria-busy={isPending}
                                onClick={() => onOpen(group)}
                                className="w-full rounded-lg border border-gray-200 bg-white/70 p-3 text-left transition-colors enabled:hover:border-sage-300 enabled:hover:bg-sage-50 disabled:cursor-default dark:border-white/5 dark:bg-zinc-950/30 dark:enabled:hover:border-sage-500/40 dark:enabled:hover:bg-sage-500/5"
                            >
                                <span className="flex items-start justify-between gap-3">
                                    <span className="min-w-0 break-all font-mono text-xs text-gray-700 dark:text-gray-200">
                                        {group.invokeImageName}
                                    </span>
                                    {isPending ? (
                                        <LoaderCircle className="h-3.5 w-3.5 shrink-0 animate-spin text-sage-500" />
                                    ) : isAvailable ? (
                                        <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-sage-500" />
                                    ) : null}
                                </span>
                                <span className="mt-2 flex flex-wrap items-center gap-1.5">
                                    {group.roles.map(role => (
                                        <span
                                            key={role}
                                            className="rounded-full border border-sage-200 bg-sage-50 px-2 py-0.5 text-[10px] font-medium text-sage-600 dark:border-sage-500/20 dark:bg-sage-500/10 dark:text-sage-300"
                                        >
                                            {INVOKE_REFERENCE_ROLE_LABELS[role]}
                                        </span>
                                    ))}
                                    {status ? (
                                        <span className="text-[10px] italic text-gray-400">{status}</span>
                                    ) : null}
                                </span>
                            </button>
                        </li>
                    );
                })}
            </ul>
        </section>
    );
};

export const InvokeReferenceLinks = ({ imageId, onOpenImage }: InvokeReferenceLinksProps) => {
    const [pendingImageId, setPendingImageId] = useState<string | null>(null);
    const query = useQuery({
        queryKey: [...INVOKE_REFERENCE_QUERY_KEY, imageId],
        queryFn: () => getInvokeReferenceGraph(imageId),
    });

    useEffect(() => setPendingImageId(null), [imageId]);

    const handleOpen = async (group: InvokeReferenceGroup) => {
        if (group.availability !== 'available' || !group.imageId || group.imageId === imageId) return;
        setPendingImageId(group.imageId);
        try {
            const opened = await onOpenImage(group.imageId);
            if (!opened) await query.refetch();
        } finally {
            setPendingImageId(null);
        }
    };

    if (query.isLoading) {
        return (
            <section aria-label="InvokeAI references" className="rounded-xl border border-gray-200 bg-white/50 p-4 dark:border-white/5 dark:bg-zinc-800/30">
                <div className="flex items-center gap-2 text-xs text-gray-400">
                    <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                    Loading references...
                </div>
            </section>
        );
    }

    if (query.isError) {
        return (
            <section role="alert" className="rounded-xl border border-red-200 bg-red-50/70 p-4 dark:border-red-500/20 dark:bg-red-500/5">
                <div className="flex items-center justify-between gap-3">
                    <span className="text-xs text-red-700 dark:text-red-300">Reference links are unavailable.</span>
                    <button type="button" onClick={() => void query.refetch()} className="flex items-center gap-1 text-xs font-medium text-red-700 hover:underline dark:text-red-300">
                        <RefreshCw className="h-3 w-3" /> Retry
                    </button>
                </div>
            </section>
        );
    }

    const graph = query.data;
    if (!graph || (graph.sourceImages.length === 0 && graph.usedBy.length === 0)) return null;

    return (
        <div className="space-y-4 rounded-xl border border-gray-200 bg-white/50 p-4 dark:border-white/5 dark:bg-zinc-800/30">
            <MetadataSectionHeader title="References" icon={Link2} />
            <ReferenceList
                currentImageId={imageId}
                groups={graph.sourceImages}
                pendingImageId={pendingImageId}
                title="Source Images"
                onOpen={group => void handleOpen(group)}
            />
            <ReferenceList
                currentImageId={imageId}
                groups={graph.usedBy}
                pendingImageId={pendingImageId}
                title="Used By"
                onOpen={group => void handleOpen(group)}
            />
        </div>
    );
};
