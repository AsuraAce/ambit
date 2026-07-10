import * as React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { OnboardingWizard } from '../OnboardingWizard';

interface ApiKeyProbeProps {
    value: string;
    onChange: (value: string) => void;
    onVerify: () => void;
    isVerifying: boolean;
    status: 'idle' | 'success' | 'error';
    error: string | null;
    isEnvKey: boolean;
    onTestEnvKey: () => void;
}

const apiKeyProbe = vi.hoisted(() => ({ props: null as ApiKeyProbeProps | null }));
const settingsMocks = vi.hoisted(() => ({
    state: { geminiApiKey: null as string | null, setGeminiApiKey: vi.fn() },
}));
const toastMocks = vi.hoisted(() => ({ addToast: vi.fn() }));
const geminiMocks = vi.hoisted(() => ({ verifyApiKey: vi.fn() }));

vi.mock('framer-motion', async () => {
    const ReactModule = await import('react');
    type MotionProps = React.HTMLAttributes<HTMLElement> & {
        initial?: unknown;
        animate?: unknown;
        exit?: unknown;
        transition?: unknown;
        whileHover?: unknown;
    };
    const createMotion = (tag: 'div' | 'label') => ({
        initial: _initial,
        animate: _animate,
        exit: _exit,
        transition: _transition,
        whileHover: _whileHover,
        ...props
    }: MotionProps) => ReactModule.createElement(tag, props);
    return {
        AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
        motion: {
            div: createMotion('div'),
            label: createMotion('label'),
        },
    };
});

vi.mock('../ApiKeyInput', () => ({
    ApiKeyInput: (props: ApiKeyProbeProps) => {
        apiKeyProbe.props = props;
        return <div data-testid="api-key-input">{props.status}:{props.error || ''}</div>;
    },
}));

vi.mock('../../../stores/settingsStore', () => ({
    useSettingsStore: () => settingsMocks.state,
}));

vi.mock('../../../hooks/useToast', () => ({
    useToast: () => toastMocks,
}));

vi.mock('../../../services/geminiService', () => geminiMocks);

const originalEnvKey = process.env.API_KEY;

const requireApiKeyProbe = (): ApiKeyProbeProps => {
    if (!apiKeyProbe.props) throw new Error('ApiKeyInput was not rendered');
    return apiKeyProbe.props;
};

const goNext = () => fireEvent.click(screen.getByRole('button', { name: /Next Step/i }));

const goToIntelligenceStep = () => {
    goNext();
    goNext();
    expect(screen.getByText('Intelligent Assistance')).toBeTruthy();
};

const goToPrivacyStep = () => {
    goToIntelligenceStep();
    goNext();
    expect(screen.getByText('Privacy & Control')).toBeTruthy();
};

const getIntelligenceToggle = (): HTMLElement => {
    const toggle = screen.getByText('Enable Intelligence Features').closest('[role="checkbox"]');
    if (!(toggle instanceof HTMLElement)) throw new Error('Missing intelligence toggle');
    return toggle;
};

