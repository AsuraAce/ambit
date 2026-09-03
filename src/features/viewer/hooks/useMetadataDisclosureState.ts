import * as React from 'react';

export interface MetadataDisclosureController {
    isExpanded: (key: string) => boolean;
    setExpanded: (key: string, expanded: boolean) => void;
}

export const useMetadataDisclosureState = (): MetadataDisclosureController => {
    const [collapsedKeys, setCollapsedKeys] = React.useState<ReadonlySet<string>>(() => new Set());

    const isExpanded = React.useCallback(
        (key: string) => !collapsedKeys.has(key),
        [collapsedKeys]
    );

    const setExpanded = React.useCallback((key: string, expanded: boolean) => {
        setCollapsedKeys(previous => {
            const next = new Set(previous);
            if (expanded) next.delete(key);
            else next.add(key);
            return next;
        });
    }, []);

    return React.useMemo(() => ({ isExpanded, setExpanded }), [isExpanded, setExpanded]);
};
