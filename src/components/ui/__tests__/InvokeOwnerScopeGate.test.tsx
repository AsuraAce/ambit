import * as React from 'react';
import { act, fireEvent, render, screen, waitFor } from '../../../test/testUtils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InvokeOwnerScopeState } from '../../../contexts/SyncContext';
import type { InvokeOwnerDiscovery } from '../../../types';
import { InvokeOwnerScopeGate } from '../InvokeOwnerScopeGate';
import { useInvokeOwnerScopeStore } from '../../../stores/invokeOwnerScopeStore';

// Records what the DOM shows at every commit, before any passive effect can correct it.
const CommitProbe: React.FC<{ read: () => string; commits: string[] }> = ({ read, commits }) => {
    // Subscribing to the same store as the gate makes the probe commit together with it.
    useInvokeOwnerScopeStore((store) => store.operation);
    React.useLayoutEffect(() => {
        commits.push(read());
    });
    return null;
};

const createDiscovery = (dbPath: string): InvokeOwnerDiscovery => ({
    schemaMode: 'multi_user',
    dbPath,
    imagesRoot: 'D:/Invoke',
    owners: [{ ownerId: 'owner-a', displayName: 'Artemis', imageCount: 12 }],
    unassignedImageCount: 0,
});

const selectionState = (dbPath = 'D:/Invoke/databases/invokeai.db'): InvokeOwnerScopeState => ({
    status: 'selection_required',
    rootPath: 'D:/Invoke',
    discovery: createDiscovery(dbPath),
});

const renderGate = (state: InvokeOwnerScopeState) => {
    const callbacks = {
        onSelect: vi.fn(),
        onRetry: vi.fn(),
        onOpenSettings: vi.fn(),
    };
    return {
        ...render(<InvokeOwnerScopeGate state={state} {...callbacks} />),
        callbacks,
    };
};

