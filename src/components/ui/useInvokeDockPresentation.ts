import * as React from 'react';
import { useInvokeOwnerScopeStore, type InvokeOperationState } from '../../stores/invokeOwnerScopeStore';

const STARTUP_REVEAL_MS = 2500;
const SUCCESS_VISIBLE_MS = 5000;

export const useInvokeDockPresentation = (
    operation: InvokeOperationState | null,
    canShowActive: boolean
) => {
    const operationId = operation?.id;
    const origin = operation?.origin;
    const isActive = operation?.viewCommitted === true
        && ['syncing', 'cancelling', 'settling'].includes(operation.phase);
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

    React.useEffect(() => {
        if (operationId && isActiveVisible && canShowActive && isDocumentVisible) {
            setShownId(operationId);
        }
    }, [operationId, isActiveVisible, canShowActive, isDocumentVisible]);

    // Zero image counts cannot prove that board or ownership work was unchanged.
    const isSilentStartupSuccess = origin === 'startup' && operation?.phase === 'completed'
        && operation.hasChanges === false && shownId !== operationId;

    return {
        isActiveVisible,
        isResultVisible: operation !== null
            && ['completed', 'cancelled', 'failed'].includes(operation.phase)
            && !isSilentStartupSuccess,
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

    React.useEffect(() => {
        if (!isDockShown) setIsHovered(false);
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
            useInvokeOwnerScopeStore.getState().setOperation(current => (
                current?.id === operationId && current.phase === 'completed' ? null : current
            ));
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
