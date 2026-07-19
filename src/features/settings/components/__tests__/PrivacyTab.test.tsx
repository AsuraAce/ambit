import * as React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '../../../../test/testUtils';
import { useSettingsStore } from '../../../../stores/settingsStore';
import type { AppSettings } from '../../../../types';
import { PrivacyTab } from '../PrivacyTab';
import { settingsPersistenceCoordinator } from '../../../../utils/settingsPersistenceCoordinator';

const addToastMock = vi.fn();

const createDeferred = <T,>() => {
    let resolve!: (value: T) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
};

vi.mock('../../../../hooks/useToast', () => ({
    useToast: () => ({
        addToast: addToastMock,
    }),
}));

const createSettings = (overrides: Partial<AppSettings> = {}): AppSettings => ({
    hasCompletedOnboarding: true,
    theme: 'dark',
    thumbnailSize: 200,
    confirmDelete: true,
    defaultTheaterMode: false,
    monitoredFolders: [],
    promptMaskingEnabled: true,
    maskedKeywords: [],
    maskingMode: 'blur',
    enableAI: false,
    ...overrides,
});

const settingsHarness = (initial: AppSettings) => {
    let current = initial;
    const setSettings = vi.fn((update: React.SetStateAction<AppSettings>) => {
        current = typeof update === 'function' ? update(current) : update;
    });
    return { setSettings, current: () => current };
};

const StorePrivacyTab = () => {
    const settings = useSettingsStore(state => state.settings);
    const setSettings = useSettingsStore(state => state.setSettings);
    return <PrivacyTab settings={settings} setSettings={setSettings} />;
};

