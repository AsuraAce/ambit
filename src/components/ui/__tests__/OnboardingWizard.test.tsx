import * as React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '../../../test/testUtils';
import { DEFAULT_APP_SETTINGS } from '../../../constants/defaultSettings';
import type { AppSettings } from '../../../types';
import { OnboardingWizard } from '../OnboardingWizard';

const mocks = vi.hoisted(() => ({
    addToast: vi.fn(),
    setGeminiApiKey: vi.fn(),
    verifyApiKey: vi.fn(),
    state: {
        settings: null as unknown as AppSettings,
        geminiApiKey: null as string | null,
    },
}));

vi.mock('framer-motion', () => {
    type MotionDivProps = React.HTMLAttributes<HTMLDivElement> & {
        initial?: unknown;
        animate?: unknown;
        exit?: unknown;
        transition?: unknown;
        onAnimationComplete?: () => void;
    };
    type MotionButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
        whileHover?: unknown;
    };
    type MotionSpanProps = React.HTMLAttributes<HTMLSpanElement> & {
        animate?: unknown;
    };

    const MotionDiv = ({ initial, animate: _animate, exit: _exit, transition: _transition, onAnimationComplete, ...props }: MotionDivProps) => {
        const initialY = typeof initial === 'object' && initial !== null && 'y' in initial
            ? (initial as { y?: unknown }).y
            : undefined;

        React.useEffect(() => {
            onAnimationComplete?.();
        }, [onAnimationComplete]);

        return <div data-motion-initial-y={typeof initialY === 'number' ? initialY : undefined} {...props} />;
    };
    const MotionButton = ({ whileHover: _whileHover, ...props }: MotionButtonProps) => <button {...props} />;
    const MotionSpan = ({ animate: _animate, ...props }: MotionSpanProps) => <span {...props} />;

    return {
        AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
        motion: {
            button: MotionButton,
            div: MotionDiv,
            span: MotionSpan,
        },
    };
});

vi.mock('../../../hooks/useToast', () => ({
    useToast: () => ({ addToast: mocks.addToast }),
}));

vi.mock('../../../stores/settingsStore', () => ({
    useSettingsStore: (selector: (state: {
        settings: AppSettings;
        geminiApiKey: string | null;
        setGeminiApiKey: typeof mocks.setGeminiApiKey;
    }) => unknown) => selector({
        ...mocks.state,
        setGeminiApiKey: mocks.setGeminiApiKey,
    }),
}));

vi.mock('../../../services/geminiService', () => ({
    verifyApiKey: mocks.verifyApiKey,
}));

const renderWizard = () => {
    const onComplete = vi.fn();
    const onOpenSettings = vi.fn();

    const result = render(
        <OnboardingWizard
            isOpen={true}
            onComplete={onComplete}
            onOpenSettings={onOpenSettings}
        />
    );

    return { onComplete, onOpenSettings, unmount: result.unmount };
};

const continueToIntelligence = () => {
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
};

