import * as React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Collection, FilterState, GeneratorTool } from '../../../../types';
import { CollectionEditorModal } from '../CollectionEditorModal';
import { useInvokeOwnerScopeStore } from '../../../../stores/invokeOwnerScopeStore';

vi.mock('framer-motion', async () => {
    const ReactModule = await import('react');
    type MotionProps = React.HTMLAttributes<HTMLDivElement> & {
        initial?: unknown;
        animate?: unknown;
        exit?: unknown;
        transition?: unknown;
    };
    return {
        AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
        motion: {
            div: ({ initial: _initial, animate: _animate, exit: _exit, transition: _transition, ...props }: MotionProps) =>
                ReactModule.createElement('div', props),
        },
    };
});

vi.mock('../../../../utils/dateFilters', () => ({
    getDateFilterLabel: (filters: FilterState) => filters.dateRange === 'all' ? null : `Date:${filters.dateRange}`,
}));

const createFilters = (overrides: Partial<FilterState> = {}): FilterState => ({
    searchQuery: '',
    models: [],
    tools: [],
    loras: [],
    embeddings: [],
    hypernetworks: [],
    samplers: [],
    generationTypes: [],
    controlNets: [],
    ipAdapters: [],
    dateRange: 'all',
    favoritesOnly: false,
    collectionId: null,
    ...overrides,
});

const createCollection = (filters?: FilterState): Collection => ({
    id: 'collection-1',
    name: 'Portfolio',
    imageIds: [],
    createdAt: 1,
    filters,
});

const clickRemoveForText = (text: string | RegExp) => {
    const label = screen.getByText(text);
    const chip = label.parentElement;
    const button = chip?.querySelector('button');
    if (!(button instanceof HTMLButtonElement)) throw new Error(`Missing remove button for ${String(text)}`);
    fireEvent.click(button);
};

