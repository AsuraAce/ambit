import * as React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

let markListener: ((phase: string) => void) | undefined;

const diagnostics = vi.hoisted(() => ({
    fail: vi.fn(),
    getLaunchId: vi.fn(() => 'launch-123'),
    subscribe: vi.fn(() => () => undefined),
    subscribeMarks: vi.fn((listener: (phase: string) => void) => {
        markListener = listener;
        return () => undefined;
    }),
}));

vi.mock('../../utils/startupDiagnostics', () => ({ startupDiagnostics: diagnostics }));

import { StartupBoundary } from '../StartupBoundary';

const BrokenChild = () => {
    throw new Error('private database path');
};

describe('StartupBoundary', () => {
    beforeEach(() => {
        markListener = undefined;
        diagnostics.fail.mockClear();
    });

    it('reports a fixed startup failure without exposing the render error', () => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const showFailure = vi.fn();
        window.__AMBIT_STARTUP_BOOTSTRAP__ = {
            showFailure,
            takeEvents: vi.fn(),
            markReactMounted: vi.fn(),
            markReady: vi.fn(),
            markTransportUnavailable: vi.fn(),
            setFailureLaunchId: vi.fn(),
        };
        render(<StartupBoundary><BrokenChild /></StartupBoundary>);

        const fallback = screen.getByRole('alert');
        expect(fallback.textContent).toContain('Ambit couldn’t start');
        expect(fallback.textContent).toContain('Launch ID: launch-123');
        expect(fallback.textContent).not.toContain('private database path');
        expect((fallback as HTMLElement).style.position).toBe('fixed');
        expect((fallback as HTMLElement).style.zIndex).toBe('2147483647');
        expect(showFailure).toHaveBeenCalledOnce();
        expect(diagnostics.fail).toHaveBeenCalledWith('startup-failure', 'render-error');
    });

    it('keeps post-readiness render failures out of startup evidence and allows retry', () => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const showFailure = vi.fn();
        window.__AMBIT_STARTUP_BOOTSTRAP__ = {
            showFailure,
            takeEvents: vi.fn(),
            markReactMounted: vi.fn(),
            markReady: vi.fn(),
            markTransportUnavailable: vi.fn(),
            setFailureLaunchId: vi.fn(),
        };
        let shouldThrow = false;
        const ConditionalChild = () => {
            if (shouldThrow) throw new Error('private runtime detail');
            return <div>Application content</div>;
        };
        const view = render(<StartupBoundary><ConditionalChild /></StartupBoundary>);

        act(() => markListener?.('ready'));
        shouldThrow = true;
        view.rerender(<StartupBoundary><ConditionalChild /></StartupBoundary>);

        expect(screen.getByRole('alert').textContent).toContain('Something went wrong');
        expect(screen.getByRole('alert').textContent).not.toContain('Ambit couldn’t start');
        expect(screen.getByRole('alert').textContent).not.toContain('private runtime detail');
        expect(showFailure).not.toHaveBeenCalled();
        expect(diagnostics.fail).not.toHaveBeenCalled();

        shouldThrow = false;
        fireEvent.click(screen.getByRole('button', { name: 'Try Again' }));
        expect(screen.getByText('Application content')).toBeTruthy();
    });
});
