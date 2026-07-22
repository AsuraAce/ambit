import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '../../../../test/testUtils';
import type { AppSettings, AiThinkingMode } from '../../../../types';
import { IntelligenceTab } from '../IntelligenceTab';

const addToastMock = vi.hoisted(() => vi.fn());
const setGeminiApiKeyMock = vi.hoisted(() => vi.fn());
const verifyApiKeyMock = vi.hoisted(() => vi.fn());
interface ApiKeyInputProps {
    value: string;
    onChange: (value: string) => void;
    onVerify: () => Promise<void>;
    isVerifying: boolean;
    status: 'idle' | 'success' | 'error';
    error: string | null;
    isEnvKey: boolean;
    onTestEnvKey: () => void;
}
const apiKeyCapture = vi.hoisted(() => ({ current: null as ApiKeyInputProps | null }));
const settingsStoreMock = vi.hoisted(() => ({ geminiApiKey: null as string | null }));

vi.mock('../../../../hooks/useToast', () => ({
    useToast: () => ({
        addToast: addToastMock,
    }),
}));

vi.mock('../../../../stores/settingsStore', () => ({
    useSettingsStore: () => ({
        geminiApiKey: settingsStoreMock.geminiApiKey,
        setGeminiApiKey: setGeminiApiKeyMock,
    }),
}));

vi.mock('../../../../components/ui/ApiKeyInput', () => ({
    ApiKeyInput: (props: ApiKeyInputProps) => {
        apiKeyCapture.current = props;
        return <div>API key input</div>;
    },
}));

