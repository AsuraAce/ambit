import {
    commands,
    type FacetScopeCacheStatus,
    type InvokeOwnerScopeMode,
    type InvokeScopeCacheRepairPlan,
} from '../../bindings';
import { reconcileInvokeBoardSnapshot } from '../db/collectionRepo';
import type { InvokeOwnerDiscovery, InvokeOwnerSelection } from '../../types';
import { unwrap } from '../../utils/spectaUtils';
import { createInvokeImagePathResolver } from './pathResolver';
import { fetchBoards, getInvokeSourceDatabase } from './connection';
import { reconcileInvokeSourceFacts } from './sourceReconciliation';
import { resolveInvokeSyncScope } from './syncScope';
import { isSameInvokePath } from './pathIdentity';
import { measureStartupPhase, startupDiagnostics } from '../../utils/startupDiagnostics';

export interface ApplyInvokeOwnerScopeOptions {
    discovery: InvokeOwnerDiscovery;
    selection?: InvokeOwnerSelection;
    reconcileSourceFacts?: boolean;
    reconcileBoardOwners?: boolean;
    forceVisibilityRefresh?: boolean;
    onProgress?: (current: number, total: number, message?: string) => void;
    signal?: AbortSignal;
}

export interface ApplyInvokeOwnerScopeResult {
    changed: boolean;
    sourceFactsUpdated: number;
    activeVisibilityUpdated: number;
    removedVisibilityUpdated: number;
    boardCollectionsUpdated: number;
    boardScopeWarning?: string;
    mode: InvokeOwnerScopeMode;
    cacheStatus: FacetScopeCacheStatus;
    cacheRepair: InvokeScopeCacheRepairPlan;
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
    selection?: InvokeOwnerSelection,
    forceRefresh: boolean = false
) => {
    const { mode, ownerId } = resolveOwnerScope(discovery, selection);
    const visibility = await measureStartupPhase('owner-visibility', () => unwrap(commands.refreshInvokeOwnerScope({
        dbPath: discovery.dbPath,
        imagesRoot: discovery.imagesRoot,
        mode,
        ownerId,
        forceRefresh,
    })));
    return { mode, visibility };
};

export const applyInvokeOwnerScope = async ({
    discovery,
    selection,
    reconcileSourceFacts = false,
    reconcileBoardOwners = false,
    forceVisibilityRefresh = false,
    onProgress = () => undefined,
    signal,
}: ApplyInvokeOwnerScopeOptions): Promise<ApplyInvokeOwnerScopeResult> => {
    if (selection && !isSameInvokePath(selection.dbPath, discovery.dbPath)) {
        throw new Error('The saved InvokeAI owner belongs to a different database.');
    }

    const scope = resolveInvokeSyncScope(discovery, selection);
    let db: Awaited<ReturnType<typeof getInvokeSourceDatabase>> | undefined;
    let sourceFactsUpdated = 0;
    if (scope && reconcileSourceFacts) {
        await measureStartupPhase('owner-source-repair', async () => {
            const diagnostics = startupDiagnostics.claimRepair();
            diagnostics?.stage('setup');
            const setupDone = diagnostics?.start('setup');
            try {
                db = await getInvokeSourceDatabase(discovery.dbPath);
                const columns = new Set(
                    (await db.select<Array<{ name: string }>>('PRAGMA table_info(images)'))
                        .map(column => column.name)
                );
                const pathResolver = createInvokeImagePathResolver(discovery.imagesRoot, async () => {
                    const done = diagnostics?.start('filesystem-enumeration');
                    try { return await unwrap(commands.listInvokeaiImages(discovery.imagesRoot)); }
                    finally { done?.(); }
                });
                setupDone?.();
                sourceFactsUpdated = await reconcileInvokeSourceFacts({
                    db,
                    columns,
                    pathResolver,
                    scope,
                    onProgress: (current, total, message) => {
                        onProgress(current, total, message ?? 'Updating InvokeAI image details...');
                    },
                    signal,
                    diagnostics,
                });
                diagnostics?.finish('completed');
            } catch (error) {
                diagnostics?.finish(signal?.aborted ? 'cancelled' : 'failed');
                throw error;
            }
        });
    }

    let boardCollectionsUpdated = 0;
    let boardScopeWarning: string | undefined;
    let boardsVerified: boolean | undefined;
    if (scope && reconcileBoardOwners) {
        onProgress(0, 0, 'Updating InvokeAI board ownership...');
        const sourceBoards = await measureStartupPhase('owner-board-read', async () => {
            db ??= await getInvokeSourceDatabase(discovery.dbPath);
            return fetchBoards(db, scope);
        });
        boardsVerified = sourceBoards.isAuthoritative;
        if (sourceBoards.isAuthoritative) {
            const boardResult = await measureStartupPhase('owner-board-write', () => reconcileInvokeBoardSnapshot({
                dbPath: discovery.dbPath,
                mode: scope.mode === 'legacy' ? 'legacy' : 'all',
                ownerId: null,
                boards: Array.from(sourceBoards.boards, ([id, board]) => ({
                    id,
                    name: board.name,
                    createdAt: board.createdAt,
                    ownerId: board.ownerId ?? null,
                })),
                memberships: [],
                reconcileMemberships: false,
                deleteMissingCollections: false,
            }));
            boardCollectionsUpdated = boardResult.collectionsUpdated + boardResult.collectionsDeleted;
        } else {
            boardScopeWarning = scope.mode === 'owner'
                ? 'InvokeAI board ownership could not be verified. Owner-scoped boards remain hidden.'
                : 'InvokeAI board ownership could not be verified. Board collections were not updated.';
        }
    }

    onProgress(0, 0, 'Applying InvokeAI visibility...');
    const visibilityStartedAt = performance.now();
    const { mode, visibility } = await refreshInvokeOwnerVisibility(
        discovery,
        selection,
        reconcileSourceFacts || forceVisibilityRefresh
    );
    console.info(`[InvokeAI] Visibility application completed in ${Math.round(performance.now() - visibilityStartedAt)}ms.`);
    if (scope?.mode === 'owner' && boardsVerified !== undefined) {
        await measureStartupPhase('owner-board-verification', () => unwrap(commands.setInvokeBoardVerification(
            discovery.dbPath,
            scope.ownerId,
            boardsVerified
        )));
    }

    return {
        changed: visibility.changed || sourceFactsUpdated > 0 || boardCollectionsUpdated > 0,
        sourceFactsUpdated,
        activeVisibilityUpdated: visibility.activeUpdated,
        removedVisibilityUpdated: visibility.removedUpdated,
        boardCollectionsUpdated,
        boardScopeWarning,
        mode,
        cacheStatus: visibility.cacheStatus,
        cacheRepair: visibility.cacheRepair,
    };
};