describe('InvokeOwnerScopeGate', () => {
    beforeEach(() => useInvokeOwnerScopeStore.getState().resetOwnerScopeState());

    it('keeps preparation cancellation visible until native work settles without refocusing progress updates', () => {
        const cancel = vi.fn();
        useInvokeOwnerScopeStore.getState().setOperation({
            id: Symbol('switch'),
            origin: 'user',
            rootPath: 'D:/Invoke',
            targetLabel: 'Odin',
            phase: 'preparing',
            viewCommitted: false,
            progress: { current: 1, total: 4 },
            cancel,
        });
        renderGate({ status: 'applying', rootPath: 'D:/Invoke' });
        expect(screen.getByRole('heading', { name: 'Preparing view — Odin' })).toBe(document.activeElement);
        const button = screen.getByRole('button', { name: 'Cancel' });
        button.focus();
        fireEvent.click(button);
        expect(cancel).toHaveBeenCalledTimes(1);

        act(() =>
            useInvokeOwnerScopeStore.getState().setOperation(
                (current) =>
                    current && {
                        ...current,
                        phase: 'cancelling',
                        progress: { current: 2, total: 4 },
                    }
            )
        );
        expect((screen.getByRole('button', { name: 'Cancelling…' }) as HTMLButtonElement).disabled).toBe(true);
        expect(document.activeElement).toBe(button);
        expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('2');
    });
    it('explains the safety boundary while owner discovery is pending', () => {
        renderGate({
            status: 'discovering',
            progress: { current: 0, total: 0, message: 'Checking InvokeAI owner information...' },
        });

        expect(screen.getByRole('status')).toBeTruthy();
        expect(screen.getByText('Preparing view')).toBeTruthy();
        expect(screen.getByRole('heading', { name: 'Preparing your InvokeAI view' })).toBeTruthy();
        expect(screen.getByText(/loading the images, boards, and filters/i)).toBeTruthy();
        expect(screen.getByText('Existing images and collections are kept.')).toBeTruthy();
        expect(screen.getByText('Checking InvokeAI owner information...')).toBeTruthy();
        expect(screen.queryByRole('progressbar')).toBeNull();
    });

    it('shows real reconciliation counts without inventing a global percentage', () => {
        renderGate({
            status: 'applying',
            progress: { current: 500, total: 2000, message: 'Updating InvokeAI image details...' },
        });

        const count = screen.getByRole('progressbar').parentElement?.querySelector('span[aria-hidden="true"]');
        expect(count?.textContent?.replace(/\D/g, '')).toBe('5002000');
        expect(screen.getByText('Updating InvokeAI image details...')).toBeTruthy();
        expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('500');
        expect(screen.getByRole('progressbar').getAttribute('aria-valuemax')).toBe('2000');
    });

    it('labels image import separately from view preparation', () => {
        renderGate({
            status: 'applying',
            operationPhase: 'importing',
            progress: { current: 2, total: 10, message: 'Importing images...' },
        });

        expect(screen.getByText('Importing images')).toBeTruthy();
        expect(screen.getByText('Importing images...')).toBeTruthy();
        expect(screen.getByText('Existing images and collections are kept.')).toBeTruthy();
    });

    it('names the target owner and reports elapsed time for a sustained switch', async () => {
        vi.useFakeTimers();
        try {
            renderGate({
                status: 'applying',
                rootPath: 'D:/Invoke',
                scope: {
                    mode: 'owner',
                    ownerId: 'owner-a',
                    dbPath: 'D:/Invoke/databases/invokeai.db',
                    imagesRoot: 'D:/Invoke',
                },
                discovery: {
                    schemaMode: 'multi_user',
                    dbPath: 'D:/Invoke/databases/invokeai.db',
                    imagesRoot: 'D:/Invoke',
                    owners: [{ ownerId: 'owner-a', displayName: 'Odin', imageCount: 12 }],
                    unassignedImageCount: 0,
                },
                progress: { current: 0, total: 0, message: 'Updating changed InvokeAI filters...' },
            });

            expect(screen.getByRole('heading', { name: 'Preparing view — Odin' })).toBeTruthy();
            await act(async () => {
                await vi.advanceTimersByTimeAsync(5000);
            });
            expect(screen.getByText(/5s elapsed/)).toBeTruthy();
        } finally {
            vi.useRealTimers();
        }
    });

    it('defers owner selection until Open view and focuses that control', async () => {
        const { callbacks } = renderGate({
            status: 'selection_required',
            rootPath: 'D:/Invoke',
            discovery: {
                schemaMode: 'multi_user',
                dbPath: 'D:/Invoke/databases/invokeai.db',
                imagesRoot: 'D:/Invoke',
                owners: [{ ownerId: 'owner-a', displayName: 'Artemis', imageCount: 12 }],
                unassignedImageCount: 2,
            },
        });

        const heading = screen.getByRole('heading', { name: 'Choose which InvokeAI images to show' });
        await waitFor(() => expect(document.activeElement).toBe(heading));
        fireEvent.click(screen.getByRole('button', { name: /artemis/i }));
        expect(callbacks.onSelect).not.toHaveBeenCalled();
        const openView = screen.getByRole('button', { name: 'Open view' });
        expect(document.activeElement).toBe(openView);
        fireEvent.click(openView);
        expect(callbacks.onSelect).toHaveBeenCalledWith({
            dbPath: 'D:/Invoke/databases/invokeai.db',
            mode: 'owner',
            ownerId: 'owner-a',
        });
    });

    it('confirms All users on Open view and keeps a cancelled choice pending', () => {
        const { callbacks } = renderGate({
            status: 'selection_required',
            rootPath: 'D:/Invoke',
            discovery: {
                schemaMode: 'multi_user',
                dbPath: 'D:/Invoke/databases/invokeai.db',
                imagesRoot: 'D:/Invoke',
                owners: [{ ownerId: 'owner-a', displayName: 'Artemis', imageCount: 12 }],
                unassignedImageCount: 2,
            },
        });

        fireEvent.click(screen.getByRole('button', { name: /^All users/ }));
        // The selector is intentionally pure after its concurrent refactor. Keep
        // this compatible with the pre-refactor dialog while both changes land.
        if (screen.queryByRole('dialog')) {
            fireEvent.click(screen.getByRole('button', { name: 'Show All Users' }));
        }
        expect(callbacks.onSelect).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: 'Open view' }));
        expect(screen.getByRole('dialog', { name: 'Show images from all InvokeAI users?' })).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        expect(callbacks.onSelect).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: 'Open view' }));
        fireEvent.click(screen.getByRole('button', { name: 'Show All Users' }));
        expect(callbacks.onSelect).toHaveBeenCalledTimes(1);
        expect(callbacks.onSelect).toHaveBeenCalledWith({
            dbPath: 'D:/Invoke/databases/invokeai.db',
            mode: 'all',
        });
    });

    it('prevents duplicate Open view submissions while the selection is in flight', async () => {
        let resolveSelection!: () => void;
        const selectionPromise = new Promise<void>((resolve) => {
            resolveSelection = resolve;
        });
        const callbacks = {
            onSelect: vi.fn(() => selectionPromise),
            onRetry: vi.fn(),
            onOpenSettings: vi.fn(),
        };
        render(
            <InvokeOwnerScopeGate
                state={{
                    status: 'selection_required',
                    rootPath: 'D:/Invoke',
                    discovery: {
                        schemaMode: 'multi_user',
                        dbPath: 'D:/Invoke/databases/invokeai.db',
                        imagesRoot: 'D:/Invoke',
                        owners: [{ ownerId: 'owner-a', displayName: 'Artemis', imageCount: 12 }],
                        unassignedImageCount: 0,
                    },
                }}
                {...callbacks}
            />
        );

        fireEvent.click(screen.getByRole('button', { name: /artemis/i }));
        const openView = screen.getByRole('button', { name: 'Open view' });
        fireEvent.click(openView);
        fireEvent.click(openView);
        expect(callbacks.onSelect).toHaveBeenCalledTimes(1);
        expect((openView as HTMLButtonElement).disabled).toBe(true);

        resolveSelection();
        await waitFor(() => expect((openView as HTMLButtonElement).disabled).toBe(false));
        expect(document.activeElement).toBe(openView);
    });

    it('keeps cancelled preparation gated with neutral feedback and explicit recovery actions', () => {
        const { callbacks } = renderGate({
            status: 'error',
            rootPath: 'D:/Invoke',
            failure: { kind: 'preparation_cancelled', details: 'Preparation cancelled.' },
        });

        expect(screen.getByRole('heading', { name: 'InvokeAI preparation cancelled' })).toBe(document.activeElement);
        expect(screen.getByRole('status')).toBeTruthy();
        expect(screen.queryByRole('alert')).toBeNull();
        expect(screen.queryByText('Technical details')).toBeNull();
        expect(screen.getByText(/saved for retry/i)).toBeTruthy();
        expect(screen.getByText(/stays hidden until preparation finishes/i)).toBeTruthy();
        expect(callbacks.onRetry).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
        fireEvent.click(screen.getByRole('button', { name: 'Open Settings' }));
        expect(callbacks.onRetry).toHaveBeenCalledTimes(1);
        expect(callbacks.onOpenSettings).toHaveBeenCalledTimes(1);
    });

    it.each([false, true])('explains real failures even after a cancellation request: %s', async (cancelled) => {
        if (cancelled)
            useInvokeOwnerScopeStore.getState().setOperation({
                id: Symbol('cancelled operation'),
                origin: 'user',
                rootPath: 'D:/Invoke',
                targetLabel: 'Odin',
                phase: 'cancelled',
                viewCommitted: false,
                progress: { current: 0, total: 0 },
            });
        const { callbacks } = renderGate({
            status: 'error',
            rootPath: 'D:/Invoke',
            failure: { kind: 'preparation_failed', details: 'database locked' },
            error: 'database locked',
        });

        const heading = screen.getByRole('heading', { name: 'InvokeAI library preparation failed' });
        await waitFor(() => expect(document.activeElement).toBe(heading));
        expect(screen.getByRole('alert')).toBeTruthy();
        expect(screen.getByText(/staying hidden to avoid showing the wrong library/i)).toBeTruthy();
        expect((screen.getByText('Technical details').parentElement as HTMLDetailsElement).open).toBe(false);
        fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
        fireEvent.click(screen.getByRole('button', { name: 'Open Settings' }));
        expect(callbacks.onRetry).toHaveBeenCalledTimes(1);
        expect(callbacks.onOpenSettings).toHaveBeenCalledTimes(1);
    });

    it('retries the applied operation when its committed view needs guarded recovery', () => {
        const retry = vi.fn();
        useInvokeOwnerScopeStore.getState().setOperation({
            id: Symbol('failed operation'),
            origin: 'user',
            rootPath: 'D:/Invoke',
            targetLabel: 'Odin',
            phase: 'failed',
            viewCommitted: true,
            progress: { current: 2, total: 3 },
            retry,
        });
        const { callbacks } = renderGate({
            status: 'error',
            rootPath: 'D:/Invoke',
            error: 'Owner visibility could not be verified.',
            failure: { kind: 'preparation_failed', details: 'Owner visibility could not be verified.' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
        expect(retry).toHaveBeenCalledTimes(1);
        expect(callbacks.onRetry).not.toHaveBeenCalled();
    });

    it('offers recovery instead of an indefinite spinner for an offline scope that cannot be admitted', () => {
        const { callbacks } = renderGate({
            status: 'offline_ready',
            rootPath: 'D:/PreviousInvoke',
            failure: { kind: 'source_unavailable', details: 'database unavailable' },
            error: 'database unavailable',
        });

        expect(screen.queryByRole('status')).toBeNull();
        expect(screen.getByRole('alert')).toBeTruthy();
        expect(screen.getByText('InvokeAI needs attention')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
        expect(callbacks.onRetry).toHaveBeenCalledTimes(1);
    });

    describe('busy elapsed time', () => {
        const busyState = (overrides: Partial<InvokeOwnerScopeState> = {}): InvokeOwnerScopeState => ({
            status: 'applying',
            rootPath: 'D:/Invoke',
            scope: { mode: 'owner', ownerId: 'owner-a', dbPath: 'D:/Invoke/databases/invokeai.db', imagesRoot: 'D:/Invoke' },
            progress: { current: 0, total: 0, message: 'Preparing...' },
            ...overrides,
        });
        const callbacks = { onSelect: vi.fn(), onRetry: vi.fn(), onOpenSettings: vi.fn() };
        const statusText = () => screen.getByRole('status').textContent ?? '';

        beforeEach(() => vi.useFakeTimers());
        afterEach(() => vi.useRealTimers());

        it.each([
            ['root', busyState({ rootPath: 'D:/Other' })],
            ['scope', busyState({ scope: { mode: 'all', dbPath: 'D:/Invoke/databases/invokeai.db', imagesRoot: 'D:/Invoke' } })],
        ])('counts from zero again when the %s changes, without showing the old count first', (_name, next) => {
            const commits: string[] = [];
            const gate = (state: InvokeOwnerScopeState) => (
                <>
                    <InvokeOwnerScopeGate state={state} {...callbacks} />
                    <CommitProbe commits={commits} read={statusText} />
                </>
            );
            const { rerender } = render(gate(busyState()));
            act(() => void vi.advanceTimersByTime(7000));
            expect(statusText()).toContain('7s elapsed');

            commits.length = 0;
            rerender(gate(next));
            expect(commits.length).toBeGreaterThan(0);
            expect(commits.filter((text) => text.includes('elapsed'))).toEqual([]);
            act(() => void vi.advanceTimersByTime(5000));
            expect(statusText()).toContain('5s elapsed');
        });

        it('counts from zero again when a new operation starts', () => {
            const commits: string[] = [];
            const operation = (id: string) => ({
                id: Symbol(id),
                origin: 'user' as const,
                rootPath: 'D:/Invoke',
                targetLabel: 'Odin',
                phase: 'preparing' as const,
                viewCommitted: false,
                progress: { current: 0, total: 0 },
            });
            useInvokeOwnerScopeStore.getState().setOperation(operation('first'));
            render(
                <>
                    <InvokeOwnerScopeGate state={busyState()} {...callbacks} />
                    <CommitProbe commits={commits} read={statusText} />
                </>
            );
            act(() => void vi.advanceTimersByTime(7000));
            expect(statusText()).toContain('7s elapsed');

            commits.length = 0;
            act(() => useInvokeOwnerScopeStore.getState().setOperation(operation('second')));
            expect(commits.length).toBeGreaterThan(0);
            expect(commits.filter((text) => text.includes('elapsed'))).toEqual([]);
            act(() => void vi.advanceTimersByTime(5000));
            expect(statusText()).toContain('5s elapsed');
        });
    });

    describe('owner selection', () => {
        const openViewButton = () => screen.getByRole('button', { name: /Open view|Opening view/ }) as HTMLButtonElement;
        const renderSelection = (onSelect: () => void | Promise<void>) => {
            const callbacks = { onSelect, onRetry: vi.fn(), onOpenSettings: vi.fn() };
            const view = render(<InvokeOwnerScopeGate state={selectionState()} {...callbacks} />);
            return {
                rerenderState: (state: InvokeOwnerScopeState) => view.rerender(<InvokeOwnerScopeGate state={state} {...callbacks} />),
            };
        };

        it('drops the pending choice and a failed submit message when another InvokeAI database is discovered', async () => {
            const { rerenderState } = renderSelection(() => Promise.reject(new Error('Could not open view')));
            fireEvent.click(screen.getByRole('button', { name: /artemis/i }));
            fireEvent.click(openViewButton());
            expect((await screen.findByRole('alert')).textContent).toBe('Could not open view');
            expect(openViewButton().disabled).toBe(false);

            rerenderState(selectionState('D:/Other/databases/invokeai.db'));
            expect(screen.queryByRole('alert')).toBeNull();
            expect(openViewButton().disabled).toBe(true);
        });

        it('closes the All users confirmation when another InvokeAI database is discovered', async () => {
            const { rerenderState } = renderSelection(vi.fn());
            fireEvent.click(screen.getByRole('button', { name: /^All users/ }));
            fireEvent.click(openViewButton());
            expect(screen.getByRole('dialog', { name: 'Show images from all InvokeAI users?' })).toBeTruthy();

            rerenderState(selectionState('D:/Other/databases/invokeai.db'));
            await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
        });

        it('stops the Opening view state when the status leaves selection_required', () => {
            const onSelect = vi.fn(() => new Promise<void>(() => undefined));
            const { rerenderState } = renderSelection(onSelect);
            fireEvent.click(screen.getByRole('button', { name: /artemis/i }));
            fireEvent.click(openViewButton());
            expect(openViewButton().textContent).toBe('Opening view…');
            expect(openViewButton().disabled).toBe(true);

            rerenderState({ ...selectionState(), status: 'applying' });
            rerenderState(selectionState());
            expect(openViewButton().textContent).toBe('Open view');
            expect(openViewButton().disabled).toBe(false);
            fireEvent.click(openViewButton());
            expect(onSelect).toHaveBeenCalledTimes(2);
        });

        it('closes the All users confirmation when the status leaves selection_required', () => {
            const { rerenderState } = renderSelection(vi.fn());
            fireEvent.click(screen.getByRole('button', { name: /^All users/ }));
            fireEvent.click(openViewButton());
            expect(screen.getByRole('dialog', { name: 'Show images from all InvokeAI users?' })).toBeTruthy();

            rerenderState({ ...selectionState(), status: 'applying' });
            rerenderState(selectionState());
            expect(screen.queryByRole('dialog')).toBeNull();
        });
    });
});
