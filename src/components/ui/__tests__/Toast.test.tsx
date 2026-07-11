import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ToastMessage } from '../../../types';
import { ToastContainer } from '../Toast';

const toast = (id: string, type: ToastMessage['type'], action?: ToastMessage['action']): ToastMessage => ({
    id,
    message: `${type} message`,
    type,
    action,
});

describe('ToastContainer', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('renders every variant and supports action and manual dismissal', () => {
        const action = vi.fn();
        const removeToast = vi.fn();
        render(
            <ToastContainer
                toasts={[
                    toast('success', 'success', { label: 'Undo', onClick: action }),
                    toast('error', 'error'),
                    toast('info', 'info'),
                    toast('warning', 'warning'),
                ]}
                removeToast={removeToast}
            />
        );

        fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
        expect(action).toHaveBeenCalledOnce();
        expect(removeToast).toHaveBeenCalledWith('success');

        const dismissButtons = screen.getAllByRole('button').filter(item => item.textContent === '');
        fireEvent.click(dismissButtons[1]);
        expect(removeToast).toHaveBeenCalledWith('error');
    });

    it('expires after three seconds, pauses on hover, and uses the latest callback', () => {
        const firstRemove = vi.fn();
        const latestRemove = vi.fn();
        const activeToast = toast('info', 'info');
        const { rerender } = render(<ToastContainer toasts={[activeToast]} removeToast={firstRemove} />);
        const item = screen.getByText('info message').closest('.pointer-events-auto') as HTMLElement;

        fireEvent.mouseEnter(item);
        act(() => vi.advanceTimersByTime(3000));
        expect(firstRemove).not.toHaveBeenCalled();

        rerender(<ToastContainer toasts={[activeToast]} removeToast={latestRemove} />);
        fireEvent.mouseLeave(item);
        act(() => vi.advanceTimersByTime(2999));
        expect(latestRemove).not.toHaveBeenCalled();
        act(() => vi.advanceTimersByTime(1));
        expect(latestRemove).toHaveBeenCalledWith('info');
        expect(firstRemove).not.toHaveBeenCalled();
    });
});
