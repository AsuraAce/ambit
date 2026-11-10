import { act, fireEvent, render, screen, waitFor } from '../../../test/testUtils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { InvokeOwnerScopeState } from '../../../contexts/SyncContext';
import { InvokeOwnerScopeGate } from '../InvokeOwnerScopeGate';
import { useInvokeOwnerScopeStore } from '../../../stores/invokeOwnerScopeStore';

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
            id: Symbol('switch'), origin: 'user', rootPath: 'D:/Invoke', targetLabel: 'Odin',
            phase: 'preparing', viewCommitted: false, progress: { current: 1, total: 4 }, cancel,
        });
        renderGate({ status: 'applying', rootPath: 'D:/Invoke' });
        expect(screen.getByRole('heading', { name: 'Preparing view — Odin' })).toBe(document.activeElement);
        const button = screen.getByRole('button', { name: 'Cancel' });
        button.focus();
        fireEvent.click(button);
        expect(cancel).toHaveBeenCalledTimes(1);

        act(() => useInvokeOwnerScopeStore.getState().setOperation(current => current && ({
            ...current, phase: 'cancelling', progress: { current: 2, total: 4 },
        })));
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
        const selectionPromise = new Promise<void>(resolve => { resolveSelection = resolve; });
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
            status: 'error', rootPath: 'D:/Invoke',
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

    it.each([false, true])('explains real failures even after a cancellation request: %s', async cancelled => {
        if (cancelled) useInvokeOwnerScopeStore.getState().setOperation({
            id: Symbol('cancelled operation'), origin: 'user', rootPath: 'D:/Invoke', targetLabel: 'Odin',
            phase: 'cancelled', viewCommitted: false, progress: { current: 0, total: 0 },
        });
        const { callbacks } = renderGate({
            status: 'error', rootPath: 'D:/Invoke',
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
            id: Symbol('failed operation'), origin: 'user', rootPath: 'D:/Invoke', targetLabel: 'Odin',
            phase: 'failed', viewCommitted: true, progress: { current: 2, total: 3 }, retry,
        });
        const { callbacks } = renderGate({
            status: 'error', rootPath: 'D:/Invoke', error: 'Owner visibility could not be verified.',
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
});
