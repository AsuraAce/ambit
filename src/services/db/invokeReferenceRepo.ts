import type { InvokeImageReferenceRole } from '../../bindings';
import type { QueryClient } from '@tanstack/react-query';
import { isBrowserMockMode } from '../runtime';
import { getDb } from './connection';

export const INVOKE_REFERENCE_QUERY_KEY = ['invoke-image-references'] as const;

export const invalidateInvokeReferenceQueries = (queryClient: QueryClient): Promise<void> => (
    queryClient.invalidateQueries({ queryKey: INVOKE_REFERENCE_QUERY_KEY })
);

export const INVOKE_REFERENCE_ROLE_ORDER: readonly InvokeImageReferenceRole[] = [
    'init_image',
    'controlnet_image',
    'controlnet_processed_image',
    'ip_adapter_image',
    't2i_adapter_image',
    't2i_adapter_processed_image',
];

export const INVOKE_REFERENCE_ROLE_LABELS: Record<InvokeImageReferenceRole, string> = {
    init_image: 'Initial image',
    controlnet_image: 'ControlNet input',
    controlnet_processed_image: 'ControlNet processed',
    ip_adapter_image: 'IP-Adapter input',
    t2i_adapter_image: 'T2I-Adapter input',
    t2i_adapter_processed_image: 'T2I-Adapter processed',
};

export type InvokeReferenceAvailability = 'available' | 'unresolved' | 'removed';

export interface InvokeReferenceGroup {
    imageId: string | null;
    invokeImageName: string;
    availability: InvokeReferenceAvailability;
    roles: InvokeImageReferenceRole[];
}

export interface InvokeReferenceGraph {
    sourceImages: InvokeReferenceGroup[];
    usedBy: InvokeReferenceGroup[];
}

interface ForwardReferenceRow {
    role: InvokeImageReferenceRole;
    target_invoke_image_name: string;
    active_target_id: string | null;
}

interface BacklinkReferenceRow {
    role: InvokeImageReferenceRole;
    source_image_id: string;
    source_invoke_image_name: string | null;
    active_source_id: string | null;
    removed_source_id: string | null;
}

interface ReferenceEdge {
    imageId: string | null;
    invokeImageName: string;
    availability: InvokeReferenceAvailability;
    role: InvokeImageReferenceRole;
}

const roleRank = new Map(INVOKE_REFERENCE_ROLE_ORDER.map((role, index) => [role, index]));

const fallbackNameFromId = (id: string): string => {
    const normalized = id.replace(/\\/g, '/');
    return normalized.slice(normalized.lastIndexOf('/') + 1) || id;
};

const compareNames = (left: string, right: string): number => {
    const normalizedLeft = left.toLocaleLowerCase();
    const normalizedRight = right.toLocaleLowerCase();
    if (normalizedLeft < normalizedRight) return -1;
    if (normalizedLeft > normalizedRight) return 1;
    return left < right ? -1 : left > right ? 1 : 0;
};

const groupEdges = (edges: ReferenceEdge[]): InvokeReferenceGroup[] => {
    const grouped = new Map<string, InvokeReferenceGroup>();

    edges.forEach(edge => {
        const key = `${edge.availability}\u0000${edge.imageId ?? ''}\u0000${edge.invokeImageName}`;
        const current = grouped.get(key);
        if (current) {
            if (!current.roles.includes(edge.role)) current.roles.push(edge.role);
            return;
        }

        grouped.set(key, {
            imageId: edge.imageId,
            invokeImageName: edge.invokeImageName,
            availability: edge.availability,
            roles: [edge.role],
        });
    });

    return [...grouped.values()]
        .map(group => ({
            ...group,
            roles: [...group.roles].sort((left, right) => (
                (roleRank.get(left) ?? Number.MAX_SAFE_INTEGER)
                - (roleRank.get(right) ?? Number.MAX_SAFE_INTEGER)
            )),
        }))
        .sort((left, right) => compareNames(left.invokeImageName, right.invokeImageName));
};

export const getInvokeReferenceGraph = async (imageId: string): Promise<InvokeReferenceGraph> => {
    if (isBrowserMockMode()) return { sourceImages: [], usedBy: [] };

    const db = await getDb();
    const [forwardRows, backlinkRows] = await Promise.all([
        db.select<ForwardReferenceRow[]>(
            `SELECT
                r.role,
                r.target_invoke_image_name,
                target.id AS active_target_id
             FROM invoke_image_references r
             INNER JOIN scoped_images visible_source
                ON visible_source.id = r.source_image_id
               AND visible_source.invoke_scope_hidden = 0
             LEFT JOIN scoped_images target
                ON target.id = r.target_image_id
               AND target.invoke_scope_hidden = 0
             WHERE r.source_image_id = ?`,
            [imageId]
        ),
        db.select<BacklinkReferenceRow[]>(
            `SELECT
                r.role,
                r.source_image_id,
                COALESCE(active_source.invoke_image_name, removed_source.invoke_image_name) AS source_invoke_image_name,
                active_source.id AS active_source_id,
                removed_source.id AS removed_source_id
             FROM invoke_image_references r
             INNER JOIN scoped_images visible_target
                ON visible_target.id = r.target_image_id
               AND visible_target.invoke_scope_hidden = 0
             LEFT JOIN scoped_images active_source
                ON active_source.id = r.source_image_id
               AND active_source.invoke_scope_hidden = 0
             LEFT JOIN scoped_removed_images removed_source
                ON removed_source.id = r.source_image_id
               AND removed_source.invoke_scope_hidden = 0
             WHERE r.target_image_id = ?
               AND (active_source.id IS NOT NULL OR removed_source.id IS NOT NULL)`,
            [imageId]
        ),
    ]);

    const sourceImages = groupEdges(forwardRows.map(row => ({
        imageId: row.active_target_id,
        invokeImageName: row.target_invoke_image_name,
        availability: row.active_target_id ? 'available' : 'unresolved',
        role: row.role,
    })));

    const usedBy = groupEdges(backlinkRows.map(row => {
        const availability: InvokeReferenceAvailability = row.active_source_id
            ? 'available'
            : (row.removed_source_id ? 'removed' : 'unresolved');
        return {
            imageId: row.active_source_id,
            invokeImageName: row.source_invoke_image_name?.trim() || fallbackNameFromId(row.source_image_id),
            availability,
            role: row.role,
        };
    }));

    return { sourceImages, usedBy };
};
