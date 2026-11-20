import * as React from 'react';
import type { InvokeOwnerScopeState, RetainedOwnerScope } from '../stores/invokeOwnerScopeStore';
import { isInvokeOwnerScopeAdmitted, useInvokeOwnerScopeStore } from '../stores/invokeOwnerScopeStore';
import type { InvokeSyncScope } from '../services/invoke/syncScope';
import { normalizeInvokeRoot } from '../utils/pathUtils';
import { useDelayedBusyPresentation } from './useDelayedBusyPresentation';

const RUNTIME_OWNER_SCOPE_GRACE_MS = 400;

const scopeIdentityOf = (scope: InvokeSyncScope | undefined): string =>
    scope?.mode === 'owner' ? `owner:${scope.ownerId}` : (scope?.mode ?? 'none');

interface OwnerScopeTransitionPresentationOptions {
    configuredRoot: string | null | undefined;
    ownerScopeState: InvokeOwnerScopeState;
    isInitialStartupPresentation: boolean;
    isExplicitPreparation: boolean;
    onClearStaleView: () => void;
    /** The owner a user switch keeps on screen (#527), from the owner-scope store. */
    retainedOwnerScope?: RetainedOwnerScope | null;
    /**
     * Whether the screen may swap to the target owner now. The caller passes false while the viewer or any
     * modal is open; "any modal" includes Settings and every confirm dialog, among them one opened after a
     * refused write. "Switch now" (`swapRequested`) overrides it.
     */
    canSwapOwnerView?: boolean;
}

interface OwnerScopeTransitionPresentation<T> {
    isOwnerScopeAdmitted: boolean;
    isOwnerScopeBlocking: boolean;
    isRuntimeTransition: boolean;
    isGateVisible: boolean;
    isRetainingPreviousView: boolean;
    /** True while a user switch keeps the previous owner on screen; the view stays browsable, not inert. */
    isRetainingOwnerSwitchView: boolean;
    selectPresentation: (current: T) => T;
}

