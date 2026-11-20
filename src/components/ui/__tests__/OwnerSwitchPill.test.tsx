import * as React from 'react';
import { act, fireEvent, render, screen } from '../../../test/testUtils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OwnerSwitchPill } from '../OwnerSwitchPill';
import { useLibraryStore } from '../../../stores/libraryStore';
import { useInvokeOwnerScopeStore, type InvokeOperationState } from '../../../stores/invokeOwnerScopeStore';
import type { InvokeSyncScope } from '../../../services/invoke/syncScope';

// Exit animations do not run under fake timers; render the pill as it is after each animation.
vi.mock('framer-motion', () => ({
    AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    motion: {
        div: ({ children, className }: React.HTMLAttributes<HTMLDivElement>) => <div className={className}>{children}</div>,
    },
    useReducedMotion: () => false,
}));

const scopeOf = (ownerId: string): InvokeSyncScope => ({
    dbPath: 'D:/Invoke/databases/invokeai.db',
    imagesRoot: 'D:/Invoke',
    mode: 'owner',
    ownerId,
});

const PENDING = "Showing Freya's images · switching to Odin";

const startSwitch = (): symbol => {
    const operationId = Symbol('switch');
    act(() => {
        const store = useInvokeOwnerScopeStore.getState();
        store.setOwnerScopeState({ status: 'applying', rootPath: 'D:/Invoke', scope: scopeOf('odin') });
        store.setOperation({
            id: operationId,
            origin: 'user',
            rootPath: 'D:/Invoke',
            targetLabel: 'Odin',
            phase: 'preparing',
            viewCommitted: false,
            progress: { current: 0, total: 0 },
        });
        store.retainOwnerScope({ operationId, rootPath: 'D:/Invoke', scope: scopeOf('freya'), label: 'Freya', targetLabel: 'Odin' });
    });
    return operationId;
};

const endSwitch = (operationId: symbol, owner: 'freya' | 'odin', phase: InvokeOperationState['phase']) => {
    act(() => {
        const store = useInvokeOwnerScopeStore.getState();
        store.setOwnerScopeState({ status: 'ready', rootPath: 'D:/Invoke', scope: scopeOf(owner) });
        store.setOperation((current) => current && { ...current, phase, viewCommitted: owner === 'odin' });
        store.releaseRetainedOwnerScope(operationId);
    });
};

