import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InvokeReferenceLinks } from '../InvokeReferenceLinks';

const mocks = vi.hoisted(() => ({ getInvokeReferenceGraph: vi.fn() }));

vi.mock('../../../../../services/db/invokeReferenceRepo', async importOriginal => {
    const actual = await importOriginal<typeof import('../../../../../services/db/invokeReferenceRepo')>();
    return { ...actual, getInvokeReferenceGraph: mocks.getInvokeReferenceGraph };
});

const renderLinks = (onOpenImage = vi.fn().mockResolvedValue(true)) => {
    const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    return {
        onOpenImage,
        ...render(
            <QueryClientProvider client={queryClient}>
                <InvokeReferenceLinks imageId="current" onOpenImage={onOpenImage} />
            </QueryClientProvider>
        ),
    };
};

describe('InvokeReferenceLinks', () => {
    beforeEach(() => vi.clearAllMocks());

    it('renders grouped forward and reverse provenance with unavailable states disabled', async () => {
        mocks.getInvokeReferenceGraph.mockResolvedValue({
            sourceImages: [
                {
                    imageId: 'source',
                    invokeImageName: 'source.png',
                    availability: 'available',
                    roles: ['init_image', 'ip_adapter_image'],
                },
                {
                    imageId: null,
                    invokeImageName: 'missing.png',
                    availability: 'unresolved',
                    roles: ['controlnet_image'],
                },
            ],
            usedBy: [
                {
                    imageId: null,
                    invokeImageName: 'removed.png',
                    availability: 'removed',
                    roles: ['t2i_adapter_image'],
                },
                {
                    imageId: 'current',
                    invokeImageName: 'self.png',
                    availability: 'available',
                    roles: ['init_image'],
                },
            ],
        });

        renderLinks();

        expect(await screen.findByRole('heading', { name: 'Source Images' })).toBeTruthy();
        expect(screen.getByRole('heading', { name: 'Used By' })).toBeTruthy();
        expect(screen.getByText('IP-Adapter input')).toBeTruthy();
        expect((screen.getByText('Unavailable in Ambit').closest('button') as HTMLButtonElement).disabled).toBe(true);
        expect((screen.getByText('Removed from library').closest('button') as HTMLButtonElement).disabled).toBe(true);
        expect((screen.getByText('Current image').closest('button') as HTMLButtonElement).disabled).toBe(true);
        expect((screen.getByRole('button', { name: 'Open source.png' }) as HTMLButtonElement).disabled).toBe(false);
    });

    it('opens a resolved image once, exposes pending state, and refetches when it vanished', async () => {
        let resolveOpen!: (value: boolean) => void;
        const onOpenImage = vi.fn(() => new Promise<boolean>(resolve => { resolveOpen = resolve; }));
        mocks.getInvokeReferenceGraph
            .mockResolvedValueOnce({
                sourceImages: [{
                    imageId: 'source',
                    invokeImageName: 'source.png',
                    availability: 'available',
                    roles: ['init_image'],
                }],
                usedBy: [],
            })
            .mockResolvedValueOnce({ sourceImages: [], usedBy: [] });
        renderLinks(onOpenImage);

        const button = await screen.findByRole('button', { name: 'Open source.png' });
        fireEvent.click(button);
        expect(button.getAttribute('aria-busy')).toBe('true');
        fireEvent.click(button);
        expect(onOpenImage).toHaveBeenCalledTimes(1);

        resolveOpen(false);
        await waitFor(() => expect(mocks.getInvokeReferenceGraph).toHaveBeenCalledTimes(2));
        await waitFor(() => expect(screen.queryByRole('heading', { name: 'Source Images' })).toBeNull());
    });

    it('offers retry after a query failure', async () => {
        mocks.getInvokeReferenceGraph.mockRejectedValue(new Error('database unavailable'));
        renderLinks();

        const alert = await screen.findByRole('alert');
        expect(alert.textContent).toContain('Reference links are unavailable.');
        mocks.getInvokeReferenceGraph.mockResolvedValue({ sourceImages: [], usedBy: [] });
        fireEvent.click(screen.getByRole('button', { name: /retry/i }));
        await waitFor(() => expect(mocks.getInvokeReferenceGraph).toHaveBeenCalledTimes(2));
        await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    });
});
