import * as React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '../../../test/testUtils';
import { ApiKeyInput } from '../ApiKeyInput';

const mocks = vi.hoisted(() => ({
    openExternalUrl: vi.fn(),
}));

vi.mock('../../../utils/externalLinks', () => ({
    GEMINI_API_KEY_URL: 'https://aistudio.google.com/apikey',
    openExternalUrl: mocks.openExternalUrl,
}));

const renderInput = (
    status: 'idle' | 'configured' | 'success' | 'error' = 'idle',
    error?: string,
    overrides: Partial<React.ComponentProps<typeof ApiKeyInput>> = {}
) => {
    const props: React.ComponentProps<typeof ApiKeyInput> = {
        value: 'key',
        onChange: vi.fn(),
        onVerify: vi.fn().mockResolvedValue(undefined),
        isVerifying: false,
        status,
        error,
        ...overrides,
    };

    render(<ApiKeyInput {...props} />);
    return props;
};

describe('ApiKeyInput', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.openExternalUrl.mockResolvedValue(undefined);
    });

    it('associates the Gemini label and opens the exact allowlisted key page', () => {
        renderInput();

        expect(screen.getByLabelText('Gemini API key').getAttribute('type')).toBe('password');
        fireEvent.click(screen.getByRole('button', { name: 'Get a Gemini API key' }));

        expect(mocks.openExternalUrl).toHaveBeenCalledWith('https://aistudio.google.com/apikey');
    });

    it('announces a stored key as configured and offers re-verification', () => {
        const props = renderInput('configured');

        expect(screen.getByRole('status').textContent).toContain('API key configured');
        fireEvent.click(screen.getByRole('button', { name: 'Re-verify' }));
        expect(props.onVerify).toHaveBeenCalledOnce();
    });

    it('announces successful verification and prevents redundant verification', () => {
        renderInput('success');

        expect(screen.getByRole('status').textContent).toContain('API key verified and saved');
        expect((screen.getByRole('button', { name: 'Verified' }) as HTMLButtonElement).disabled).toBe(true);
    });

    it('announces environment-key verification without describing it as saved', () => {
        renderInput('success', undefined, { isEnvKey: true, onTestEnvKey: vi.fn() });

        expect(screen.getByText('Gemini API key').tagName).toBe('SPAN');
        expect(screen.getByRole('group', { name: 'Gemini API key' })).not.toBeNull();
        expect(screen.getByRole('status').textContent).toContain('Environment API key verified');
        expect(screen.queryByText('API key verified and saved')).toBeNull();
    });

    it('does not treat a stored-key configured state as environment-key verification', () => {
        renderInput('configured', undefined, { isEnvKey: true, onTestEnvKey: vi.fn() });

        expect(screen.queryByRole('status')).toBeNull();
    });

    it('forwards key edits so consumers can clear configured state', () => {
        const onChange = vi.fn();
        renderInput('configured', undefined, { onChange });

        fireEvent.change(screen.getByLabelText('Gemini API key'), { target: { value: 'replacement-key' } });

        expect(onChange).toHaveBeenCalledWith('replacement-key');
    });

    it('keeps the key value stable while verification is pending', () => {
        const onChange = vi.fn();
        const baseProps: React.ComponentProps<typeof ApiKeyInput> = {
            value: 'key-being-verified',
            onChange,
            onVerify: vi.fn().mockResolvedValue(undefined),
            isVerifying: true,
            status: 'idle',
        };
        const { rerender } = render(<ApiKeyInput {...baseProps} />);

        const input = screen.getByLabelText('Gemini API key') as HTMLInputElement;
        expect(input.readOnly).toBe(true);
        fireEvent.change(input, { target: { value: 'different-key' } });
        expect(onChange).not.toHaveBeenCalled();

        rerender(<ApiKeyInput {...baseProps} isVerifying={false} />);
        expect(input.readOnly).toBe(false);
        fireEvent.change(input, { target: { value: 'different-key' } });
        expect(onChange).toHaveBeenCalledWith('different-key');
    });

    it('announces verification failures as alerts', () => {
        renderInput('error', 'Verification failed');
        expect(screen.getByRole('alert').textContent).toContain('Verification failed');
    });

    it('announces environment-key verification failures as alerts', () => {
        renderInput('error', 'Environment key rejected', { isEnvKey: true, onTestEnvKey: vi.fn() });

        expect(screen.getByRole('alert').textContent).toContain('Environment key rejected');
    });
});
