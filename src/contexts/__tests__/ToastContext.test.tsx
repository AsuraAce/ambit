import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastContext, ToastProvider } from '../ToastContext';

vi.mock('../../components/ui/Toast', () => ({
    ToastContainer: ({ toasts, removeToast }: {
        toasts: Array<{ id: string; message: string; type: string; action?: { label: string; onClick: () => void } }>;
        removeToast: (id: string) => void;
    }) => (
        <div>
            {toasts.map(toast => (
                <div key={toast.id} data-testid="toast" data-type={toast.type}>
                    {toast.message}
                    {toast.action ? <button onClick={toast.action.onClick}>{toast.action.label}</button> : null}
                    <button onClick={() => removeToast(toast.id)}>Remove {toast.message}</button>
                </div>
            ))}
        </div>
    ),
}));

let context: React.ContextType<typeof ToastContext>;
const Probe = () => (
    <ToastContext.Consumer>{value => { context = value; return null; }}</ToastContext.Consumer>
);

describe('ToastProvider', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        vi.spyOn(Math, 'random').mockReturnValue(0.25);
    });

    it('adds default and actionable toasts and removes them', () => {
        vi.spyOn(Date, 'now').mockReturnValueOnce(1000).mockReturnValueOnce(2000);
        const action = vi.fn();
        render(<ToastProvider><Probe /></ToastProvider>);
        act(() => context?.addToast('Default'));
        act(() => context?.addToast('Saved', 'success', { label: 'Undo', onClick: action }));
        expect(screen.getByText('Default').closest('[data-type]')?.getAttribute('data-type')).toBe('info');
        fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
        expect(action).toHaveBeenCalledOnce();
        fireEvent.click(screen.getByRole('button', { name: 'Remove Default' }));
        expect(screen.queryByText('Default')).toBeNull();
    });

    it('deduplicates recent messages but permits them after the window', () => {
        vi.spyOn(Date, 'now').mockReturnValueOnce(1000).mockReturnValueOnce(1500).mockReturnValueOnce(2000);
        render(<ToastProvider><Probe /></ToastProvider>);
        act(() => context?.addToast('Repeated'));
        act(() => context?.addToast('Repeated'));
        expect(screen.getAllByTestId('toast')).toHaveLength(1);
        act(() => context?.addToast('Repeated'));
        expect(screen.getAllByTestId('toast')).toHaveLength(2);
    });

    it('retains only the five newest messages', () => {
        let now = 1000;
        vi.spyOn(Date, 'now').mockImplementation(() => now++);
        render(<ToastProvider><Probe /></ToastProvider>);
        for (let index = 0; index < 7; index += 1) {
            act(() => context?.addToast(`Message ${index}`));
        }
        expect(screen.getAllByTestId('toast')).toHaveLength(5);
        expect(screen.queryByText('Message 0')).toBeNull();
        expect(screen.queryByText('Message 1')).toBeNull();
        expect(screen.getByText('Message 6')).toBeTruthy();
    });
});
