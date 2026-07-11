import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ApiKeyInput } from '../ApiKeyInput';

describe('ApiKeyInput', () => {
    it('edits and verifies a manually entered key', () => {
        const onChange = vi.fn();
        const onVerify = vi.fn().mockResolvedValue(undefined);
        const { rerender } = render(
            <ApiKeyInput
                value=""
                onChange={onChange}
                onVerify={onVerify}
                isVerifying={false}
                status="idle"
                showLabel
                label="Provider key"
                placeholder="Secret"
                className="test-class"
            />
        );

        expect(screen.getByText('Provider key')).toBeTruthy();
        const input = screen.getByPlaceholderText('Secret');
        fireEvent.change(input, { target: { value: 'abc123' } });
        expect(onChange).toHaveBeenCalledWith('abc123');
        expect((screen.getByRole('button', { name: 'Verify' }) as HTMLButtonElement).disabled).toBe(true);

        rerender(
            <ApiKeyInput
                value="abc123"
                onChange={onChange}
                onVerify={onVerify}
                isVerifying={false}
                status="success"
            />
        );
        fireEvent.click(screen.getByRole('button', { name: 'Verify' }));
        expect(onVerify).toHaveBeenCalledOnce();
        expect(screen.getByText('API Key Validated')).toBeTruthy();
    });

    it('shows verification progress and errors for a manual key', () => {
        render(
            <ApiKeyInput
                value="bad-key"
                onChange={vi.fn()}
                onVerify={vi.fn().mockResolvedValue(undefined)}
                isVerifying
                status="error"
                error="Key rejected"
            />
        );

        expect((screen.getByRole('button', { name: 'Checking...' }) as HTMLButtonElement).disabled).toBe(true);
        expect(screen.getByText('Key rejected')).toBeTruthy();
    });

    it('tests detected environment keys across idle, success, and error states', () => {
        const onTestEnvKey = vi.fn();
        const props = {
            value: '',
            onChange: vi.fn(),
            onVerify: vi.fn().mockResolvedValue(undefined),
            isVerifying: false,
            status: 'idle' as const,
            isEnvKey: true,
            onTestEnvKey,
        };
        const { rerender } = render(<ApiKeyInput {...props} />);

        fireEvent.click(screen.getByRole('button', { name: 'Test Env Key' }));
        expect(onTestEnvKey).toHaveBeenCalledOnce();

        rerender(<ApiKeyInput {...props} status="success" isVerifying />);
        expect((screen.getByRole('button', { name: 'Checking' }) as HTMLButtonElement).disabled).toBe(true);

        rerender(<ApiKeyInput {...props} status="error" error={null} />);
        expect(screen.queryByText('API Key Validated')).toBeNull();
    });
});
