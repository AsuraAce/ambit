import type { AppSettings, InvokeOwnerSelection } from '../../types';
import { isSameInvokePath } from './pathIdentity';
import { resolveInvokePaths } from './connection';

/** Editable integration fields only; cursors and snapshots always belong to the applied scope. */
export interface InvokeConnectionDraft {
    invokeAiPath: string;
    invokeOwnerSelection?: InvokeOwnerSelection;
    invokeSyncFavorites: boolean;
    invokeSyncBoards: boolean;
    starredAs: NonNullable<AppSettings['starredAs']>;
    importIntermediates: boolean;
    importOrphans: boolean;
}

export const getInvokeConnectionDraft = (settings: AppSettings): InvokeConnectionDraft => ({
    invokeAiPath: settings.invokeAiPath ?? '',
    invokeOwnerSelection: settings.invokeOwnerSelection,
    invokeSyncFavorites: settings.invokeSyncFavorites !== false,
    invokeSyncBoards: settings.invokeSyncBoards !== false,
    starredAs: settings.starredAs ?? 'favorite',
    importIntermediates: settings.importIntermediates === true,
    importOrphans: settings.importOrphans === true,
});

export const isSameInvokeConnectionSource = (left: string, right: string): boolean =>
    !!left.trim() && !!right.trim()
    && isSameInvokePath(resolveInvokePaths(left.trim()).dbPath, resolveInvokePaths(right.trim()).dbPath);

export const isSameInvokeOwnerSelection = (
    left?: InvokeOwnerSelection,
    right?: InvokeOwnerSelection,
): boolean => left === undefined ? right === undefined : right !== undefined
    && isSameInvokePath(left.dbPath, right.dbPath)
    && left.mode === right.mode
    && (left.mode !== 'owner' || (right.mode === 'owner' && left.ownerId === right.ownerId));

export const isSameInvokeConnectionDraft = (left: InvokeConnectionDraft, right: InvokeConnectionDraft): boolean =>
    (left.invokeAiPath.trim() === right.invokeAiPath.trim()
        || isSameInvokeConnectionSource(left.invokeAiPath, right.invokeAiPath))
    && isSameInvokeOwnerSelection(left.invokeOwnerSelection, right.invokeOwnerSelection)
    && left.invokeSyncFavorites === right.invokeSyncFavorites
    && left.invokeSyncBoards === right.invokeSyncBoards
    && left.starredAs === right.starredAs
    && left.importIntermediates === right.importIntermediates
    && left.importOrphans === right.importOrphans;
