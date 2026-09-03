import * as React from 'react';

interface DelayedBusyPresentationOptions {
    revealDelayMs: number;
    minimumVisibleMs: number;
    resetKey?: string;
}

interface BusyPresentationState {
    resetKey: string;
    isVisible: boolean;
    revealedAt: number | null;
}

export const useDelayedBusyPresentation = (
    isActive: boolean,
    {
        revealDelayMs,
        minimumVisibleMs,
        resetKey = '',
    }: DelayedBusyPresentationOptions
): boolean => {
    const [presentation, setPresentation] = React.useState<BusyPresentationState>({
        resetKey,
        isVisible: false,
        revealedAt: null,
    });

    React.useEffect(() => {
        if (presentation.resetKey === resetKey) return;
        setPresentation({ resetKey, isVisible: false, revealedAt: null });
    }, [presentation.resetKey, resetKey]);

    React.useEffect(() => {
        if (presentation.resetKey !== resetKey) return;

        if (isActive) {
            if (presentation.isVisible) return;

            const revealTimerId = window.setTimeout(() => {
                setPresentation(current => (
                    current.resetKey === resetKey
                        ? { ...current, isVisible: true, revealedAt: Date.now() }
                        : current
                ));
            }, revealDelayMs);
            return () => window.clearTimeout(revealTimerId);
        }

        if (!presentation.isVisible) return;

        const visibleForMs = Date.now() - presentation.revealedAt!;
        const remainingMs = Math.max(0, minimumVisibleMs - visibleForMs);
        const hideTimerId = window.setTimeout(() => {
            setPresentation(current => (
                current.resetKey === resetKey
                    ? { ...current, isVisible: false, revealedAt: null }
                    : current
            ));
        }, remainingMs);
        return () => window.clearTimeout(hideTimerId);
    }, [
        isActive,
        minimumVisibleMs,
        presentation.isVisible,
        presentation.resetKey,
        presentation.revealedAt,
        resetKey,
        revealDelayMs,
    ]);

    return presentation.resetKey === resetKey && presentation.isVisible;
};
