import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '../../../../test/testUtils';
import type { AppSettings } from '../../../../types';
import { IntelligenceTab } from '../IntelligenceTab';

const addToastMock = vi.hoisted(() => vi.fn());
const verifyApiKeyMock = vi.hoisted(() => vi.fn());

vi.mock('../../../../hooks/useToast', () => ({
    useToast: () => ({
        addToast: addToastMock,
    }),
}));

const settingsStoreMock = vi.hoisted(() => ({
    geminiApiKey: null as string | null,
    setGeminiApiKey: vi.fn(),
}));

const apiKeyInputPropsMock = vi.hoisted(() => vi.fn());

interface MockApiKeyInputProps {
    isVerifying: boolean;
    status: string;
    onVerify: () => Promise<void>;
}

vi.mock('../../../../stores/settingsStore', () => ({
    useSettingsStore: () => settingsStoreMock,
}));

vi.mock('../../../../components/ui/ApiKeyInput', () => ({
    ApiKeyInput: (props: MockApiKeyInputProps) => {
        apiKeyInputPropsMock(props);
        return <div>API key input: {props.status}</div>;
    },
}));

vi.mock('../../../../services/geminiService', () => ({
    verifyApiKey: verifyApiKeyMock,
}));

const getLatestApiKeyInputProps = (): MockApiKeyInputProps => {
    const calls = apiKeyInputPropsMock.mock.calls;
    return calls[calls.length - 1][0] as MockApiKeyInputProps;
};

const createSettings = (overrides: Partial<AppSettings> = {}): AppSettings => ({
    hasCompletedOnboarding: true,
    theme: 'dark',
    thumbnailSize: 200,
    confirmDelete: true,
    defaultTheaterMode: false,
    monitoredFolders: [],
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

describe('IntelligenceTab', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        settingsStoreMock.geminiApiKey = null;
        settingsStoreMock.setGeminiApiKey.mockResolvedValue(undefined);
        verifyApiKeyMock.mockResolvedValue({ valid: true });
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

    it('passes configured status to the shared input for a stored key', () => {
        settingsStoreMock.geminiApiKey = 'stored-key';

        render(<Harness initialSettings={createSettings()} />);

        expect(screen.getByText('API key input: configured')).not.toBeNull();
        expect(apiKeyInputPropsMock).toHaveBeenCalledWith(expect.objectContaining({ status: 'configured' }));
    });

    it('does not report success until secure key storage resolves', async () => {
        let resolveStorage: (() => void) | undefined;
        settingsStoreMock.geminiApiKey = 'stored-key';
        settingsStoreMock.setGeminiApiKey.mockImplementationOnce(() => new Promise<void>((resolve) => {
            resolveStorage = resolve;
        }));
        render(<Harness initialSettings={createSettings()} />);

        let verificationPromise: Promise<void> | undefined;
        await act(async () => {
            verificationPromise = getLatestApiKeyInputProps().onVerify();
            await Promise.resolve();
        });

        expect(verifyApiKeyMock).toHaveBeenCalled();
        expect(getLatestApiKeyInputProps().status).not.toBe('success');
        expect(getLatestApiKeyInputProps().isVerifying).toBe(true);

        await act(async () => {
            resolveStorage?.();
            await verificationPromise;
        });

        await waitFor(() => {
            expect(getLatestApiKeyInputProps().status).toBe('success');
            expect(addToastMock).toHaveBeenCalledWith('API Key verified and saved securely', 'success');
        });
    });

    it('shows an error without a success state when secure storage fails', async () => {
        settingsStoreMock.geminiApiKey = 'stored-key';
        settingsStoreMock.setGeminiApiKey.mockRejectedValueOnce(new Error('Keyring unavailable'));
        render(<Harness initialSettings={createSettings()} />);

        await act(async () => {
            await getLatestApiKeyInputProps().onVerify();
        });

        expect(getLatestApiKeyInputProps().status).toBe('error');
        expect(apiKeyInputPropsMock.mock.calls.some(([props]) => (
            props as MockApiKeyInputProps
        ).status === 'success')).toBe(false);
        expect(addToastMock).toHaveBeenCalledWith('Keyring unavailable', 'error');
    });

    it('describes environment keys without claiming they are stored', () => {
        vi.stubEnv('API_KEY', 'environment-key');
        render(<Harness initialSettings={createSettings()} />);

        expect(screen.getByText(/Ambit reads this API key from your environment and does not save it/)).not.toBeNull();
        expect(screen.queryByText(/stored locally in the OS keyring/)).toBeNull();
    });

    it('retains keyring wording for keys entered through Settings', () => {
        vi.stubEnv('API_KEY', '');
        render(<Harness initialSettings={createSettings()} />);

        expect(screen.getByText(/stored locally in the OS keyring/)).not.toBeNull();
        expect(screen.queryByText(/reads this API key from your environment/)).toBeNull();
    });
});