describe('OnboardingWizard', () => {
    const onComplete = vi.fn();
    const onOpenSettings = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
        apiKeyProbe.props = null;
        settingsMocks.state.geminiApiKey = null;
        settingsMocks.state.setGeminiApiKey.mockResolvedValue(undefined);
        geminiMocks.verifyApiKey.mockResolvedValue({ valid: true });
        delete process.env.API_KEY;
    });

    afterAll(() => {
        if (originalEnvKey === undefined) delete process.env.API_KEY;
        else process.env.API_KEY = originalEnvKey;
    });

    it('renders nothing while closed', () => {
        const { container } = render(
            <OnboardingWizard isOpen={false} onComplete={onComplete} />,
        );
        expect(container.innerHTML).toBe('');
    });

    it('navigates between welcome and integrations and opens every integration setup', () => {
        render(
            <OnboardingWizard
                isOpen
                onComplete={onComplete}
                onOpenSettings={onOpenSettings}
            />,
        );
        expect(screen.getByText('Unified Asset Management.')).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();

        goNext();
        expect(screen.getByText('Workspace Integrations')).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: /InvokeAI/ }));
        fireEvent.keyDown(screen.getByRole('button', { name: /ComfyUI/ }), { key: 'Enter' });
        fireEvent.keyDown(screen.getByRole('button', { name: /SD WebUI/ }), { key: ' ' });
        fireEvent.keyDown(screen.getByRole('button', { name: /SD WebUI/ }), { key: 'Tab' });
        expect(onOpenSettings.mock.calls).toEqual([['invokeai'], ['comfyui'], ['a1111']]);

        fireEvent.click(screen.getByRole('button', { name: 'Back' }));
        expect(screen.getByText('Unified Asset Management.')).toBeTruthy();
    });

    it('keeps integration cards safe when no setup callback is supplied', () => {
        render(<OnboardingWizard isOpen onComplete={onComplete} />);
        goNext();

        fireEvent.click(screen.getByRole('button', { name: /InvokeAI/ }));
        fireEvent.keyDown(screen.getByRole('button', { name: /ComfyUI/ }), { key: 'Enter' });
        expect(onOpenSettings).not.toHaveBeenCalled();
    });

    it('toggles intelligence with pointer and keyboard controls', () => {
        render(<OnboardingWizard isOpen onComplete={onComplete} />);
        goToIntelligenceStep();
        const intelligenceToggle = getIntelligenceToggle();

        expect(intelligenceToggle.getAttribute('aria-checked')).toBe('false');
        fireEvent.keyDown(intelligenceToggle, { key: 'Tab' });
        expect(intelligenceToggle.getAttribute('aria-checked')).toBe('false');
        fireEvent.keyDown(intelligenceToggle, { key: 'Enter' });
        expect(screen.getByTestId('api-key-input')).toBeTruthy();
        fireEvent.keyDown(intelligenceToggle, { key: ' ' });
        expect(screen.queryByTestId('api-key-input')).toBeNull();

        const hiddenCheckbox = intelligenceToggle.querySelector('input[type="checkbox"]');
        if (!(hiddenCheckbox instanceof HTMLInputElement)) throw new Error('Missing intelligence checkbox');
        fireEvent.click(hiddenCheckbox);
        expect(screen.getByTestId('api-key-input')).toBeTruthy();
    });

    it('verifies edited and environment API keys and exposes loading and success state', async () => {
        let resolveVerification!: (result: { valid: boolean }) => void;
        geminiMocks.verifyApiKey.mockReturnValueOnce(new Promise(resolve => {
            resolveVerification = resolve;
        }));
        process.env.API_KEY = 'env-key';
        render(<OnboardingWizard isOpen onComplete={onComplete} />);
        goToIntelligenceStep();
        fireEvent.click(getIntelligenceToggle());

        expect(requireApiKeyProbe().isEnvKey).toBe(true);
        act(() => requireApiKeyProbe().onTestEnvKey());
        await waitFor(() => expect(geminiMocks.verifyApiKey).toHaveBeenCalledWith('env-key'));
        expect(requireApiKeyProbe().isVerifying).toBe(true);

        await act(async () => resolveVerification({ valid: true }));
        expect(requireApiKeyProbe().status).toBe('success');
        expect(requireApiKeyProbe().isVerifying).toBe(false);
        expect(toastMocks.addToast).toHaveBeenCalledWith('API Key verified successfully', 'success');

        delete process.env.API_KEY;
        act(() => requireApiKeyProbe().onChange('edited-key'));
        geminiMocks.verifyApiKey.mockResolvedValueOnce({ valid: true });
        await act(async () => requireApiKeyProbe().onTestEnvKey());
        expect(geminiMocks.verifyApiKey).toHaveBeenLastCalledWith('edited-key');

        act(() => requireApiKeyProbe().onChange(''));
        geminiMocks.verifyApiKey.mockClear();
        await act(async () => requireApiKeyProbe().onVerify());
        act(() => requireApiKeyProbe().onTestEnvKey());
        expect(geminiMocks.verifyApiKey).not.toHaveBeenCalled();
    });

    it('reports invalid verification results with explicit and fallback errors', async () => {
        render(<OnboardingWizard isOpen onComplete={onComplete} />);
        goToIntelligenceStep();
        fireEvent.click(getIntelligenceToggle());
        act(() => requireApiKeyProbe().onChange('bad-key'));

        geminiMocks.verifyApiKey.mockResolvedValueOnce({ valid: false, error: 'Rejected key' });
        await act(async () => requireApiKeyProbe().onVerify());
        expect(requireApiKeyProbe()).toMatchObject({ status: 'error', error: 'Rejected key' });
        expect(toastMocks.addToast).toHaveBeenCalledWith('Rejected key', 'error');

        geminiMocks.verifyApiKey.mockResolvedValueOnce({ valid: false });
        await act(async () => requireApiKeyProbe().onVerify());
        expect(requireApiKeyProbe()).toMatchObject({ status: 'error', error: 'Verification failed' });
        expect(toastMocks.addToast).toHaveBeenCalledWith('Verification failed', 'error');
    });

    it('reports thrown verification failures for Error and unknown values', async () => {
        render(<OnboardingWizard isOpen onComplete={onComplete} />);
        goToIntelligenceStep();
        fireEvent.click(getIntelligenceToggle());
        act(() => requireApiKeyProbe().onChange('key'));

        geminiMocks.verifyApiKey.mockRejectedValueOnce(new Error('Network failed'));
        await act(async () => requireApiKeyProbe().onVerify());
        expect(requireApiKeyProbe().error).toBe('Network failed');

        geminiMocks.verifyApiKey.mockRejectedValueOnce('bad response');
        await act(async () => requireApiKeyProbe().onVerify());
        expect(requireApiKeyProbe().error).toBe('Unknown error');
        expect(toastMocks.addToast).toHaveBeenCalledWith('Unknown error', 'error');
    });

    it('completes with default privacy settings when intelligence stays disabled', async () => {
        render(<OnboardingWizard isOpen onComplete={onComplete} />);
        goToPrivacyStep();

        const maskingSwitch = screen.getByRole('switch');
        fireEvent.keyDown(maskingSwitch, { key: 'Tab' });
        expect(maskingSwitch.getAttribute('aria-checked')).toBe('true');
        await act(async () => fireEvent.click(screen.getByRole('button', { name: /Launch Ambit/i })));

        expect(settingsMocks.state.setGeminiApiKey).not.toHaveBeenCalled();
        expect(onComplete).toHaveBeenCalledWith({
            enableAI: false,
            maskedKeywords: ['nsfw', 'nude', 'naked', 'blood', 'gore', 'violence'],
            maskingMode: 'blur',
            hasCompletedOnboarding: true,
        });
    });

    it('saves a trimmed key and respects privacy and startup choices', async () => {
        render(<OnboardingWizard isOpen onComplete={onComplete} />);
        goToIntelligenceStep();
        fireEvent.click(getIntelligenceToggle());
        act(() => requireApiKeyProbe().onChange('  saved-key  '));
        goNext();

        const maskingSwitch = screen.getByRole('switch');
        fireEvent.click(maskingSwitch);
        expect(maskingSwitch.getAttribute('aria-checked')).toBe('false');
        fireEvent.keyDown(maskingSwitch, { key: 'Enter' });
        expect(maskingSwitch.getAttribute('aria-checked')).toBe('true');
        fireEvent.keyDown(maskingSwitch, { key: ' ' });
        expect(maskingSwitch.getAttribute('aria-checked')).toBe('false');

        const startupToggle = screen.getByRole('checkbox', { name: /Start on Every Boot/i });
        fireEvent.keyDown(startupToggle, { key: 'Tab' });
        fireEvent.click(startupToggle);
        expect(startupToggle.getAttribute('aria-checked')).toBe('true');
        fireEvent.keyDown(startupToggle, { key: 'Enter' });
        expect(startupToggle.getAttribute('aria-checked')).toBe('false');
        fireEvent.keyDown(startupToggle, { key: ' ' });
        expect(startupToggle.getAttribute('aria-checked')).toBe('true');

        await act(async () => fireEvent.click(screen.getByRole('button', { name: /Launch Ambit/i })));

        expect(settingsMocks.state.setGeminiApiKey).toHaveBeenCalledWith('saved-key');
        expect(onComplete).toHaveBeenCalledWith({
            enableAI: true,
            maskedKeywords: [],
            maskingMode: 'blur',
            hasCompletedOnboarding: false,
        });
    });

    it('still completes when secure key persistence fails', async () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        settingsMocks.state.geminiApiKey = 'existing-key';
        settingsMocks.state.setGeminiApiKey.mockRejectedValueOnce(new Error('keyring unavailable'));
        render(<OnboardingWizard isOpen onComplete={onComplete} />);
        goToPrivacyStep();

        await act(async () => fireEvent.click(screen.getByRole('button', { name: /Launch Ambit/i })));

        expect(settingsMocks.state.setGeminiApiKey).toHaveBeenCalledWith('existing-key');
        expect(consoleError).toHaveBeenCalledWith(
            'Failed to save API key during onboarding:',
            expect.any(Error),
        );
        expect(onComplete).toHaveBeenCalledOnce();
        consoleError.mockRestore();
    });
});