describe('PrivacyTab', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        settingsPersistenceCoordinator.reopenAdmission();
        useSettingsStore.setState({
            settings: createSettings(),
            privacyEnabled: true,
            privacyMaskIndexStatus: 'ready',
            privacyMaskIndexError: null,
            privacyMaskIndexRetryToken: 0,
            initializationStatus: 'ready',
            isLoaded: true,
            flushSettings: vi.fn().mockResolvedValue(undefined),
        });
    });

    it('keeps failures visible and allows an explicit privacy-index retry', () => {
        useSettingsStore.setState({
            privacyMaskIndexStatus: 'failed',
            privacyMaskIndexError: 'database unavailable',
        });

        render(<StorePrivacyTab />);

        expect(screen.getByRole('alert').textContent).toContain('database unavailable');
        fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
        expect(useSettingsStore.getState().privacyMaskIndexStatus).toBe('pending');
        expect(useSettingsStore.getState().privacyMaskIndexError).toBeNull();
        expect(useSettingsStore.getState().privacyMaskIndexRetryToken).toBe(1);
    });

    it('explains startup-default privacy masking and session-only changes', () => {
        render(<PrivacyTab settings={createSettings()} setSettings={vi.fn()} />);

        expect(screen.getByText('Privacy masking is enabled by default every time Ambit starts. Turning it off here only affects the current session.')).not.toBeNull();
    });

    it('explains how blur and hide affect matching images', () => {
        render(<PrivacyTab settings={createSettings()} setSettings={vi.fn()} />);

        fireEvent.focus(screen.getByRole('button', { name: 'About privacy masking behavior' }));

        expect(screen.getByRole('tooltip').textContent).toContain('Blur keeps automatically or manually masked images visible');
        expect(screen.getByRole('tooltip').textContent).toContain('Hide removes them from results');
    });

    it('persists prompt masking independently while retaining an editable keyword list', async () => {
        const harness = settingsHarness(createSettings({
            promptMaskingEnabled: true,
            maskedKeywords: ['retained'],
        }));
        const { rerender } = render(<PrivacyTab settings={harness.current()} setSettings={harness.setSettings} />);

        const promptSwitch = screen.getByRole('switch', { name: 'Prompt keyword masking' });
        fireEvent.click(promptSwitch);

        expect(harness.current()).toEqual(expect.objectContaining({
            promptMaskingEnabled: false,
            maskedKeywords: ['retained'],
        }));
        await waitFor(() => expect(addToastMock).toHaveBeenCalledWith(
            'Prompt keyword masking disabled; saved keywords retained',
            'success'
        ));

        rerender(<PrivacyTab settings={harness.current()} setSettings={harness.setSettings} />);
        expect(screen.getByText('retained')).not.toBeNull();
        expect(screen.getByText('Saved · inactive')).not.toBeNull();
        const input = screen.getByPlaceholderText('Type keyword and press Enter...');
        expect((input as HTMLInputElement).disabled).toBe(false);
        fireEvent.change(input, { target: { value: 'prepared' } });
        fireEvent.click(screen.getByText('Add'));
        expect(harness.current().maskedKeywords).toEqual(['retained', 'prepared']);
        expect(harness.current().promptMaskingEnabled).toBe(false);
    });

    it('keeps an enabled empty list empty and explains that no prompts match', () => {
        render(<PrivacyTab settings={createSettings({ promptMaskingEnabled: true, maskedKeywords: [] })} setSettings={vi.fn()} />);

        expect(screen.getByRole('status').textContent).toContain('no keywords are configured');
        expect(screen.getByText('No keywords added yet')).not.toBeNull();
    });

    it('exposes and updates the current session state as an accessible switch', () => {
        render(<PrivacyTab settings={createSettings()} setSettings={vi.fn()} />);

        const privacySwitch = screen.getByRole('switch', { name: 'Privacy Mode' });
        expect(privacySwitch.getAttribute('aria-checked')).toBe('true');

        fireEvent.click(privacySwitch);

        expect(privacySwitch.getAttribute('aria-checked')).toBe('false');
        expect(useSettingsStore.getState().privacyEnabled).toBe(false);
        expect(addToastMock).toHaveBeenCalledWith('Privacy mode disabled for this session', 'success');
    });

    it('enables session privacy and changes both persisted masking modes', async () => {
        useSettingsStore.setState({ privacyEnabled: false });
        const harness = settingsHarness(createSettings());
        const { rerender } = render(<PrivacyTab settings={harness.current()} setSettings={harness.setSettings} />);

        fireEvent.click(screen.getByRole('switch', { name: 'Privacy Mode' }));
        expect(useSettingsStore.getState().privacyEnabled).toBe(true);
        expect(addToastMock).toHaveBeenCalledWith('Privacy mode enabled for this session', 'success');

        fireEvent.click(screen.getByLabelText('Hide Completely'));
        expect(harness.current().maskingMode).toBe('hide');
        await waitFor(() => expect(addToastMock).toHaveBeenCalledWith('Masking mode set to hide', 'success'));
        rerender(<PrivacyTab settings={harness.current()} setSettings={harness.setSettings} />);
        fireEvent.click(screen.getByLabelText('Blur Content'));
        expect(harness.current().maskingMode).toBe('blur');
    });

    it('normalizes new keywords, rejects duplicates, and removes existing entries after persistence', async () => {
        const harness = settingsHarness(createSettings({ maskedKeywords: ['existing'] }));
        const { rerender } = render(<PrivacyTab settings={harness.current()} setSettings={harness.setSettings} />);
        const input = screen.getByPlaceholderText('Type keyword and press Enter...');

        fireEvent.keyDown(input, { key: 'Escape' });
        fireEvent.keyDown(input, { key: 'Enter' });
        expect(harness.setSettings).not.toHaveBeenCalled();

        fireEvent.change(input, { target: { value: ' EXISTING ' } });
        fireEvent.click(screen.getByText('Add'));
        expect(addToastMock).toHaveBeenCalledWith('Keyword already exists', 'warning');
        expect(harness.setSettings).not.toHaveBeenCalled();

        fireEvent.change(input, { target: { value: '  Sensitive  ' } });
        fireEvent.keyDown(input, { key: 'Enter' });
        expect(harness.current().maskedKeywords).toEqual(['existing', 'sensitive']);
        expect(addToastMock).not.toHaveBeenCalledWith('Added "sensitive" to masked keywords', 'success');
        await waitFor(() => expect(addToastMock).toHaveBeenCalledWith('Added "sensitive" to masked keywords', 'success'));

        rerender(<PrivacyTab settings={harness.current()} setSettings={harness.setSettings} />);
        const existingChip = screen.getByText('existing').closest('span') as HTMLElement;
        fireEvent.click(existingChip.querySelector('button') as HTMLButtonElement);
        expect(harness.current().maskedKeywords).toEqual(['sensitive']);
        await waitFor(() => expect(addToastMock).toHaveBeenCalledWith('Removed "existing" from masked keywords', 'success'));
    });

    it('finishes a persisted keyword edit after the Strict Mode effect replay', async () => {
        render(
            <React.StrictMode>
                <StorePrivacyTab />
            </React.StrictMode>
        );

        const input = screen.getByPlaceholderText('Type keyword and press Enter...');
        fireEvent.change(input, { target: { value: 'sensitive' } });
        fireEvent.click(screen.getByText('Add'));

        await waitFor(() => expect(addToastMock).toHaveBeenCalledWith(
            'Added "sensitive" to masked keywords',
            'success'
        ));
        expect((input as HTMLInputElement).disabled).toBe(false);
        expect((input as HTMLInputElement).value).toBe('');
    });

    it('rolls back a failed keyword save and keeps the input available for retry', async () => {
        useSettingsStore.setState({ flushSettings: vi.fn().mockRejectedValue(new Error('disk full')) });
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        useSettingsStore.setState({ settings: createSettings({ maskedKeywords: ['existing'] }) });
        render(<StorePrivacyTab />);

        const input = screen.getByPlaceholderText('Type keyword and press Enter...');
        fireEvent.change(input, { target: { value: 'sensitive' } });
        fireEvent.click(screen.getByText('Add'));

        await waitFor(() => {
            expect(useSettingsStore.getState().settings.maskedKeywords).toEqual(['existing']);
            expect(addToastMock).toHaveBeenCalledWith('Failed to save "sensitive" as a masked keyword', 'error');
        });
        expect((input as HTMLInputElement).value).toBe('sensitive');
        expect(addToastMock).not.toHaveBeenCalledWith('Added "sensitive" to masked keywords', 'success');
        consoleError.mockRestore();
    });

    it('rolls back a failed prompt masking toggle without clearing keywords', async () => {
        useSettingsStore.setState({
            settings: createSettings({ promptMaskingEnabled: true, maskedKeywords: ['retained'] }),
            flushSettings: vi.fn().mockRejectedValue(new Error('disk full')),
        });
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        render(<StorePrivacyTab />);

        fireEvent.click(screen.getByRole('switch', { name: 'Prompt keyword masking' }));

        await waitFor(() => expect(useSettingsStore.getState().settings).toEqual(expect.objectContaining({
            promptMaskingEnabled: true,
            maskedKeywords: ['retained'],
        })));
        expect(addToastMock).toHaveBeenCalledWith('Failed to save prompt keyword masking', 'error');
        consoleError.mockRestore();
    });

    it('completes an owned rollback and exact flush while close admission drains', async () => {
        const firstFlush = createDeferred<void>();
        const rollbackFlush = createDeferred<void>();
        const flushSettings = vi.fn()
            .mockReturnValueOnce(firstFlush.promise)
            .mockReturnValueOnce(rollbackFlush.promise);
        useSettingsStore.setState({
            settings: createSettings({ maskedKeywords: ['existing'], thumbnailSize: 200 }),
            flushSettings,
        });
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        render(<StorePrivacyTab />);

        fireEvent.change(screen.getByPlaceholderText('Type keyword and press Enter...'), {
            target: { value: 'sensitive' },
        });
        fireEvent.click(screen.getByText('Add'));
        await waitFor(() => expect(flushSettings).toHaveBeenCalledOnce());

        let drainSettled = false;
        const drain = settingsPersistenceCoordinator.closeAdmissionAndDrain().then(() => {
            drainSettled = true;
        });
        useSettingsStore.setState(state => ({
            settings: { ...state.settings, thumbnailSize: 320 },
        }));
        firstFlush.reject(new Error('disk full'));

        await waitFor(() => expect(flushSettings).toHaveBeenCalledTimes(2));
        expect(useSettingsStore.getState().settings).toEqual(expect.objectContaining({
            maskedKeywords: ['existing'],
            thumbnailSize: 320,
        }));
        expect(flushSettings).toHaveBeenLastCalledWith(expect.objectContaining({
            maskedKeywords: ['existing'],
            thumbnailSize: 320,
        }));
        expect(drainSettled).toBe(false);

        rollbackFlush.resolve();
        await drain;
        expect(drainSettled).toBe(true);
        consoleError.mockRestore();
    });

    it('does not let an older failed save roll back a newer save after remount', async () => {
        const firstSave = createDeferred<void>();
        const secondSave = createDeferred<void>();
        const flushSettings = vi.fn()
            .mockReturnValueOnce(firstSave.promise)
            .mockReturnValueOnce(secondSave.promise);
        useSettingsStore.setState({ flushSettings });
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const harness = settingsHarness(createSettings());

        const firstView = render(<PrivacyTab settings={harness.current()} setSettings={harness.setSettings} />);
        fireEvent.change(screen.getByPlaceholderText('Type keyword and press Enter...'), { target: { value: 'older' } });
        fireEvent.click(screen.getByText('Add'));
        expect(harness.current().maskedKeywords).toEqual(['older']);
        firstView.unmount();

        render(<PrivacyTab settings={harness.current()} setSettings={harness.setSettings} />);
        fireEvent.change(screen.getByPlaceholderText('Type keyword and press Enter...'), { target: { value: 'newer' } });
        fireEvent.click(screen.getByText('Add'));
        expect(harness.current().maskedKeywords).toEqual(['older', 'newer']);

        secondSave.resolve();
        await waitFor(() => expect(addToastMock).toHaveBeenCalledWith('Added "newer" to masked keywords', 'success'));
        firstSave.reject(new Error('older write failed'));
        await waitFor(() => expect(consoleError).toHaveBeenCalledWith(
            '[Privacy] Failed to persist privacy settings',
            expect.any(Error)
        ));

        expect(harness.current().maskedKeywords).toEqual(['older', 'newer']);
        expect(flushSettings).toHaveBeenCalledTimes(2);
        expect(addToastMock).not.toHaveBeenCalledWith('Added "older" to masked keywords', 'success');
        expect(addToastMock).not.toHaveBeenCalledWith('Failed to save "older" as a masked keyword', 'error');
        consoleError.mockRestore();
    });
});
