import * as React from 'react';
import { useSettingsStore } from '../../../stores/settingsStore';
import type { ViewerTabId } from './viewerTabAvailability';

const fallbackTab = (availableTabs: readonly ViewerTabId[]): ViewerTabId => {
    if (availableTabs.includes('metadata')) return 'metadata';
    if (availableTabs.includes('details')) return 'details';
    return availableTabs[0] ?? 'details';
};

export interface ViewerPreferredTabState {
    activeTab: ViewerTabId;
    onExplicitTabChange: (tab: ViewerTabId) => void;
}

export const useViewerPreferredTab = (
    availableTabs: readonly ViewerTabId[],
): ViewerPreferredTabState => {
    const preferredTab = useSettingsStore(state =>
        state.settings.viewerPreferredTab
    );
    const isLoaded = useSettingsStore(state => state.isLoaded);
    const setSettings = useSettingsStore(state => state.setSettings);
    const [preHydrationTab, setPreHydrationTab] = React.useState<ViewerTabId | undefined>();
    const defaultTab = React.useMemo(() => fallbackTab(availableTabs), [availableTabs]);

    React.useEffect(() => {
        if (isLoaded && preHydrationTab !== undefined) setPreHydrationTab(undefined);
    }, [isLoaded, preHydrationTab]);

    const defaultDetailsTab = availableTabs.includes('details') ? 'details' : defaultTab;
    const selectedTab = isLoaded ? preferredTab : preHydrationTab;
    const activeTab = selectedTab && availableTabs.includes(selectedTab)
        ? selectedTab
        : selectedTab
            ? defaultTab
            : defaultDetailsTab;

    const onExplicitTabChange = React.useCallback((tab: ViewerTabId) => {
        if (!availableTabs.includes(tab)) return;
        if (!isLoaded) {
            setPreHydrationTab(tab);
            return;
        }
        setSettings({ viewerPreferredTab: tab });
    }, [availableTabs, isLoaded, setSettings]);

    return { activeTab, onExplicitTabChange };
};
