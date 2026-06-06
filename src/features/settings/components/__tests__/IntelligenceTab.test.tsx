import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '../../../../test/testUtils';
import type { AppSettings } from '../../../../types';
import { IntelligenceTab } from '../IntelligenceTab';

vi.mock('../../../../hooks/useToast', () => ({
    useToast: () => ({
        addToast: vi.fn(),
    }),
}));

vi.mock('../../../../stores/settingsStore', () => ({
    useSettingsStore: () => ({
        geminiApiKey: null,
        setGeminiApiKey: vi.fn(),
    }),
}));

vi.mock('../../../../components/ui/ApiKeyInput', () => ({
    ApiKeyInput: () => <div>API key input</div>,
}));

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
});
