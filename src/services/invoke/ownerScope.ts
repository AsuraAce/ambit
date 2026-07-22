import Database from '@tauri-apps/plugin-sql';
import { commands, type InvokeOwnerScopeMode } from '../../bindings';
import type { InvokeOwnerDiscovery, InvokeOwnerSelection } from '../../types';
import { unwrap } from '../../utils/spectaUtils';
import { createInvokeImagePathResolver } from './pathResolver';
import { reconcileInvokeSourceFacts } from './sourceReconciliation';
import { resolveInvokeSyncScope } from './syncScope';

export interface ApplyInvokeOwnerScopeOptions {
    discovery: InvokeOwnerDiscovery;
    selection?: InvokeOwnerSelection;
    onProgress?: (current: number, total: number, message?: string) => void;
    signal?: AbortSignal;
}

export interface ApplyInvokeOwnerScopeResult {
    changed: boolean;
    sourceFactsUpdated: number;
    activeVisibilityUpdated: number;
    removedVisibilityUpdated: number;
    mode: InvokeOwnerScopeMode;
}

const resolveOwnerScope = (
    discovery: InvokeOwnerDiscovery,
    selection?: InvokeOwnerSelection
): { mode: InvokeOwnerScopeMode; ownerId: string | null } => ({
    mode: discovery.schemaMode === 'legacy'
        ? 'legacy'
        : (selection?.mode ?? 'unselected'),
    ownerId: selection?.mode === 'owner' ? selection.ownerId : null,
});

export const refreshInvokeOwnerVisibility = async (
    discovery: InvokeOwnerDiscovery,
    selection?: InvokeOwnerSelection
) => {
    const { mode, ownerId } = resolveOwnerScope(discovery, selection);
    const visibility = await unwrap(commands.refreshInvokeOwnerScope({
        dbPath: discovery.dbPath,
        imagesRoot: discovery.imagesRoot,
        mode,
        ownerId,
    }));
    return { mode, visibility };
};

export const applyInvokeOwnerScope = async ({
    discovery,
    selection,
    onProgress = () => undefined,
    signal,
}: ApplyInvokeOwnerScopeOptions): Promise<ApplyInvokeOwnerScopeResult> => {
    if (selection && selection.dbPath !== discovery.dbPath) {
        throw new Error('The saved InvokeAI owner belongs to a different database.');
    }

    const scope = resolveInvokeSyncScope(discovery, selection);
    let sourceFactsUpdated = 0;
    if (scope) {
        const db = await Database.load(`sqlite:${discovery.dbPath}`);
        const columns = new Set(
            (await db.select<Array<{ name: string }>>('PRAGMA table_info(images)'))
                .map(column => column.name)
        );
        const pathResolver = createInvokeImagePathResolver(discovery.imagesRoot, async () =>
            unwrap(commands.listInvokeaiImages(discovery.imagesRoot))
        );
        sourceFactsUpdated = await reconcileInvokeSourceFacts({
            db,
            columns,
            pathResolver,
            scope,
            onProgress,
            signal,
        });
    }

    const { mode, visibility } = await refreshInvokeOwnerVisibility(discovery, selection);

    return {
        changed: visibility.changed || sourceFactsUpdated > 0,
        sourceFactsUpdated,
        activeVisibilityUpdated: visibility.activeUpdated,
        removedVisibilityUpdated: visibility.removedUpdated,
        mode,
    };
};
