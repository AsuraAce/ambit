import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorBoundary } from '../ErrorBoundary';

let shouldThrow = false;
let errorMessage = 'render failed';

const UnstableChild = () => {
    if (shouldThrow) throw new Error(errorMessage);
    return <div>Recovered content</div>;
};

describe('ui ErrorBoundary', () => {
    beforeEach(() => {
        shouldThrow = false;
        errorMessage = 'render failed';
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
    });

    it('passes through children when rendering succeeds', () => {
        render(<ErrorBoundary><UnstableChild /></ErrorBoundary>);
        expect(screen.getByText('Recovered content')).toBeTruthy();
    });

    it('shows the error and retries the failed child', () => {
        shouldThrow = true;
        render(<ErrorBoundary><UnstableChild /></ErrorBoundary>);

        expect(screen.getByText('render failed')).toBeTruthy();
        expect(console.error).toHaveBeenCalledWith('Uncaught error:', expect.any(Error), expect.any(Object));

        shouldThrow = false;
        fireEvent.click(screen.getByRole('button', { name: 'Try Again' }));
        expect(screen.getByText('Recovered content')).toBeTruthy();
    });

    it('uses custom and generic fallbacks when requested', () => {
        shouldThrow = true;
        const { unmount } = render(
            <ErrorBoundary fallback={<div>Custom fallback</div>}><UnstableChild /></ErrorBoundary>
        );
        expect(screen.getByText('Custom fallback')).toBeTruthy();
        unmount();

        errorMessage = '';
        render(<ErrorBoundary><UnstableChild /></ErrorBoundary>);
        expect(screen.getByText('An unexpected error occurred while rendering this view.')).toBeTruthy();
    });
});