describe('CollectionEditorModal', () => {
    const onClose = vi.fn();
    const onSave = vi.fn();
    const currentFilters = createFilters({ models: ['current-model'], favoritesOnly: true });

    beforeEach(() => {
        vi.clearAllMocks();
        useInvokeOwnerScopeStore.getState().resetOwnerScopeState();
    });

    it('offers All Users and discovered owners for Ambit collection visibility', async () => {
        const onUpdateScope = vi.fn().mockResolvedValue(true);
        useInvokeOwnerScopeStore.getState().setOwnerScopeState({
            status: 'ready',
            scope: { mode: 'all', dbPath: 'invoke.db', imagesRoot: 'C:/Invoke' },
            discovery: {
                schemaMode: 'multi_user',
                dbPath: 'invoke.db',
                imagesRoot: 'C:/Invoke',
                unassignedImageCount: 0,
                owners: [{ ownerId: 'jupiter', displayName: 'Jupiter', imageCount: 4 }],
            },
        });
        render(
            <CollectionEditorModal
                isOpen
                onClose={onClose}
                collection={{ ...createCollection(), source: 'ambit', invokeSourceId: 'invoke.db' }}
                filters={currentFilters}
                onSave={onSave}
                onUpdateScope={onUpdateScope}
            />,
        );

        fireEvent.change(screen.getByRole('combobox', { name: 'Collection visibility' }), {
            target: { value: 'owner:jupiter' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Update Visibility' }));

        await waitFor(() => expect(onUpdateScope).toHaveBeenCalledWith('collection-1', {
            mode: 'owner',
            dbPath: 'invoke.db',
            ownerId: 'jupiter',
        }));
        expect(onClose).toHaveBeenCalled();
    });

    it('renders nothing without a collection or while closed', () => {
        const { container, rerender } = render(
            <CollectionEditorModal
                isOpen
                onClose={onClose}
                collection={null}
                filters={currentFilters}
                onSave={onSave}
            />,
        );
        expect(container.innerHTML).toBe('');

        rerender(
            <CollectionEditorModal
                isOpen={false}
                onClose={onClose}
                collection={createCollection()}
                filters={currentFilters}
                onSave={onSave}
            />,
        );
        expect(container.innerHTML).toBe('');
    });

    it('shows InvokeAI source state and resets local organization only when the source is available', async () => {
        const onResetInvokeCollection = vi.fn().mockResolvedValue(true);
        const { rerender } = render(
            <CollectionEditorModal
                isOpen
                onClose={onClose}
                collection={{
                    ...createCollection(),
                    source: 'invoke',
                    name: 'Local label',
                    invokeSourceName: 'Upstream label',
                    invokeSourcePresent: false,
                }}
                filters={currentFilters}
                onSave={onSave}
                onResetInvokeCollection={onResetInvokeCollection}
            />,
        );

        expect(screen.getByText('Source unavailable')).toBeTruthy();
        expect(screen.getByText(/Local name override/)).toBeTruthy();
        expect((screen.getByRole('button', { name: /reset to invokeai/i }) as HTMLButtonElement).disabled).toBe(true);
        expect(screen.queryByText('Collection Rules')).toBeNull();

        rerender(
            <CollectionEditorModal
                isOpen
                onClose={onClose}
                collection={{
                    ...createCollection(),
                    source: 'invoke',
                    name: 'Local label',
                    invokeSourceName: 'Upstream label',
                    invokeSourcePresent: true,
                }}
                filters={currentFilters}
                onSave={onSave}
                onResetInvokeCollection={onResetInvokeCollection}
            />,
        );
        fireEvent.click(screen.getByRole('button', { name: /reset to invokeai/i }));
        await waitFor(() => expect(onResetInvokeCollection).toHaveBeenCalledWith('collection-1'));
        expect(onClose).toHaveBeenCalled();
    });

    it('saves static drafts and can replace them with the current view', async () => {
        render(
            <CollectionEditorModal
                isOpen
                onClose={onClose}
                collection={createCollection()}
                filters={currentFilters}
                onSave={onSave}
            />,
        );

        expect(screen.getByText('Static')).toBeTruthy();
        expect(screen.queryByText(/No active rules/)).toBeNull();
        expect(screen.queryByRole('button', { name: /remove all rules/i })).toBeNull();

        fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
        expect(onSave).toHaveBeenCalledWith('collection-1', undefined);
        expect(onClose).toHaveBeenCalledOnce();

        fireEvent.click(screen.getByRole('button', { name: /update with current view/i }));
        expect(onSave).toHaveBeenLastCalledWith('collection-1', currentFilters);
        expect(onClose).toHaveBeenCalledTimes(2);
        await waitFor(() => expect(screen.getByText('Static')).toBeTruthy());
    });

    it('renders every saved rule type and removes each from the saved draft', async () => {
        const draft = createFilters({
            searchQuery: 'castle',
            dateRange: 'custom',
            dateFrom: '2025-01-01',
            dateTo: '2025-02-01',
            favoritesOnly: true,
            minSteps: 2,
            maxSteps: 40,
            minCfg: 3,
            maxCfg: 9,
            models: ['model'],
            tools: [GeneratorTool.FORGE],
            loras: ['lora'],
            embeddings: ['embedding'],
            hypernetworks: ['hyper'],
            samplers: ['sampler'],
            generationTypes: ['img2img'],
        });
        render(
            <CollectionEditorModal
                isOpen
                onClose={onClose}
                collection={createCollection(draft)}
                filters={currentFilters}
                onSave={onSave}
            />,
        );
        await waitFor(() => expect(screen.getByText('Dynamic')).toBeTruthy());

        expect(screen.getByText(/castle/)).toBeTruthy();
        expect(screen.getByText('Date:custom')).toBeTruthy();
        expect(screen.getByText('Favorites')).toBeTruthy();
        expect(screen.getByText('Steps: 2-40')).toBeTruthy();
        expect(screen.getByText('CFG: 3-9')).toBeTruthy();
        for (const value of ['model', GeneratorTool.FORGE, 'lora', 'embedding', 'hyper', 'sampler', 'img2img']) {
            expect(screen.getByText(value)).toBeTruthy();
        }

        clickRemoveForText(/castle/);
        clickRemoveForText('Date:custom');
        clickRemoveForText('Favorites');
        clickRemoveForText('Steps: 2-40');
        clickRemoveForText('CFG: 3-9');
        for (const value of ['model', GeneratorTool.FORGE, 'lora', 'embedding', 'hyper', 'sampler', 'img2img']) {
            clickRemoveForText(value);
        }

        expect(screen.getByText(/No active rules/)).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

        const saved = onSave.mock.calls.at(-1)?.[1] as FilterState;
        expect(saved).toMatchObject({
            searchQuery: '',
            dateRange: 'all',
            dateFrom: undefined,
            dateTo: undefined,
            favoritesOnly: false,
            minSteps: undefined,
            maxSteps: undefined,
            minCfg: undefined,
            maxCfg: undefined,
            models: [],
            tools: [],
            loras: [],
            embeddings: [],
            hypernetworks: [],
            samplers: [],
            generationTypes: [],
        });
    });

    it('renders both open-ended numeric range directions', async () => {
        const first = createFilters({
            minSteps: 4,
            maxCfg: 8,
            models: undefined as unknown as string[],
        });
        const { rerender } = render(
            <CollectionEditorModal
                isOpen
                onClose={onClose}
                collection={createCollection(first)}
                filters={currentFilters}
                onSave={onSave}
            />,
        );
        await waitFor(() => expect(screen.getByText(/Steps: 4-/)).toBeTruthy());
        expect(screen.getByText(/CFG: 0-8/)).toBeTruthy();

        const second = createFilters({ maxSteps: 30, minCfg: 2 });
        rerender(
            <CollectionEditorModal
                isOpen
                onClose={onClose}
                collection={{ ...createCollection(second), id: 'collection-2' }}
                filters={currentFilters}
                onSave={onSave}
            />,
        );
        await waitFor(() => expect(screen.getByText(/Steps: 0-30/)).toBeTruthy());
        expect(screen.getByText(/CFG: 2-/)).toBeTruthy();
    });

    it('converts a dynamic collection to static', async () => {
        render(
            <CollectionEditorModal
                isOpen
                onClose={onClose}
                collection={createCollection(createFilters({ models: ['model'] }))}
                filters={currentFilters}
                onSave={onSave}
            />,
        );
        await waitFor(() => expect(screen.getByText('Dynamic')).toBeTruthy());

        fireEvent.click(screen.getByRole('button', { name: /remove all rules/i }));

        expect(onSave).toHaveBeenCalledWith('collection-1', undefined);
        expect(onClose).toHaveBeenCalledOnce();
    });

    it('closes from the backdrop and header while inner clicks stay contained', () => {
        const { container } = render(
            <CollectionEditorModal
                isOpen
                onClose={onClose}
                collection={createCollection()}
                filters={currentFilters}
                onSave={onSave}
            />,
        );
        const backdrop = container.firstElementChild;
        const panel = backdrop?.firstElementChild;
        if (!(backdrop instanceof HTMLElement) || !(panel instanceof HTMLElement)) {
            throw new Error('Missing modal layers');
        }

        fireEvent.click(panel);
        expect(onClose).not.toHaveBeenCalled();
        fireEvent.click(backdrop);
        expect(onClose).toHaveBeenCalledOnce();

        const closeIcon = container.querySelector('.lucide-x');
        const closeButton = closeIcon?.closest('button');
        if (!(closeButton instanceof HTMLButtonElement)) throw new Error('Missing header close button');
        fireEvent.click(closeButton);
        expect(onClose).toHaveBeenCalledTimes(2);
    });

    it('resets its draft when switching from a dynamic to a static collection', async () => {
        const { rerender } = render(
            <CollectionEditorModal
                isOpen
                onClose={onClose}
                collection={createCollection(createFilters({ models: ['model'] }))}
                filters={currentFilters}
                onSave={onSave}
            />,
        );
        await waitFor(() => expect(screen.getByText('Dynamic')).toBeTruthy());
        const staleRemoveButton = screen.getByText('model').parentElement?.querySelector('button');
        if (!(staleRemoveButton instanceof HTMLButtonElement)) throw new Error('Missing model remove button');

        rerender(
            <CollectionEditorModal
                isOpen
                onClose={onClose}
                collection={{ ...createCollection(), id: 'static-2' }}
                filters={currentFilters}
                onSave={onSave}
            />,
        );

        await waitFor(() => expect(screen.getByText('Static')).toBeTruthy());
        expect(screen.queryByText(/No active rules/)).toBeNull();
        fireEvent.click(staleRemoveButton);
        expect(screen.getByText('Static')).toBeTruthy();
    });
});
