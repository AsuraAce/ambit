import * as React from 'react';
import type { InvokeOwnerScopeState } from '../stores/invokeOwnerScopeStore';
import { isInvokeOwnerScopeAdmitted } from '../stores/invokeOwnerScopeStore';
import { normalizeInvokeRoot } from '../utils/pathUtils';
import { useDelayedBusyPresentation } from './useDelayedBusyPresentation';

const RUNTIME_OWNER_SCOPE_GRACE_MS = 400;

interface OwnerScopeTransitionPresentationOptions {
    configuredRoot: string | null | undefined;
    ownerScopeState: InvokeOwnerScopeState;
    isInitialStartupPresentation: boolean;
    isExplicitPreparation: boolean;
    onClearStaleView: () => void;
}

interface OwnerScopeTransitionPresentation<T> {
    isOwnerScopeAdmitted: boolean;
    isOwnerScopeBlocking: boolean;
    isRuntimeTransition: boolean;
    isGateVisible: boolean;
    isRetainingPreviousView: boolean;
    selectPresentation: (current: T) => T;
}

export const useOwnerScopeTransitionPresentation = <T>({
    configuredRoot,
    ownerScopeState,
    isInitialStartupPresentation,
    isExplicitPreparation,
    onClearStaleView,
}: OwnerScopeTransitionPresentationOptions): OwnerScopeTransitionPresentation<T> => {
    const wasBlockingRef = React.useRef(false);
    const wasRuntimeTransitionRef = React.useRef(false);
    const cleanupPendingRef = React.useRef(false);
    const cleanupPerformedRef = React.useRef(false);
    const lastAdmittedRootRef = React.useRef<string | null>(null);
    const retainedPresentationRef = React.useRef<T | null>(null);

    const normalizedConfiguredRoot = normalizeInvokeRoot(configuredRoot);
    const applyingRoot = normalizeInvokeRoot(ownerScopeState.rootPath);
    // An accepted first connection can still be persisting its path. Keep it gated until admission.
    const isOwnerScopeAdmitted = !isExplicitPreparation && isInvokeOwnerScopeAdmitted(configuredRoot, ownerScopeState);
    const isOwnerScopeBlocking = !isOwnerScopeAdmitted;
    const isRuntimeTransition = !isInitialStartupPresentation
        && ownerScopeState.status === 'applying'
        && normalizedConfiguredRoot !== null
        && applyingRoot === normalizedConfiguredRoot
        && lastAdmittedRootRef.current === normalizedConfiguredRoot;
    const scopeIdentity = ownerScopeState.scope?.mode === 'owner'
        ? ownerScopeState.scope.ownerId
        : (ownerScopeState.scope?.mode ?? 'none');
    const isDelayedGateVisible = useDelayedBusyPresentation(isRuntimeTransition && !isExplicitPreparation, {
        revealDelayMs: RUNTIME_OWNER_SCOPE_GRACE_MS,
        minimumVisibleMs: 0,
        resetKey: `${applyingRoot ?? 'unconfigured'}:${scopeIdentity}`,
    });
    // Settings has closed for an explicit action: do not briefly expose the old gallery during the grace period.
    const isGateVisible = isExplicitPreparation || isDelayedGateVisible;
    const isRetainingPreviousView = isRuntimeTransition && !isGateVisible;

    React.useEffect(() => {
        if (isOwnerScopeAdmitted && normalizedConfiguredRoot !== null) {
            lastAdmittedRootRef.current = normalizedConfiguredRoot;
        }
    }, [isOwnerScopeAdmitted, normalizedConfiguredRoot]);

    React.useLayoutEffect(() => {
        const wasBlocking = wasBlockingRef.current;
        const startedBlocking = isOwnerScopeBlocking && !wasBlocking;
        const finishedBlocking = !isOwnerScopeBlocking && wasBlocking;
        const startedRuntimeTransition = isRuntimeTransition
            && !wasRuntimeTransitionRef.current;

        if (startedBlocking) cleanupPerformedRef.current = false;
        if (startedRuntimeTransition) cleanupPendingRef.current = true;

        const shouldCleanupBlockedView = isOwnerScopeBlocking && !isRetainingPreviousView;
        const shouldCleanupCompletedQuickSwitch = finishedBlocking && cleanupPendingRef.current;
        if (!cleanupPerformedRef.current
            && (shouldCleanupBlockedView || shouldCleanupCompletedQuickSwitch)) {
            cleanupPerformedRef.current = true;
            onClearStaleView();
        }

        if (finishedBlocking) cleanupPendingRef.current = false;
        wasBlockingRef.current = isOwnerScopeBlocking;
        wasRuntimeTransitionRef.current = isRuntimeTransition;
    }, [
        isOwnerScopeBlocking,
        isRetainingPreviousView,
        isRuntimeTransition,
        onClearStaleView,
    ]);

    const selectPresentation = (current: T): T => {
        if (!isOwnerScopeBlocking) retainedPresentationRef.current = current;
        return isRetainingPreviousView && retainedPresentationRef.current !== null
            ? retainedPresentationRef.current
            : current;
    };

    return {
        isOwnerScopeAdmitted,
        isOwnerScopeBlocking,
        isRuntimeTransition,
        isGateVisible,
        isRetainingPreviousView,
        selectPresentation,
    };
};