describe('OnboardingWizard', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.unstubAllEnvs();
        vi.stubEnv('API_KEY', '');
        mocks.state.settings = { ...DEFAULT_APP_SETTINGS };
        mocks.state.geminiApiKey = null;
        mocks.setGeminiApiKey.mockResolvedValue(undefined);
        mocks.verifyApiKey.mockResolvedValue({ valid: true });
    });

    it('renders a labelled modal with announced progress and focuses the current heading', () => {
        renderWizard();

        expect(screen.getByRole('dialog').getAttribute('aria-modal')).toBe('true');
        expect(screen.getByRole('list', { name: 'Onboarding progress' })).not.toBeNull();

        const heading = screen.getByRole('heading', { name: 'Organize your AI image library' });
        expect(document.activeElement).toBe(heading);
        expect(screen.getByText('Welcome').closest('li')?.getAttribute('aria-current')).toBe('step');
    });

    it('clips animated step overflow while retaining vertical scrolling', () => {
        renderWizard();

        const scrollRegion = screen.getByTestId('onboarding-step-scroll-region');
        expect(scrollRegion.className).toContain('overflow-x-hidden');
        expect(scrollRegion.className).toContain('overflow-y-auto');
    });

    it('keeps forward and reverse tab navigation inside the dialog', () => {
        renderWizard();
        fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

        const heading = screen.getByRole('heading', { name: 'Connect your generators' });
        const firstControl = screen.getByText('InvokeAI').closest('button');
        const lastControl = screen.getByRole('button', { name: 'Continue' });
        expect(firstControl).not.toBeNull();
        if (!firstControl) throw new Error('InvokeAI setup button not found');

        heading.focus();
        fireEvent.keyDown(heading, { key: 'Tab' });
        expect(document.activeElement).toBe(firstControl);

        heading.focus();
        fireEvent.keyDown(heading, { key: 'Tab', shiftKey: true });
        expect(document.activeElement).toBe(lastControl);

        lastControl.focus();
        fireEvent.keyDown(lastControl, { key: 'Tab' });
        expect(document.activeElement).toBe(firstControl);

        firstControl.focus();
        fireEvent.keyDown(firstControl, { key: 'Tab', shiftKey: true });
        expect(document.activeElement).toBe(lastControl);
    });

    it('exposes visible generator actions and routes generic folders to Connections', () => {
        const { onOpenSettings } = renderWizard();
        fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

        expect(screen.getAllByText('Set up →')).toHaveLength(3);
        fireEvent.click(screen.getByRole('button', { name: 'Add another image folder' }));

        expect(onOpenSettings).toHaveBeenCalledWith('folders');
    });

    it('routes each generator action and remains safe without a Settings callback', () => {
        const { onOpenSettings, unmount } = renderWizard();
        fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
        fireEvent.click(screen.getByText('InvokeAI').closest('button')!);
        fireEvent.click(screen.getByText('ComfyUI').closest('button')!);
        fireEvent.click(screen.getByText('SD WebUI').closest('button')!);
        expect(onOpenSettings.mock.calls).toEqual([['invokeai'], ['comfyui'], ['a1111']]);

        unmount();
        render(<OnboardingWizard isOpen={true} onComplete={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
        fireEvent.click(screen.getByText('InvokeAI').closest('button')!);
        fireEvent.click(screen.getByText('ComfyUI').closest('button')!);
        fireEvent.click(screen.getByText('SD WebUI').closest('button')!);
        fireEvent.click(screen.getByRole('button', { name: 'Add another image folder' }));
    });

    it('renders no backdrop when closed unless backdrop preservation is requested', () => {
        render(<OnboardingWizard isOpen={false} onComplete={vi.fn()} />);
        expect(screen.queryByTestId('onboarding-backdrop')).toBeNull();
    });

    it('keeps focus on the dialog when no focusable descendants are available', () => {
        renderWizard();
        const dialog = screen.getByRole('dialog');
        const emptyNodes = document.createDocumentFragment().querySelectorAll<HTMLElement>('button');
        vi.spyOn(dialog, 'querySelectorAll').mockReturnValue(emptyNodes);

        fireEvent.keyDown(dialog, { key: 'Escape' });
        fireEvent.keyDown(dialog, { key: 'Tab' });

        expect(document.activeElement).toBe(dialog);
    });

    it('handles non-HTML prior focus and middle-control tab navigation', () => {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        const priorFocusSpy = vi.spyOn(document, 'activeElement', 'get').mockReturnValue(svg);
        const { unmount } = renderWizard();
        priorFocusSpy.mockRestore();
        fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
        const middleControl = screen.getByText('ComfyUI').closest('button');
        if (!middleControl) throw new Error('ComfyUI setup button not found');
        middleControl.focus();

        fireEvent.keyDown(middleControl, { key: 'Tab' });
        expect(document.activeElement).toBe(middleControl);

        fireEvent.click(screen.getByRole('button', { name: 'Back' }));
        expect(screen.getByRole('heading', { name: 'Organize your AI image library' })).not.toBeNull();

        const activeElementSpy = vi.spyOn(document, 'activeElement', 'get').mockReturnValue(svg);
        fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Tab' });
        activeElementSpy.mockRestore();
        unmount();
    });

    it('enables AI from an environment key without requiring a stored key', () => {
        vi.stubEnv('API_KEY', 'environment-key');
        mocks.state.settings = { ...DEFAULT_APP_SETTINGS, enableAI: true };
        renderWizard();
        continueToIntelligence();

        expect(screen.getByRole('switch', { name: 'Enable AI features' }).getAttribute('aria-checked')).toBe('true');
    });

    it('preserves the current step while Settings temporarily hides the wizard', () => {
        const props = {
            onComplete: vi.fn(),
            onOpenSettings: vi.fn(),
            preserveBackdropWhenClosed: true,
        };
        const { rerender } = render(
            <OnboardingWizard isOpen={true} {...props} />
        );
        fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
        expect(screen.getByRole('heading', { name: 'Connect your generators' })).not.toBeNull();

        rerender(<OnboardingWizard isOpen={false} {...props} />);
        expect(screen.queryByRole('dialog')).toBeNull();
        expect(screen.queryByRole('button', { name: 'Continue' })).toBeNull();
        expect(screen.getByTestId('onboarding-backdrop').getAttribute('aria-hidden')).toBe('true');

        rerender(<OnboardingWizard isOpen={true} {...props} />);
        const heading = screen.getByRole('heading', { name: 'Connect your generators' });
        expect(screen.queryByTestId('onboarding-backdrop')).toBeNull();
        expect(document.activeElement).toBe(heading);
    });

    it('does not translate the Gemini panel vertically inside the scroll region', () => {
        renderWizard();
        continueToIntelligence();

        fireEvent.click(screen.getByRole('switch', { name: 'Enable AI features' }));

        expect(document.querySelector('[data-motion-initial-y="10"]')).toBeNull();
    });

    it('completes with AI disabled and prompt masking enabled by default', () => {
        const { onComplete } = renderWizard();
        continueToIntelligence();
        fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
        fireEvent.click(screen.getByRole('button', { name: 'Finish setup' }));

        expect(onComplete).toHaveBeenCalledWith({
            enableAI: false,
            promptMaskingEnabled: true,
            maskingMode: 'blur',
            hasCompletedOnboarding: true,
        });
    });

    it('requires a new enabled key to verify and save before continuing', async () => {
        renderWizard();
        continueToIntelligence();

        fireEvent.click(screen.getByRole('switch', { name: 'Enable AI features' }));
        const continueButton = screen.getByRole('button', { name: 'Continue' });
        expect((continueButton as HTMLButtonElement).disabled).toBe(true);

        fireEvent.change(screen.getByLabelText('Gemini API key'), { target: { value: 'new-key' } });
        fireEvent.click(screen.getByRole('button', { name: 'Verify' }));

        await waitFor(() => {
            expect(mocks.verifyApiKey).toHaveBeenCalledWith('new-key');
            expect(mocks.setGeminiApiKey).toHaveBeenCalledWith('new-key');
            expect((continueButton as HTMLButtonElement).disabled).toBe(false);
            expect(screen.getByRole('status').textContent).toContain('API key verified and saved');
            expect((screen.getByRole('button', { name: 'Verified' }) as HTMLButtonElement).disabled).toBe(true);
        });
    });

    it('prevents leaving AI setup while verification or secure storage is pending', async () => {
        let finishStorage: (() => void) | undefined;
        mocks.setGeminiApiKey.mockReturnValueOnce(new Promise<void>(resolve => {
            finishStorage = resolve;
        }));
        renderWizard();
        continueToIntelligence();

        const aiSwitch = screen.getByRole('switch', { name: 'Enable AI features' });
        fireEvent.click(aiSwitch);
        fireEvent.change(screen.getByLabelText('Gemini API key'), { target: { value: 'new-key' } });
        fireEvent.click(screen.getByRole('button', { name: 'Verify' }));

        await waitFor(() => {
            expect(mocks.setGeminiApiKey).toHaveBeenCalledWith('new-key');
        });

        const backButton = screen.getByRole('button', { name: 'Back' }) as HTMLButtonElement;
        const deferButton = screen.getByRole('button', { name: 'Set up later' }) as HTMLButtonElement;
        expect((aiSwitch as HTMLButtonElement).disabled).toBe(true);
        expect(backButton.disabled).toBe(true);
        expect(deferButton.disabled).toBe(true);

        fireEvent.click(aiSwitch);
        fireEvent.click(backButton);
        fireEvent.click(deferButton);

        expect(aiSwitch.getAttribute('aria-checked')).toBe('true');
        expect(screen.getByRole('heading', { name: 'Optional Gemini features' })).not.toBeNull();
        expect(screen.queryByRole('heading', { name: 'Privacy & control' })).toBeNull();

        finishStorage?.();
        await waitFor(() => {
            expect(screen.getByRole('status').textContent).toContain('API key verified and saved');
            expect(screen.queryByRole('button', { name: 'Set up later' })).toBeNull();
            expect((aiSwitch as HTMLButtonElement).disabled).toBe(false);
            expect(backButton.disabled).toBe(false);
        });
    });

    it('keeps the user on Intelligence when Gemini rejects the key', async () => {
        mocks.verifyApiKey.mockResolvedValueOnce({ valid: false, error: 'Invalid API key' });
        renderWizard();
        continueToIntelligence();

        fireEvent.click(screen.getByRole('switch', { name: 'Enable AI features' }));
        fireEvent.change(screen.getByLabelText('Gemini API key'), { target: { value: 'invalid-key' } });
        fireEvent.click(screen.getByRole('button', { name: 'Verify' }));

        expect((await screen.findByRole('alert')).textContent).toContain('Invalid API key');
        expect(mocks.setGeminiApiKey).not.toHaveBeenCalled();
        expect(screen.getByRole('heading', { name: 'Optional Gemini features' })).not.toBeNull();
        expect((screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement).disabled).toBe(true);
    });

    it('uses fallback messages for rejection and non-Error storage failures', async () => {
        mocks.verifyApiKey.mockResolvedValueOnce({ valid: false });
        const first = renderWizard();
        continueToIntelligence();
        fireEvent.click(screen.getByRole('switch', { name: 'Enable AI features' }));
        fireEvent.change(screen.getByLabelText('Gemini API key'), { target: { value: 'invalid-key' } });
        fireEvent.click(screen.getByRole('button', { name: 'Verify' }));
        expect((await screen.findByRole('alert')).textContent).toContain('Verification failed');

        first.unmount();
        mocks.verifyApiKey.mockResolvedValueOnce({ valid: true });
        mocks.setGeminiApiKey.mockRejectedValueOnce('keyring unavailable');
        renderWizard();
        continueToIntelligence();
        fireEvent.click(screen.getByRole('switch', { name: 'Enable AI features' }));
        fireEvent.change(screen.getByLabelText('Gemini API key'), { target: { value: 'new-key' } });
        fireEvent.click(screen.getByRole('button', { name: 'Verify' }));
        expect((await screen.findByRole('alert')).textContent).toContain('Unknown error');
    });

    it('keeps the user on Intelligence when secure key storage fails', async () => {
        mocks.setGeminiApiKey.mockRejectedValueOnce(new Error('Keyring unavailable'));
        renderWizard();
        continueToIntelligence();

        fireEvent.click(screen.getByRole('switch', { name: 'Enable AI features' }));
        fireEvent.change(screen.getByLabelText('Gemini API key'), { target: { value: 'new-key' } });
        fireEvent.click(screen.getByRole('button', { name: 'Verify' }));

        expect((await screen.findByRole('alert')).textContent).toContain('Keyring unavailable');
        expect(screen.getByRole('heading', { name: 'Optional Gemini features' })).not.toBeNull();
        expect((screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement).disabled).toBe(true);
    });

    it('accepts an existing stored key without forcing reverification', () => {
        mocks.state.settings = { ...DEFAULT_APP_SETTINGS, enableAI: true };
        mocks.state.geminiApiKey = 'stored-key';
        renderWizard();
        continueToIntelligence();

        expect(screen.getByRole('switch', { name: 'Enable AI features' }).getAttribute('aria-checked')).toBe('true');
        expect(screen.getByRole('status').textContent).toContain('API key configured');
        expect(screen.getByRole('button', { name: 'Re-verify' })).not.toBeNull();
        expect((screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement).disabled).toBe(false);

        fireEvent.change(screen.getByLabelText('Gemini API key'), { target: { value: 'replacement-key' } });

        expect(screen.queryByText('API key configured')).toBeNull();
        expect(screen.getByRole('button', { name: 'Verify' })).not.toBeNull();
        expect((screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement).disabled).toBe(true);
    });

    it('lets the user defer Gemini setup without deleting an existing key', () => {
        renderWizard();
        continueToIntelligence();
        fireEvent.click(screen.getByRole('switch', { name: 'Enable AI features' }));

        fireEvent.click(screen.getByRole('button', { name: 'Set up later' }));

        expect(screen.getByRole('heading', { name: 'Privacy & control' })).not.toBeNull();
        expect(mocks.setGeminiApiKey).not.toHaveBeenCalled();
    });

    it('requires environment keys to verify without claiming Ambit saves them', async () => {
        vi.stubEnv('API_KEY', 'environment-key');
        mocks.state.settings = { ...DEFAULT_APP_SETTINGS, enableAI: true };
        mocks.state.geminiApiKey = 'environment-key';
        renderWizard();
        continueToIntelligence();

        expect(screen.getByText(/Ambit reads this API key from your environment and does not save it/)).not.toBeNull();
        expect(screen.getByText(/Gemini requests are handled by Google/)).not.toBeNull();
        expect(screen.getByText(/A free tier is available for eligible accounts and regions/)).not.toBeNull();
        expect(screen.queryByText(/Stored in your OS keyring/)).toBeNull();
        expect(screen.queryByText('API key configured')).toBeNull();

        const continueButton = screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement;
        expect(continueButton.disabled).toBe(true);

        fireEvent.click(screen.getByRole('button', { name: 'Test environment key' }));

        await waitFor(() => {
            expect(mocks.verifyApiKey).toHaveBeenCalledWith('environment-key');
            expect(screen.getByRole('status').textContent).toContain('Environment API key verified');
            expect(continueButton.disabled).toBe(false);
        });
        expect(mocks.setGeminiApiKey).not.toHaveBeenCalled();
    });

    it('retains keyring wording for keys entered through Ambit', () => {
        renderWizard();
        continueToIntelligence();
        fireEvent.click(screen.getByRole('switch', { name: 'Enable AI features' }));

        expect(screen.getByText(/Stored in your OS keyring/)).not.toBeNull();
        expect(screen.queryByText(/reads this API key from your environment/)).toBeNull();
    });

    it('does not restore focus behind the next modal after completion', () => {
        const previousControl = document.createElement('button');
        document.body.append(previousControl);
        previousControl.focus();
        const { unmount } = renderWizard();
        continueToIntelligence();
        fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
        fireEvent.click(screen.getByRole('button', { name: 'Finish setup' }));

        unmount();

        expect(document.activeElement).not.toBe(previousControl);
    });

    it('exposes prompt keyword masking as a named switch', () => {
        const { onComplete } = renderWizard();
        continueToIntelligence();
        fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

        const maskingSwitch = screen.getByRole('switch', { name: 'Enable prompt keyword masking' });
        const thumb = maskingSwitch.querySelector('[aria-hidden="true"]');
        expect(maskingSwitch.getAttribute('aria-checked')).toBe('true');
        expect(thumb?.className).toContain('left-1');
        expect(thumb?.className).toContain('translate-x-7');

        fireEvent.click(maskingSwitch);
        expect(maskingSwitch.getAttribute('aria-checked')).toBe('false');
        expect(thumb?.className).toContain('translate-x-0');
        fireEvent.click(screen.getByRole('button', { name: 'Finish setup' }));
        expect(onComplete).toHaveBeenCalledWith(expect.objectContaining({ promptMaskingEnabled: false }));
        expect(onComplete.mock.calls[0][0]).not.toHaveProperty('maskedKeywords');
    });

    it('preserves custom masking keywords when onboarding is restarted with masking enabled', () => {
        mocks.state.settings = { ...DEFAULT_APP_SETTINGS, maskedKeywords: ['custom', 'private'] };
        const { onComplete } = renderWizard();
        continueToIntelligence();
        fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

        expect(screen.getByRole('switch', { name: 'Enable prompt keyword masking' }).getAttribute('aria-checked')).toBe('true');
        fireEvent.click(screen.getByRole('button', { name: 'Finish setup' }));

        expect(onComplete).toHaveBeenCalledWith(expect.objectContaining({ promptMaskingEnabled: true }));
        expect(mocks.state.settings.maskedKeywords).toEqual(['custom', 'private']);
    });

    it('enables an empty keyword list without seeding defaults', () => {
        mocks.state.settings = { ...DEFAULT_APP_SETTINGS, promptMaskingEnabled: false, maskedKeywords: [] };
        const { onComplete } = renderWizard();
        continueToIntelligence();
        fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

        const maskingSwitch = screen.getByRole('switch', { name: 'Enable prompt keyword masking' });
        expect(maskingSwitch.getAttribute('aria-checked')).toBe('false');
        fireEvent.click(maskingSwitch);
        fireEvent.click(screen.getByRole('button', { name: 'Finish setup' }));

        expect(onComplete).toHaveBeenCalledWith(expect.objectContaining({ promptMaskingEnabled: true }));
        expect(onComplete.mock.calls[0][0]).not.toHaveProperty('maskedKeywords');
        expect(mocks.state.settings.maskedKeywords).toEqual([]);
    });
});
