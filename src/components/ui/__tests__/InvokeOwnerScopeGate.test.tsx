import { act, fireEvent, render, screen, waitFor } from '../../../test/testUtils';
import { describe, expect, it, vi } from 'vitest';
import type { InvokeOwnerScopeState } from '../../../contexts/SyncContext';
import { InvokeOwnerScopeGate } from '../InvokeOwnerScopeGate';

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
    it('explains the safety boundary while owner discovery is pending', () => {
        renderGate({
            status: 'discovering',
            progress: { current: 0, total: 0, message: 'Checking InvokeAI owner information...' },
        });

        expect(screen.getByRole('status')).toBeTruthy();
        expect(screen.getByText('InvokeAI library')).toBeTruthy();
        expect(screen.getByRole('heading', { name: 'Preparing your InvokeAI view' })).toBeTruthy();
        expect(screen.getByText(/verifying which InvokeAI images/i)).toBeTruthy();
        expect(screen.getByText('No images or collections are being deleted.')).toBeTruthy();
        expect(screen.getByText('Checking InvokeAI owner information...')).toBeTruthy();
        expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBeNull();
    });

    it('shows real reconciliation counts without inventing a global percentage', () => {
        renderGate({
            status: 'applying',
            progress: { current: 500, total: 2000, message: 'Updating InvokeAI image details...' },
        });

        expect(screen.getByText('500 / 2,000')).toBeTruthy();
        expect(screen.getByText('Updating InvokeAI image details...')).toBeTruthy();
        expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('500');
        expect(screen.getByRole('progressbar').getAttribute('aria-valuemax')).toBe('2000');
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

            expect(screen.getByRole('heading', { name: 'Switching to Odin' })).toBeTruthy();
            await act(async () => {
                await vi.advanceTimersByTimeAsync(5000);
            });
            expect(screen.getByText(/5s elapsed/)).toBeTruthy();
        } finally {
            vi.useRealTimers();
        }
    });

    it('owns multi-user selection, applies an owner immediately, and focuses its heading', async () => {
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
        expect(callbacks.onSelect).toHaveBeenCalledWith({
            dbPath: 'D:/Invoke/databases/invokeai.db',
            mode: 'owner',
            ownerId: 'owner-a',
        });
    });

    it('explains blocking failures in plain language and keeps raw details collapsed', async () => {
        const { callbacks } = renderGate({
            status: 'error',
            failure: { kind: 'preparation_failed', details: 'database locked' },
            error: 'database locked',
        });

        const heading = screen.getByRole('heading', { name: 'InvokeAI library preparation failed' });
        await waitFor(() => expect(document.activeElement).toBe(heading));
        expect(screen.getByText(/staying hidden to avoid showing the wrong library/i)).toBeTruthy();
        expect((screen.getByText('Technical details').parentElement as HTMLDetailsElement).open).toBe(false);
        fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
        fireEvent.click(screen.getByRole('button', { name: 'Open Settings' }));
        expect(callbacks.onRetry).toHaveBeenCalledTimes(1);
        expect(callbacks.onOpenSettings).toHaveBeenCalledTimes(1);
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
