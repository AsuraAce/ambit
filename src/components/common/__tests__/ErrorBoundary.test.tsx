import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorBoundary } from '../ErrorBoundary';

const ThrowingChild = ({ shouldThrow }: { shouldThrow: boolean }) => {
    if (shouldThrow) {
        throw new Error('render failed');
    }

    return <div>Recovered child</div>;
};

describe('common ErrorBoundary', () => {
    beforeEach(() => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('renders children while no error has been thrown', () => {
        render(
            <ErrorBoundary>
                <div>Healthy child</div>
            </ErrorBoundary>
        );

        expect(screen.getByText('Healthy child')).toBeTruthy();
    });

    it('renders a caller-provided fallback when a child throws', () => {
        render(
            <ErrorBoundary fallback={<div>Custom fallback</div>}>
                <ThrowingChild shouldThrow />
            </ErrorBoundary>
        );

        expect(screen.getByText('Custom fallback')).toBeTruthy();
        expect(screen.queryByText('Try again')).toBeNull();
    });

    it('shows the default error details and can retry after the child stops throwing', () => {
        const { rerender } = render(
            <ErrorBoundary>
                <ThrowingChild shouldThrow />
            </ErrorBoundary>
        );

        expect(screen.getByText('Something went wrong in this section.')).toBeTruthy();
        expect(screen.getByText('Error: render failed')).toBeTruthy();

        rerender(
            <ErrorBoundary>
                <ThrowingChild shouldThrow={false} />
            </ErrorBoundary>
        );
        fireEvent.click(screen.getByText('Try again'));

        expect(screen.getByText('Recovered child')).toBeTruthy();
    });
});