vi.mock('../../../../services/geminiService', () => ({
    verifyApiKey: verifyApiKeyMock,
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
    enableAI: true,
    devMode: true,
    aiModel: 'gemini-3.5-flash',
    aiThinkingMode: 'minimal',
    ...overrides,
});

const Harness = ({ initialSettings }: { initialSettings: AppSettings }) => {
    const [settings, setSettings] = React.useState(initialSettings);
    return <IntelligenceTab settings={settings} setSettings={setSettings} />;
};

const getSelects = (): [HTMLSelectElement, HTMLSelectElement] => {
    const selects = screen.getAllByRole('combobox') as HTMLSelectElement[];
    expect(selects).toHaveLength(2);
    return [selects[0], selects[1]];
};

const getOptionLabels = (select: HTMLSelectElement): string[] =>
    Array.from(select.options).map(option => option.textContent ?? '');

const changeApiKey = async (value: string) => {
    act(() => apiKeyCapture.current!.onChange(value));
    await waitFor(() => expect(apiKeyCapture.current!.value).toBe(value));
};

const verifyLocalKey = async () => {
    await act(async () => {
        await apiKeyCapture.current!.onVerify();
    });
};

describe('IntelligenceTab', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        settingsStoreMock.geminiApiKey = null;
        verifyApiKeyMock.mockResolvedValue({ valid: true });
        setGeminiApiKeyMock.mockResolvedValue(undefined);
        apiKeyCapture.current = null;
    });

    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it('shows only thinking modes supported by the selected developer model', () => {
        vi.stubEnv('DEV', true);
        render(<Harness initialSettings={createSettings()} />);

        let [modelSelect, thinkingSelect] = getSelects();
        expect(getOptionLabels(thinkingSelect)).toEqual([
            'Model Default',
            'Minimal',
            'Low',
            'Medium',
            'High',
        ]);

        fireEvent.change(modelSelect, { target: { value: 'gemini-3.1-pro-preview' } });
        [modelSelect, thinkingSelect] = getSelects();
        expect(thinkingSelect.value).toBe('default');
        expect(getOptionLabels(thinkingSelect)).toEqual([
            'Model Default',
            'Low',
            'Medium',
            'High',
        ]);

        fireEvent.change(modelSelect, { target: { value: 'gemini-2.5-flash' } });
        [modelSelect, thinkingSelect] = getSelects();
        expect(getOptionLabels(thinkingSelect)).toEqual([
            'Model Default',
            'Off',
            'Dynamic',
        ]);

        fireEvent.change(modelSelect, { target: { value: 'gemini-2.5-pro' } });
        [, thinkingSelect] = getSelects();
        expect(getOptionLabels(thinkingSelect)).toEqual(['Model Default']);
    });

    it('hides model and thinking controls when developer features are disabled', () => {
        vi.stubEnv('DEV', true);
        render(<Harness initialSettings={createSettings({ devMode: false })} />);

        expect(screen.queryByText('AI Model (Dev Mode)')).toBeNull();
        expect(screen.queryByText('Thinking Effort (Dev Mode)')).toBeNull();
    });

    it('toggles AI features and reports the new state', () => {
        const { rerender } = render(<Harness initialSettings={createSettings({ enableAI: false })} />);
        expect(screen.queryByText('API key input')).toBeNull();
        fireEvent.click(screen.getByText('Enable AI Features').parentElement!.parentElement!);
        expect(screen.getByText('API key input')).not.toBeNull();
        expect(addToastMock).toHaveBeenCalledWith('AI features enabled', 'success');

        rerender(<Harness initialSettings={createSettings({ enableAI: true })} />);
        fireEvent.click(screen.getByText('Enable AI Features').parentElement!.parentElement!);
        expect(addToastMock).toHaveBeenCalledWith('AI features disabled', 'success');
    });

    it('changes supported thinking modes and ignores unsupported values', () => {
        vi.stubEnv('DEV', true);
        render(<Harness initialSettings={createSettings()} />);
        const [, thinkingSelect] = getSelects();
        fireEvent.change(thinkingSelect, { target: { value: 'high' satisfies AiThinkingMode } });
        expect(addToastMock).toHaveBeenCalledWith('Thinking effort set to High', 'success');

        fireEvent.change(thinkingSelect, { target: { value: 'off' } });
        expect(addToastMock).toHaveBeenCalledTimes(1);
    });

    it('does not announce an unknown model id', () => {
        vi.stubEnv('DEV', true);
        render(<Harness initialSettings={createSettings()} />);
        fireEvent.change(getSelects()[0], { target: { value: 'unknown-model' } });
        expect(addToastMock).not.toHaveBeenCalled();
    });

    it('requires a local API key before verification', async () => {
        render(<Harness initialSettings={createSettings()} />);
        await apiKeyCapture.current!.onVerify();
        expect(addToastMock).toHaveBeenCalledWith('Please enter an API key first', 'error');
        expect(verifyApiKeyMock).not.toHaveBeenCalled();
    });

    it('resets verification state when the local key changes', async () => {
        verifyApiKeyMock.mockResolvedValueOnce({ valid: false, error: 'bad key' });
        render(<Harness initialSettings={createSettings()} />);
        await changeApiKey('bad');
        await verifyLocalKey();
        await waitFor(() => expect(apiKeyCapture.current!.status).toBe('error'));
        expect(apiKeyCapture.current!.error).toBe('bad key');

        await changeApiKey('new');
        await waitFor(() => expect(apiKeyCapture.current!.status).toBe('idle'));
        expect(apiKeyCapture.current!.error).toBeNull();
    });

    it('verifies and securely saves a local API key', async () => {
        settingsStoreMock.geminiApiKey = 'stored-key';
        render(<Harness initialSettings={createSettings()} />);
        await waitFor(() => expect(apiKeyCapture.current!.value).toBe('stored-key'));
        await verifyLocalKey();

        expect(verifyApiKeyMock).toHaveBeenCalledWith('stored-key', 'gemini-3.5-flash');
        expect(setGeminiApiKeyMock).toHaveBeenCalledWith('stored-key');
        expect(addToastMock).toHaveBeenCalledWith('API Key verified and saved securely', 'success');
        expect(apiKeyCapture.current!.status).toBe('success');
        expect(apiKeyCapture.current!.isVerifying).toBe(false);
    });

    it('uses the fallback verification message when the service omits one', async () => {
        verifyApiKeyMock.mockResolvedValueOnce({ valid: false });
        settingsStoreMock.geminiApiKey = 'bad';
        render(<Harness initialSettings={createSettings()} />);
        await waitFor(() => expect(apiKeyCapture.current!.value).toBe('bad'));
        await verifyLocalKey();
        expect(apiKeyCapture.current!.error).toBe('Verification failed');
        expect(addToastMock).toHaveBeenCalledWith('Verification failed', 'error');
    });

    it.each([
        [new Error('network down'), 'network down'],
        ['not an error', 'Unknown error'],
    ])('reports local verification exceptions', async (error, expected) => {
        verifyApiKeyMock.mockRejectedValueOnce(error);
        settingsStoreMock.geminiApiKey = 'key';
        render(<Harness initialSettings={createSettings()} />);
        await waitFor(() => expect(apiKeyCapture.current!.value).toBe('key'));
        await verifyLocalKey();
        expect(apiKeyCapture.current!.error).toBe(expected);
        expect(addToastMock).toHaveBeenCalledWith(expected, 'error');
    });

    it('verifies an environment key successfully', async () => {
        vi.stubEnv('API_KEY', 'env-key');
        render(<Harness initialSettings={createSettings()} />);
        expect(apiKeyCapture.current!.isEnvKey).toBe(true);
        apiKeyCapture.current!.onTestEnvKey();
        await waitFor(() => expect(addToastMock).toHaveBeenCalledWith('Environment API Key verified', 'success'));
        expect(verifyApiKeyMock).toHaveBeenCalledWith('env-key', 'gemini-3.5-flash');
    });

    it('reports environment-key rejection and exceptions', async () => {
        vi.stubEnv('API_KEY', 'env-key');
        verifyApiKeyMock.mockResolvedValueOnce({ valid: false });
        const first = render(<Harness initialSettings={createSettings()} />);
        apiKeyCapture.current!.onTestEnvKey();
        await waitFor(() => expect(apiKeyCapture.current!.error).toBe('Verification failed'));
        first.unmount();

        verifyApiKeyMock.mockRejectedValueOnce(new Error('env offline'));
        render(<Harness initialSettings={createSettings()} />);
        apiKeyCapture.current!.onTestEnvKey();
        await waitFor(() => expect(apiKeyCapture.current!.error).toBe('env offline'));
    });

    it('uses Unknown error for non-Error environment-key failures', async () => {
        vi.stubEnv('API_KEY', 'env-key');
        verifyApiKeyMock.mockRejectedValueOnce('offline');
        render(<Harness initialSettings={createSettings()} />);
        apiKeyCapture.current!.onTestEnvKey();
        await waitFor(() => expect(apiKeyCapture.current!.error).toBe('Unknown error'));
    });

    it('does not test an absent environment key', () => {
        vi.stubEnv('API_KEY', '');
        render(<Harness initialSettings={createSettings()} />);
        apiKeyCapture.current!.onTestEnvKey();
        expect(verifyApiKeyMock).not.toHaveBeenCalled();
    });
});