// #527: while a switch keeps the previous owner browsable, the gallery says whose images are on screen.
describe('OwnerSwitchPill', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        useInvokeOwnerScopeStore.getState().resetOwnerScopeState();
        useLibraryStore.setState({ isActivityDockDismissed: false, isActivityDockMinimized: false });
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('shows nothing outside a switch', () => {
        render(<OwnerSwitchPill />);
        expect(screen.queryByRole('status')).toBeNull();
        expect(screen.queryByText(/showing/i)).toBeNull();
    });

    it('names the shown owner for the whole switch after 600 ms, cannot be dismissed, and reopens the dock', () => {
        render(<OwnerSwitchPill />);
        const operationId = startSwitch();
        act(() => vi.advanceTimersByTime(599));
        expect(screen.queryByText(PENDING)).toBeNull();

        act(() => vi.advanceTimersByTime(1));
        expect(screen.getByRole('button', { name: PENDING })).toBeTruthy();
        // It stays through the Q2 hold: Odin is admitted, the swap waits.
        act(() => {
            useInvokeOwnerScopeStore.getState().setOwnerScopeState({ status: 'ready', rootPath: 'D:/Invoke', scope: scopeOf('odin') });
            vi.advanceTimersByTime(60_000);
        });
        expect(screen.getByRole('button', { name: PENDING })).toBeTruthy();
        expect(screen.getAllByRole('button')).toHaveLength(1);

        useLibraryStore.setState({ isActivityDockDismissed: true, isActivityDockMinimized: true });
        fireEvent.click(screen.getByRole('button', { name: PENDING }));
        expect(useLibraryStore.getState().isActivityDockDismissed).toBe(false);
        expect(useLibraryStore.getState().isActivityDockMinimized).toBe(false);

        endSwitch(operationId, 'odin', 'completed');
        expect(screen.getByText("Now showing Odin's images")).toBeTruthy();
        expect(screen.queryByRole('button')).toBeNull();
        act(() => vi.advanceTimersByTime(3000));
        expect(screen.queryByText("Now showing Odin's images")).toBeNull();
    });

    it.each([
        ['cancelled', "Switch cancelled · still showing Freya's images"],
        ['failed', "Could not switch · still showing Freya's images"],
    ] as const)('says the gallery still shows the previous owner when the switch is %s', (phase, text) => {
        render(<OwnerSwitchPill />);
        const operationId = startSwitch();
        act(() => vi.advanceTimersByTime(600));
        endSwitch(operationId, 'freya', phase);

        expect(screen.getByText(text)).toBeTruthy();
        expect(screen.queryByText(/Now showing/)).toBeNull();
        act(() => vi.advanceTimersByTime(3000));
        expect(screen.queryByText(text)).toBeNull();
    });

    // P4 of the #529 owner smoke: a cancel can take a while, and the pill must not keep promising the target.
    it('says the switch is being cancelled until the cancel finishes', () => {
        render(<OwnerSwitchPill />);
        const operationId = startSwitch();
        act(() => vi.advanceTimersByTime(600));
        act(() =>
            useInvokeOwnerScopeStore.getState().setOperation((current) => current && { ...current, phase: 'cancelling', cancel: undefined })
        );

        const cancelling = "Showing Freya's images · cancelling switch to Odin";
        expect(screen.getByRole('button', { name: cancelling })).toBeTruthy();
        expect(screen.queryByText(PENDING)).toBeNull();
        endSwitch(operationId, 'freya', 'cancelled');
        expect(screen.queryByText(cancelling)).toBeNull();
        expect(screen.getByText("Switch cancelled · still showing Freya's images")).toBeTruthy();
    });

    it('keeps "switching" while a held swap only cancels the catch-up of an admitted owner', () => {
        render(<OwnerSwitchPill />);
        startSwitch();
        act(() => vi.advanceTimersByTime(600));
        act(() => {
            const store = useInvokeOwnerScopeStore.getState();
            store.setOwnerScopeState({ status: 'ready', rootPath: 'D:/Invoke', scope: scopeOf('odin') });
            store.setOperation((current) => current && { ...current, phase: 'cancelling', viewCommitted: true });
        });

        expect(screen.getByRole('button', { name: PENDING })).toBeTruthy();
    });

    // R1: once Odin is admitted the switch is done. Cancelling or failing its catch-up during the held swap
    // stops only the catch-up, so the swap shows Odin and the note must not claim Freya is still shown.
    it.each(['cancelled', 'failed'] as const)('names the target after a held swap whose catch-up was %s', (phase) => {
        render(<OwnerSwitchPill />);
        const operationId = startSwitch();
        act(() => vi.advanceTimersByTime(600));
        endSwitch(operationId, 'odin', phase);

        expect(screen.getByText("Now showing Odin's images")).toBeTruthy();
        expect(screen.queryByText(/still showing Freya/)).toBeNull();
    });

    it('names the target when a retried catch-up is the current operation at the swap', () => {
        render(<OwnerSwitchPill />);
        const operationId = startSwitch();
        act(() => {
            const store = useInvokeOwnerScopeStore.getState();
            store.setOwnerScopeState({ status: 'ready', rootPath: 'D:/Invoke', scope: scopeOf('odin') });
            store.setOperation((current) => current && { ...current, id: Symbol('retry'), phase: 'failed', viewCommitted: true });
            store.releaseRetainedOwnerScope(operationId);
        });

        expect(screen.getByText("Now showing Odin's images")).toBeTruthy();
    });

    it('shows only the "Now showing" note for a warm switch admitted within 600 ms', () => {
        render(<OwnerSwitchPill />);
        const operationId = startSwitch();
        act(() => vi.advanceTimersByTime(550));
        endSwitch(operationId, 'odin', 'syncing');
        act(() => vi.advanceTimersByTime(100));

        expect(screen.queryByText(PENDING)).toBeNull();
        expect(screen.getByText("Now showing Odin's images")).toBeTruthy();
    });

    it('drops an earlier note as soon as another switch starts', () => {
        render(<OwnerSwitchPill />);
        endSwitch(startSwitch(), 'freya', 'cancelled');
        expect(screen.getByText(/Switch cancelled/)).toBeTruthy();

        startSwitch();
        expect(screen.queryByText(/Switch cancelled/)).toBeNull();
    });
});
