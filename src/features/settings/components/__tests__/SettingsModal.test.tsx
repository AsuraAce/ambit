import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '../../../../test/testUtils';
import type { AppSettings, AppSettingsUpdate } from '../../../../types';
import { SettingsModal } from '../SettingsModal';

vi.mock('../../../../hooks/useAppVersion', () => ({
    useAppVersion: () => 'test'
}));

const motionTestState = vi.hoisted(() => ({
    reduced: false,
    divProps: [] as Array<{
        initial?: unknown;
        animate?: unknown;
        exit?: unknown;
        transition?: unknown;
    }>,
}));

vi.mock('framer-motion', () => {
    type MotionDivProps = React.HTMLAttributes<HTMLDivElement> & {
        initial?: unknown;
        animate?: unknown;
        exit?: unknown;
        transition?: unknown;
    };

    const MotionDiv = React.forwardRef<HTMLDivElement, MotionDivProps>(({
        initial,
        animate,
        exit,
        transition,
        children,
        ...props
    }, ref) => {
        motionTestState.divProps.push({ initial, animate, exit, transition });
        return <div ref={ref} {...props}>{children}</div>;
    });
    MotionDiv.displayName = 'MotionDiv';

    return {
        AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
        motion: { div: MotionDiv },
        useReducedMotion: () => motionTestState.reduced,
    };
});
vi.mock('../DevTab', () => ({
    DevTab: () => <div>Dev panel</div>
}));

vi.mock('..', () => ({
    GeneralTab: ({ setSettings }: { setSettings: React.Dispatch<React.SetStateAction<AppSettings>> }) => (
        <div>
            <button
                type="button"
                onClick={() =>
                    setSettings(prev => ({
                        ...prev,
                        monitoredFolders: [
                            ...prev.monitoredFolders,
                            {
                                id: 'folder-1',
                                path: 'D:/AmbitFixtures/Linked',
                                isActive: true,
                                imageCount: 0,
                                initialScanPending: true
                            }
                        ]
                    }))
                }
            >
                Add folder update
            </button>
            <button
                type="button"
                onClick={() =>
                    setSettings(prev => ({
                        ...prev,
                        monitoredFolders: prev.monitoredFolders.map(folder =>
                            folder.id === 'folder-1'
                                ? { ...folder, initialScanPending: false, lastScanned: 123 }
                                : folder
                        )
                    }))
                }
            >
                Complete folder update
            </button>
        </div>
    ),
    PrivacyTab: () => null,
    IntelligenceTab: () => null,
    AdvancedTab: () => <div>Advanced panel</div>,
    ConnectionsTab: () => null
}));

const createSettings = (): AppSettings => ({
    hasCompletedOnboarding: true,
    theme: 'dark',
    thumbnailSize: 200,
    confirmDelete: true,
    defaultTheaterMode: false,
    monitoredFolders: [],
    promptMaskingEnabled: true,
    maskedKeywords: [],
    maskingMode: 'blur',
    enableAI: false
});