export const useOwnerScopeTransitionPresentation = <T>({
    configuredRoot,
    ownerScopeState,
    isInitialStartupPresentation,
    isExplicitPreparation,
    onClearStaleView,
    retainedOwnerScope = null,
    canSwapOwnerView = true,
}: OwnerScopeTransitionPresentationOptions): OwnerScopeTransitionPresentation<T> => {
    const wasBlockingRef = React.useRef(false);
    const wasRuntimeTransitionRef = React.useRef(false);
    const cleanupPendingRef = React.useRef(false);
    const cleanupPerformedRef = React.useRef(false);
    const [lastAdmittedRoot, setLastAdmittedRoot] = React.useState<string | null>(null);
    const retainedPresentationRef = React.useRef<T | null>(null);

    const normalizedConfiguredRoot = normalizeInvokeRoot(configuredRoot);
    const applyingRoot = normalizeInvokeRoot(ownerScopeState.rootPath);
    // A user switch on the configured root keeps the previous owner on screen until the swap (#527).
    const retainedSwitch =
        retainedOwnerScope &&
        normalizedConfiguredRoot !== null &&
        normalizeInvokeRoot(retainedOwnerScope.rootPath) === normalizedConfiguredRoot
            ? retainedOwnerScope
            : null;
    const isRetainingOwnerSwitchView = retainedSwitch !== null;
    // An accepted first connection can still be persisting its path. Keep it gated until admission.
    const isOwnerScopeAdmitted = !isExplicitPreparation && isInvokeOwnerScopeAdmitted(configuredRoot, ownerScopeState);
    const isOwnerScopeBlocking = !isOwnerScopeAdmitted;
    // Remember the last admitted root during render. Admission (ready) and a runtime transition
    // (applying) never hold in the same render, so this matches the previous after-commit update.
    if (isOwnerScopeAdmitted && normalizedConfiguredRoot !== null && normalizedConfiguredRoot !== lastAdmittedRoot) {
        setLastAdmittedRoot(normalizedConfiguredRoot);
    }
    const isRuntimeTransition =
        !isInitialStartupPresentation &&
        ownerScopeState.status === 'applying' &&
        normalizedConfiguredRoot !== null &&
        applyingRoot === normalizedConfiguredRoot &&
        lastAdmittedRoot === normalizedConfiguredRoot;
    const scopeIdentity = scopeIdentityOf(ownerScopeState.scope);
    const isDelayedGateVisible = useDelayedBusyPresentation(isRuntimeTransition && !isExplicitPreparation && !isRetainingOwnerSwitchView, {
        revealDelayMs: RUNTIME_OWNER_SCOPE_GRACE_MS,
        minimumVisibleMs: 0,
        resetKey: `${applyingRoot ?? 'unconfigured'}:${scopeIdentity}`,
    });
    // Settings has closed for an explicit action: do not briefly expose the old gallery during the grace period.
    // A user switch between owners of an admitted root is the exception: its previous owner stays browsable.
    const isGateVisible = !isRetainingOwnerSwitchView && (isExplicitPreparation || isDelayedGateVisible);
    const isRetainingPreviousView = isRetainingOwnerSwitchView || (isRuntimeTransition && !isGateVisible);

    React.useLayoutEffect(() => {
        const wasBlocking = wasBlockingRef.current;
        const startedBlocking = isOwnerScopeBlocking && !wasBlocking;
        const finishedBlocking = !isOwnerScopeBlocking && wasBlocking;
        const startedRuntimeTransition = isRuntimeTransition && !wasRuntimeTransitionRef.current;

        if (startedBlocking) cleanupPerformedRef.current = false;
        // A user switch clears the stale view at its swap instead; a cancelled one keeps it.
        if (startedRuntimeTransition && !isRetainingOwnerSwitchView) cleanupPendingRef.current = true;

        const shouldCleanupBlockedView = isOwnerScopeBlocking && !isRetainingPreviousView;
        const shouldCleanupCompletedQuickSwitch = finishedBlocking && cleanupPendingRef.current;
        if (!cleanupPerformedRef.current && (shouldCleanupBlockedView || shouldCleanupCompletedQuickSwitch)) {
            cleanupPerformedRef.current = true;
            onClearStaleView();
        }

        if (finishedBlocking) cleanupPendingRef.current = false;
        wasBlockingRef.current = isOwnerScopeBlocking;
        wasRuntimeTransitionRef.current = isRuntimeTransition;
    }, [isOwnerScopeBlocking, isRetainingOwnerSwitchView, isRetainingPreviousView, isRuntimeTransition, onClearStaleView]);

    // The swap: the target owner is admitted, and nothing open would lose its content (or "Switch now").
    const retainedOperationId = retainedSwitch?.operationId ?? null;
    const isTargetAdmitted = retainedSwitch !== null && isOwnerScopeAdmitted && scopeIdentity !== scopeIdentityOf(retainedSwitch.scope);
    const shouldSwap = isTargetAdmitted && (canSwapOwnerView || retainedSwitch?.swapRequested === true);
    React.useLayoutEffect(() => {
        if (!shouldSwap || retainedOperationId === null) return;
        useInvokeOwnerScopeStore.getState().releaseRetainedOwnerScope(retainedOperationId);
        onClearStaleView();
    }, [onClearStaleView, retainedOperationId, shouldSwap]);

    const selectPresentation = (current: T): T => {
        // Only a view of the admitted owner with nothing retained may become the kept snapshot: during a
        // switch's hold the current presentation already belongs to the target owner.
        if (!isOwnerScopeBlocking && !isRetainingOwnerSwitchView) retainedPresentationRef.current = current;
        return isRetainingPreviousView && retainedPresentationRef.current !== null ? retainedPresentationRef.current : current;
    };

    return {
        isOwnerScopeAdmitted,
        isOwnerScopeBlocking,
        isRuntimeTransition,
        isGateVisible,
        isRetainingPreviousView,
        isRetainingOwnerSwitchView,
        selectPresentation,
    };
};
