import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InvokeSyncScope } from '../../services/invoke/syncScope';
import type { InvokeOwnerScopeState, RetainedOwnerScope } from '../../stores/invokeOwnerScopeStore';
import { useInvokeOwnerScopeStore } from '../../stores/invokeOwnerScopeStore';
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

describe('useOwnerScopeTransitionPresentation during a user owner switch (#527)', () => {
    const freya: InvokeSyncScope = { dbPath: 'C:/invoke/db', imagesRoot: 'C:/invoke/outputs', mode: 'owner', ownerId: 'freya' };
    const odin: InvokeSyncScope = { ...freya, ownerId: 'odin' };
    const retained = (overrides: Partial<RetainedOwnerScope> = {}): RetainedOwnerScope => ({
        operationId: Symbol('switch'),
        rootPath: 'C:/invoke',
        scope: freya,
        label: 'Freya',
        targetLabel: 'Odin',
        ...overrides,
    });

    interface SwitchProps {
        ownerScopeState: InvokeOwnerScopeState;
        retainedOwnerScope: RetainedOwnerScope | null;
        canSwapOwnerView: boolean;
        isExplicitPreparation?: boolean;
    }

    const ownerOf = (state: InvokeOwnerScopeState): string => (state.scope?.mode === 'owner' ? state.scope.ownerId : 'none');

    const renderSwitch = (initialProps: SwitchProps) => {
        const onClearStaleView = vi.fn();
        const view = renderHook(
            ({ ownerScopeState, retainedOwnerScope, canSwapOwnerView, isExplicitPreparation = false }: SwitchProps) => {
                const presentation = useOwnerScopeTransitionPresentation<string>({
                    configuredRoot: 'C:/invoke',
                    ownerScopeState,
                    isInitialStartupPresentation: false,
                    isExplicitPreparation,
                    onClearStaleView,
                    retainedOwnerScope,
                    canSwapOwnerView,
                });
                return { ...presentation, shown: presentation.selectPresentation(ownerOf(ownerScopeState)) };
            },
            { initialProps }
        );
        return { ...view, onClearStaleView };
    };

    const admittedFreya: InvokeOwnerScopeState = { status: 'ready', rootPath: 'C:/invoke', scope: freya };
    const applyingOdin: InvokeOwnerScopeState = { status: 'applying', rootPath: 'C:/invoke', scope: odin };
    const admittedOdin: InvokeOwnerScopeState = { status: 'ready', rootPath: 'C:/invoke', scope: odin };

    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
        useInvokeOwnerScopeStore.getState().resetOwnerScopeState();
    });

    // The previous owner stays browsable for the whole preparation instead of the blocking gate.
    it('keeps the previous owner on screen without the gate, past the grace period and an explicit preparation', () => {
        const switching = retained();
        const view = renderSwitch({ ownerScopeState: admittedFreya, retainedOwnerScope: null, canSwapOwnerView: true });
        expect(view.result.current.shown).toBe('freya');

        view.rerender({
            ownerScopeState: applyingOdin,
            retainedOwnerScope: switching,
            canSwapOwnerView: true,
            isExplicitPreparation: true,
        });
        act(() => {
            vi.advanceTimersByTime(1000);
        });

        expect(view.result.current.isGateVisible).toBe(false);
        expect(view.result.current.isRetainingOwnerSwitchView).toBe(true);
        expect(view.result.current.shown).toBe('freya');
        expect(view.onClearStaleView).not.toHaveBeenCalled();
    });

    // Q2: the target is admitted, but the open viewer or a modal keeps the previous owner until it closes.
    it('holds the previous owner after admission while the view cannot swap, then swaps once it can', () => {
        const switching = retained();
        useInvokeOwnerScopeStore.getState().retainOwnerScope(switching);
        const view = renderSwitch({ ownerScopeState: admittedFreya, retainedOwnerScope: null, canSwapOwnerView: false });
        view.rerender({ ownerScopeState: applyingOdin, retainedOwnerScope: switching, canSwapOwnerView: false });
        view.rerender({ ownerScopeState: admittedOdin, retainedOwnerScope: switching, canSwapOwnerView: false });

        expect(view.result.current.shown).toBe('freya');
        expect(useInvokeOwnerScopeStore.getState().retainedOwnerScope).toBe(switching);
        expect(view.onClearStaleView).not.toHaveBeenCalled();

        view.rerender({ ownerScopeState: admittedOdin, retainedOwnerScope: switching, canSwapOwnerView: true });

        expect(useInvokeOwnerScopeStore.getState().retainedOwnerScope).toBeNull();
        expect(view.onClearStaleView).toHaveBeenCalledOnce();
        view.rerender({ ownerScopeState: admittedOdin, retainedOwnerScope: null, canSwapOwnerView: true });
        expect(view.result.current.shown).toBe('odin');
    });

    it('swaps at once on "Switch now", even with the viewer open', () => {
        const switching = retained({ swapRequested: true });
        useInvokeOwnerScopeStore.getState().retainOwnerScope(switching);
        const view = renderSwitch({ ownerScopeState: admittedFreya, retainedOwnerScope: null, canSwapOwnerView: false });
        view.rerender({ ownerScopeState: admittedOdin, retainedOwnerScope: switching, canSwapOwnerView: false });

        expect(useInvokeOwnerScopeStore.getState().retainedOwnerScope).toBeNull();
        expect(view.onClearStaleView).toHaveBeenCalledOnce();
    });

    // A cancelled or failed switch returns to the previous owner: selection, scroll and the viewer survive.
    it('does not clear the view when the switch returns to the previous owner', () => {
        const switching = retained();
        const view = renderSwitch({ ownerScopeState: admittedFreya, retainedOwnerScope: null, canSwapOwnerView: true });
        view.rerender({ ownerScopeState: applyingOdin, retainedOwnerScope: switching, canSwapOwnerView: true });
        view.rerender({ ownerScopeState: admittedFreya, retainedOwnerScope: switching, canSwapOwnerView: true });
        view.rerender({ ownerScopeState: admittedFreya, retainedOwnerScope: null, canSwapOwnerView: true });

        expect(view.onClearStaleView).not.toHaveBeenCalled();
        expect(view.result.current.shown).toBe('freya');
    });

    // Fail closed: a retained owner of another root is not this gallery, so the existing gate rules apply.
    it('ignores a retained owner of another root', () => {
        const view = renderSwitch({ ownerScopeState: admittedFreya, retainedOwnerScope: null, canSwapOwnerView: true });
        view.rerender({
            ownerScopeState: applyingOdin,
            retainedOwnerScope: retained({ rootPath: 'D:/other-invoke' }),
            canSwapOwnerView: true,
            isExplicitPreparation: true,
        });

        expect(view.result.current.isRetainingOwnerSwitchView).toBe(false);
        expect(view.result.current.isGateVisible).toBe(true);
    });
});
