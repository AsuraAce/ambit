import * as React from 'react';
import { useInvokeOwnerScopeStore, type InvokeOperationState, type RetainedOwnerScope } from '../../stores/invokeOwnerScopeStore';
import { useDelayedBusyPresentation } from '../../hooks/useDelayedBusyPresentation';

const STARTUP_REVEAL_MS = 2500;
const SUCCESS_VISIBLE_MS = 5000;
/** A user owner switch shows its preparation only after this, so a warm switch never flashes it (#527). */
export const OWNER_SWITCH_REVEAL_DELAY_MS = 600;
const OWNER_SWITCH_MINIMUM_VISIBLE_MS = 400;

/** The user switch this operation drives while the gallery still shows the previous owner, if any. */
export const getOperationOwnerSwitch = (
    operation: InvokeOperationState | null,
    retained: RetainedOwnerScope | null
): RetainedOwnerScope | null => (operation && retained?.operationId === operation.id ? retained : null);

export const useInvokeDockPresentation = (
    operation: InvokeOperationState | null,
    canShowActive: boolean,
    ownerSwitch: RetainedOwnerScope | null = null
) => {
    const operationId = operation?.id;
    const origin = operation?.origin;
    // A user owner switch prepares the target while the previous owner stays browsable, so its preparation
    // is shown here instead of the gate, after a short delay (#527).
    const isOwnerSwitchPreparing =
        ownerSwitch !== null && operation?.viewCommitted === false && ['preparing', 'cancelling', 'settling'].includes(operation.phase);
    const isOwnerSwitchPreparationVisible = useDelayedBusyPresentation(isOwnerSwitchPreparing, {
        revealDelayMs: OWNER_SWITCH_REVEAL_DELAY_MS,
        minimumVisibleMs: OWNER_SWITCH_MINIMUM_VISIBLE_MS,
    });
    const isActive =
        (operation?.viewCommitted === true && ['syncing', 'cancelling', 'settling'].includes(operation.phase)) ||
        (isOwnerSwitchPreparing && isOwnerSwitchPreparationVisible);
    const [revealedId, setRevealedId] = React.useState<symbol | null>(null);
    const [shownId, setShownId] = React.useState<symbol | null>(null);
    const [isDocumentVisible, setIsDocumentVisible] = React.useState(() => document.visibilityState !== 'hidden');
    const isActiveVisible = isActive && (origin === 'user' || revealedId === operationId);

    React.useEffect(() => {
        const onVisibilityChange = () => setIsDocumentVisible(document.visibilityState !== 'hidden');
        document.addEventListener('visibilitychange', onVisibilityChange);
        return () => document.removeEventListener('visibilitychange', onVisibilityChange);
    }, []);

    React.useEffect(() => {
        if (!operationId || origin !== 'startup' || !isActive) return;

        const timer = window.setTimeout(() => setRevealedId(operationId), STARTUP_REVEAL_MS);
        return () => window.clearTimeout(timer);
    }, [operationId, origin, isActive]);

    // Remember that this operation's dock was shown, so a silent startup success stays hidden.
    if (operationId && isActiveVisible && canShowActive && isDocumentVisible && shownId !== operationId) {
        setShownId(operationId);
    }

    // Zero image counts cannot prove that board or ownership work was unchanged.
    const isSilentStartupSuccess =
        origin === 'startup' && operation?.phase === 'completed' && operation.hasChanges === false && shownId !== operationId;

    return {
        isOwnerSwitchPreparing: isOwnerSwitchPreparing && isOwnerSwitchPreparationVisible,
        isActiveVisible,
        isResultVisible: operation !== null && ['completed', 'cancelled', 'failed'].includes(operation.phase) && !isSilentStartupSuccess,
        isDocumentVisible,
    };
};

export const useInvokeResultDismissal = (
    operation: InvokeOperationState | null,
    isResultVisible: boolean,
    isDockShown: boolean,
    isDocumentVisible: boolean
) => {
    const operationId = operation?.id;
    const isSuccess = operation?.phase === 'completed';
    const remaining = React.useRef<{ id: symbol; milliseconds: number } | null>(null);
    const dockRef = React.useRef<HTMLDivElement>(null);
    const [isHovered, setIsHovered] = React.useState(false);
    const [hasFocus, setHasFocus] = React.useState(false);

    // Hover ends with the dock: when the dock, its result or the operation changes while it is hidden.
    const [handledDock, setHandledDock] = React.useState({ isDockShown, isResultVisible, operationId });
    if (
        handledDock.isDockShown !== isDockShown ||
        handledDock.isResultVisible !== isResultVisible ||
        handledDock.operationId !== operationId
    ) {
        setHandledDock({ isDockShown, isResultVisible, operationId });
        if (!isDockShown) setIsHovered(false);
    }

    React.useEffect(() => {
        setHasFocus(dockRef.current?.contains(document.activeElement) ?? false);
    }, [isDockShown, isResultVisible, operationId]);

    React.useEffect(() => {
        if (!operationId || !isSuccess) {
            remaining.current = null;
            return;
        }
        if (remaining.current?.id !== operationId) {
            remaining.current = { id: operationId, milliseconds: SUCCESS_VISIBLE_MS };
        }
        if (!isResultVisible || !isDocumentVisible || isHovered || hasFocus) return;

        const budget = remaining.current;
        const visibleSince = performance.now();
        const timer = window.setTimeout(() => {
            useInvokeOwnerScopeStore
                .getState()
                .setOperation((current) => (current?.id === operationId && current.phase === 'completed' ? null : current));
        }, budget.milliseconds);
        return () => {
            window.clearTimeout(timer);
            budget.milliseconds = Math.max(0, budget.milliseconds - (performance.now() - visibleSince));
        };
    }, [operationId, isSuccess, isResultVisible, isDocumentVisible, isHovered, hasFocus]);

    return {
        ref: dockRef,
        onMouseEnter: () => setIsHovered(true),
        onMouseLeave: () => setIsHovered(false),
        onFocusCapture: () => setHasFocus(true),
        onBlurCapture: (event: React.FocusEvent<HTMLDivElement>) => {
            if (!event.currentTarget.contains(event.relatedTarget)) setHasFocus(false);
        },
    };
};
