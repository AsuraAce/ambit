import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { InvokeOwnerScopeState } from '../../stores/invokeOwnerScopeStore';
import { useOwnerScopeTransitionPresentation } from '../useOwnerScopeTransitionPresentation';

interface Props {
    configuredRoot: string;
    ownerScopeState: InvokeOwnerScopeState;
}

const renderPresentation = (initialProps: Props) =>
    renderHook(
        ({ configuredRoot, ownerScopeState }: Props) =>
            useOwnerScopeTransitionPresentation<string>({
                configuredRoot,
                ownerScopeState,
                isInitialStartupPresentation: false,
                isExplicitPreparation: false,
                onClearStaleView: vi.fn(),
            }),
        { initialProps }
    );

describe('useOwnerScopeTransitionPresentation', () => {
    // Re-applying a root the user already browsed is a quick switch: keep the previous view
    // instead of flashing the gate. A root that was never admitted must stay gated.
    it('treats re-applying the last admitted root as a runtime transition', () => {
        const { result, rerender } = renderPresentation({
            configuredRoot: 'C:/invoke',
            ownerScopeState: { status: 'ready', rootPath: 'C:/invoke' },
        });
        expect(result.current.isOwnerScopeAdmitted).toBe(true);

        rerender({ configuredRoot: 'C:/invoke', ownerScopeState: { status: 'applying', rootPath: 'C:/invoke' } });

        expect(result.current.isRuntimeTransition).toBe(true);
        expect(result.current.isRetainingPreviousView).toBe(true);
    });

    it('does not treat applying a root that was never admitted as a runtime transition', () => {
        const { result } = renderPresentation({
            configuredRoot: 'C:/invoke',
            ownerScopeState: { status: 'applying', rootPath: 'C:/invoke' },
        });

        expect(result.current.isRuntimeTransition).toBe(false);
        expect(result.current.isRetainingPreviousView).toBe(false);
    });

    it('does not treat applying a different root as a runtime transition', () => {
        const { result, rerender } = renderPresentation({
            configuredRoot: 'C:/invoke',
            ownerScopeState: { status: 'ready', rootPath: 'C:/invoke' },
        });

        rerender({ configuredRoot: 'D:/other-invoke', ownerScopeState: { status: 'applying', rootPath: 'D:/other-invoke' } });

        expect(result.current.isRuntimeTransition).toBe(false);
    });
});
