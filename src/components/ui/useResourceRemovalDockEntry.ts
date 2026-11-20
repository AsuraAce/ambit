import * as React from 'react';
import { useResourceRemovalStore } from '../../stores/resourceRemovalStore';

/** A removal that ends sooner than this never reaches the dock, so quick removals do not flash. */
export const RESOURCE_REMOVAL_DOCK_DELAY_MS = 1000;

/**
 * Path of the resource folder being removed once the removal has run for `RESOURCE_REMOVAL_DOCK_DELAY_MS`, else null.
 */
export const useResourceRemovalDockEntry = (): string | null => {
    const removingPath = useResourceRemovalStore((state) => state.removingResourcePath);
    const [revealedPath, setRevealedPath] = React.useState<string | null>(null);

    // A finished removal forgets its reveal, so a repeat removal of the same folder waits the full delay again.
    if (!removingPath && revealedPath !== null) {
        setRevealedPath(null);
    }

    React.useEffect(() => {
        if (!removingPath) return;
        const timer = window.setTimeout(() => {
            setRevealedPath(removingPath);
        }, RESOURCE_REMOVAL_DOCK_DELAY_MS);
        return () => window.clearTimeout(timer);
    }, [removingPath]);

    return removingPath && revealedPath === removingPath ? removingPath : null;
};
