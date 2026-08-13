import * as React from 'react';

interface UseViewerKeyboardOptions {
    enabled?: boolean;
    blocked?: boolean;
    onKeyDown: (event: KeyboardEvent) => void;
}

export const useViewerKeyboard = ({
    enabled = true,
    blocked = false,
    onKeyDown,
}: UseViewerKeyboardOptions): void => {
    const handlerRef = React.useRef(onKeyDown);
    handlerRef.current = onKeyDown;

    React.useEffect(() => {
        if (!enabled) return;
        const handleKeyDown = (event: KeyboardEvent) => {
            const target = event.target;
            if (target instanceof HTMLElement && (
                target.matches('input, textarea, select') || target.isContentEditable
            )) return;
            if (blocked) return;
            handlerRef.current(event);
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [blocked, enabled]);
};
