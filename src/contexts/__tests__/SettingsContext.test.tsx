import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultAppSettings } from '../../constants/defaultSettings';
import { SettingsProvider, useSettings } from '../SettingsContext';

const store = vi.hoisted(() => ({
    settings: {} as ReturnType<typeof createDefaultAppSettings>,
    isLoaded: true,
    privacyEnabled: true,
    setSettings: vi.fn(),
    setPrivacyEnabled: vi.fn(),
    initialize: vi.fn(),
}));

vi.mock('../../stores/settingsStore', () => ({
    useSettingsStore: (selector: (state: typeof store) => unknown) => selector(store),
}));

describe('SettingsContext', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        store.settings = createDefaultAppSettings({ theme: 'light' });
        store.isLoaded = true;
        store.privacyEnabled = true;
    });

    it('requires a provider', () => {
        expect(() => renderHook(() => useSettings())).toThrow('useSettings must be used within SettingsProvider');
    });

    it('initializes, forwards actions, and keeps the compatibility ref current', () => {
        const wrapper = ({ children }: { children: React.ReactNode }) => <SettingsProvider>{children}</SettingsProvider>;
        const { result, rerender } = renderHook(() => useSettings(), { wrapper });
        expect(store.initialize).toHaveBeenCalledOnce();
        expect(result.current.settingsRef.current.theme).toBe('light');

        act(() => {
            result.current.setSettings({ theme: 'dark' });
            result.current.setPrivacyEnabled(false);
        });
        expect(store.setSettings).toHaveBeenCalledWith({ theme: 'dark' });
        expect(store.setPrivacyEnabled).toHaveBeenCalledWith(false);

        store.settings = createDefaultAppSettings({ theme: 'dark' });
        rerender();
        expect(result.current.settingsRef.current.theme).toBe('dark');
        expect(result.current.isLoaded).toBe(true);
    });
});