describe('SettingsModal', () => {
    beforeEach(() => {
        motionTestState.reduced = false;
        motionTestState.divProps.length = 0;
    });
    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it('forwards functional settings updates so async follow-up updates use latest settings', () => {
        const onSave = vi.fn<(update: AppSettingsUpdate) => void>();
        const initialSettings = createSettings();

        render(
            <SettingsModal
                isOpen={true}
                onClose={vi.fn()}
                settings={initialSettings}
                onSave={onSave}
                canCheckForUpdates={false}
                hasPendingUpdate={false}
                pendingUpdateVersion={null}
                updateErrorMessage={null}
                updateStatus="idle"
                onCheckForUpdates={vi.fn()}
                onOpenUpdatePrompt={vi.fn()}
                onNavigateToMaintenance={vi.fn()}
            />
        );

        fireEvent.click(screen.getByRole('button', { name: 'Add folder update' }));
        fireEvent.click(screen.getByRole('button', { name: 'Complete folder update' }));

        expect(onSave).toHaveBeenCalledTimes(2);
        expect(typeof onSave.mock.calls[0][0]).toBe('function');
        expect(typeof onSave.mock.calls[1][0]).toBe('function');

        const addUpdate = onSave.mock.calls[0][0] as (previous: AppSettings) => Partial<AppSettings>;
        const completeUpdate = onSave.mock.calls[1][0] as (previous: AppSettings) => Partial<AppSettings>;
        const afterAdd = { ...initialSettings, ...addUpdate(initialSettings) };
        const afterComplete = { ...afterAdd, ...completeUpdate(afterAdd) };

        expect(afterComplete.monitoredFolders).toHaveLength(1);
        expect(afterComplete.monitoredFolders[0]).toMatchObject({
            id: 'folder-1',
            path: 'D:/AmbitFixtures/Linked',
            initialScanPending: false,
            lastScanned: 123
        });
    });

    it('claims focus on its named close control when opened', () => {
        render(
            <SettingsModal
                isOpen={true}
                onClose={vi.fn()}
                settings={createSettings()}
                onSave={vi.fn()}
                canCheckForUpdates={false}
                hasPendingUpdate={false}
                pendingUpdateVersion={null}
                updateErrorMessage={null}
                updateStatus="idle"
                onCheckForUpdates={vi.fn()}
                onOpenUpdatePrompt={vi.fn()}
                onNavigateToMaintenance={vi.fn()}
            />
        );

        expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close Settings' }));
    });

    it('uses amethyst for the active Intelligence navigation icon', () => {
        render(
            <SettingsModal
                isOpen={true}
                onClose={vi.fn()}
                settings={createSettings()}
                onSave={vi.fn()}
                canCheckForUpdates={false}
                hasPendingUpdate={false}
                pendingUpdateVersion={null}
                updateErrorMessage={null}
                updateStatus="idle"
                onCheckForUpdates={vi.fn()}
                onOpenUpdatePrompt={vi.fn()}
                onNavigateToMaintenance={vi.fn()}
            />
        );

        const intelligence = screen.getByRole('button', { name: 'Intelligence' });
        fireEvent.click(intelligence);
        expect(intelligence.querySelector('svg')?.parentElement?.className).toContain('text-amethyst-300');
    });
    it('removes modal scale motion when reduced motion is requested', () => {
        motionTestState.reduced = true;

        render(
            <SettingsModal
                isOpen={true}
                onClose={vi.fn()}
                settings={createSettings()}
                onSave={vi.fn()}
                canCheckForUpdates={false}
                hasPendingUpdate={false}
                pendingUpdateVersion={null}
                updateErrorMessage={null}
                updateStatus="idle"
                onCheckForUpdates={vi.fn()}
                onOpenUpdatePrompt={vi.fn()}
                onNavigateToMaintenance={vi.fn()}
            />
        );

        expect(motionTestState.divProps).toHaveLength(2);
        for (const props of motionTestState.divProps) {
            expect(props.initial).toEqual({ opacity: 0 });
            expect(props.animate).toEqual({ opacity: 1 });
            expect(props.exit).toEqual({ opacity: 0 });
            expect(props.transition).toEqual({ duration: 0 });
        }
    });
    it('limits category navigation transitions to color changes', () => {
        render(
            <SettingsModal
                isOpen={true}
                onClose={vi.fn()}
                settings={createSettings()}
                onSave={vi.fn()}
                canCheckForUpdates={false}
                hasPendingUpdate={false}
                pendingUpdateVersion={null}
                updateErrorMessage={null}
                updateStatus="idle"
                onCheckForUpdates={vi.fn()}
                onOpenUpdatePrompt={vi.fn()}
                onNavigateToMaintenance={vi.fn()}
            />
        );

        for (const name of ['General', 'Connections', 'Intelligence', 'Privacy', 'Advanced']) {
            const category = screen.getByRole('button', { name });
            expect(category.className).toContain('transition-colors');
            expect(category.className).not.toContain('transition-all');
            expect(category.className).toContain('focus:outline-none');
            expect(category.className).toContain('focus-visible:ring-2');
        }

        fireEvent.click(screen.getByRole('button', { name: 'Connections' }));
        expect(screen.getByRole('heading', { name: 'Connections' })).toBeTruthy();
    });
    it('reserves a transparent border so category selection cannot flash the theme default', () => {
        render(
            <SettingsModal
                isOpen={true}
                onClose={vi.fn()}
                settings={createSettings()}
                onSave={vi.fn()}
                canCheckForUpdates={false}
                hasPendingUpdate={false}
                pendingUpdateVersion={null}
                updateErrorMessage={null}
                updateStatus="idle"
                onCheckForUpdates={vi.fn()}
                onOpenUpdatePrompt={vi.fn()}
                onNavigateToMaintenance={vi.fn()}
            />
        );

        const general = screen.getByRole('button', { name: 'General' });
        const connections = screen.getByRole('button', { name: 'Connections' });

        expect(general.className.split(/\s+/)).toEqual(expect.arrayContaining(['border', 'border-white/10']));
        expect(connections.className.split(/\s+/)).toEqual(expect.arrayContaining(['border', 'border-transparent']));

        fireEvent.click(connections);

        expect(general.className.split(/\s+/)).toEqual(expect.arrayContaining(['border', 'border-transparent']));
        expect(connections.className.split(/\s+/)).toEqual(expect.arrayContaining(['border', 'border-white/10']));
    });
    it('renders its normal dark blurred backdrop by default', () => {
        render(
            <SettingsModal
                isOpen={true}
                onClose={vi.fn()}
                settings={createSettings()}
                onSave={vi.fn()}
                canCheckForUpdates={false}
                hasPendingUpdate={false}
                pendingUpdateVersion={null}
                updateErrorMessage={null}
                updateStatus="idle"
                onCheckForUpdates={vi.fn()}
                onOpenUpdatePrompt={vi.fn()}
                onNavigateToMaintenance={vi.fn()}
            />
        );

        const modalLayer = screen.getByRole('button', { name: 'Close Settings' }).closest('.fixed');

        expect(modalLayer).not.toBeNull();
        expect(modalLayer?.className).toContain('bg-black/60');
        expect(modalLayer?.className).toContain('dark:bg-black/80');
        expect(modalLayer?.className).toContain('backdrop-blur-sm');
        expect(modalLayer?.className).not.toContain('bg-transparent');
    });

    it('uses the onboarding-owned backdrop without adding another tint or blur', () => {
        const launcher = document.createElement('button');
        document.body.append(launcher);
        launcher.focus();
        const onClose = vi.fn();
        const modalProps = {
            onClose,
            hasExternalBackdrop: true,
            settings: createSettings(),
            onSave: vi.fn(),
            canCheckForUpdates: false,
            hasPendingUpdate: false,
            pendingUpdateVersion: null,
            updateErrorMessage: null,
            updateStatus: 'idle' as const,
            onCheckForUpdates: vi.fn(),
            onOpenUpdatePrompt: vi.fn(),
            onNavigateToMaintenance: vi.fn(),
        };
        const { rerender } = render(<SettingsModal isOpen={true} {...modalProps} />);

        const closeButton = screen.getByRole('button', { name: 'Close Settings' });
        const modalLayer = closeButton.closest('.fixed');

        expect(modalLayer).not.toBeNull();
        expect(modalLayer?.className).toContain('bg-transparent');
        expect(modalLayer?.className).not.toContain('bg-black/60');
        expect(modalLayer?.className).not.toContain('dark:bg-black/80');
        expect(modalLayer?.className).not.toContain('backdrop-blur-sm');
        expect(document.activeElement).toBe(closeButton);

        fireEvent.click(modalLayer as Element);
        expect(onClose).toHaveBeenCalledOnce();

        rerender(<SettingsModal isOpen={false} {...modalProps} />);
        expect(document.activeElement).toBe(launcher);
        launcher.remove();
    });

    it('restores focus to the launcher when closed', () => {
        const launcher = document.createElement('button');
        document.body.append(launcher);
        launcher.focus();
        const modalProps = {
            onClose: vi.fn(),
            settings: createSettings(),
            onSave: vi.fn(),
            canCheckForUpdates: false,
            hasPendingUpdate: false,
            pendingUpdateVersion: null,
            updateErrorMessage: null,
            updateStatus: 'idle' as const,
            onCheckForUpdates: vi.fn(),
            onOpenUpdatePrompt: vi.fn(),
            onNavigateToMaintenance: vi.fn(),
        };
        const { rerender } = render(<SettingsModal isOpen={true} {...modalProps} />);

        expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close Settings' }));

        rerender(<SettingsModal isOpen={false} {...modalProps} />);

        expect(document.activeElement).toBe(launcher);
        launcher.remove();
    });

    it('does not attempt to restore focus to a non-HTML element', () => {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('tabindex', '0');
        document.body.append(svg);
        svg.focus();
        const modalProps = {
            onClose: vi.fn(),
            settings: createSettings(),
            onSave: vi.fn(),
            canCheckForUpdates: false,
            hasPendingUpdate: false,
            pendingUpdateVersion: null,
            updateErrorMessage: null,
            updateStatus: 'idle' as const,
            onCheckForUpdates: vi.fn(),
            onOpenUpdatePrompt: vi.fn(),
            onNavigateToMaintenance: vi.fn(),
        };
        const { rerender } = render(<SettingsModal isOpen={true} {...modalProps} />);

        rerender(<SettingsModal isOpen={false} {...modalProps} />);

        expect(document.activeElement).not.toBe(svg);
        svg.remove();
    });

    it('loads the Dev Tools panel only after selecting it in dev builds', async () => {
        vi.stubEnv('DEV', true);

        render(
            <SettingsModal
                isOpen={true}
                onClose={vi.fn()}
                settings={createSettings()}
                onSave={vi.fn()}
                canCheckForUpdates={false}
                hasPendingUpdate={false}
                pendingUpdateVersion={null}
                updateErrorMessage={null}
                updateStatus="idle"
                onCheckForUpdates={vi.fn()}
                onOpenUpdatePrompt={vi.fn()}
                onNavigateToMaintenance={vi.fn()}
            />
        );

        fireEvent.click(screen.getByRole('button', { name: /dev tools/i }));

        expect(await screen.findByText('Dev panel')).not.toBeNull();
    });

    it('hides the Dev Tools tab in production builds', () => {
        vi.stubEnv('DEV', false);

        render(
            <SettingsModal
                isOpen={true}
                onClose={vi.fn()}
                settings={createSettings()}
                onSave={vi.fn()}
                canCheckForUpdates={true}
                hasPendingUpdate={false}
                pendingUpdateVersion={null}
                updateErrorMessage={null}
                updateStatus="idle"
                onCheckForUpdates={vi.fn()}
                onOpenUpdatePrompt={vi.fn()}
                onNavigateToMaintenance={vi.fn()}
            />
        );

        expect(screen.queryByRole('button', { name: /dev tools/i })).toBeNull();
    });

    it('falls back to Advanced when initialTab is dev in production builds', () => {
        vi.stubEnv('DEV', false);

        render(
            <SettingsModal
                isOpen={true}
                onClose={vi.fn()}
                settings={createSettings()}
                onSave={vi.fn()}
                canCheckForUpdates={true}
                initialTab="dev"
                hasPendingUpdate={false}
                pendingUpdateVersion={null}
                updateErrorMessage={null}
                updateStatus="idle"
                onCheckForUpdates={vi.fn()}
                onOpenUpdatePrompt={vi.fn()}
                onNavigateToMaintenance={vi.fn()}
            />
        );

        expect(screen.getByText('Advanced panel')).not.toBeNull();
        expect(screen.queryByText('Dev panel')).toBeNull();
    });
});
