import * as React from 'react';
import { isWorkflowGraphOpen } from '../../../stores/workflowGraphStore';

interface UseViewerKeyboardOptions {
    enabled?: boolean;
    blocked?: boolean;
    onKeyDown: (event: KeyboardEvent) => void;
}

export const useViewerKeyboard = ({ enabled = true, blocked = false, onKeyDown }: UseViewerKeyboardOptions): void => {
    const handlerRef = React.useRef(onKeyDown);
    React.useLayoutEffect(() => {
        handlerRef.current = onKeyDown;
    }, [onKeyDown]);

    React.useEffect(() => {
        if (!enabled) return;
        const handleKeyDown = (event: KeyboardEvent) => {
            const target = event.target;
            if (target instanceof HTMLElement && (target.matches('input, textarea, select') || target.isContentEditable)) return;
            if (blocked) return;
            // The workflow graph owns every key while it is open (Escape included).
            if (isWorkflowGraphOpen()) return;
            handlerRef.current(event);
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [blocked, enabled]);
};
