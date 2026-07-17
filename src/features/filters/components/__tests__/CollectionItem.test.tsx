import * as React from 'react';
import { fireEvent, render, screen } from '../../../../test/testUtils';
import { describe, expect, it, vi } from 'vitest';
import type { Collection, FilterState } from '../../../../types';
import { CollectionItem } from '../CollectionItem';
import { createDefaultFilters } from '../../../../utils/filterState';

vi.mock('../../../../components/ui/PrivacyAwareThumbnail', () => ({
    PrivacyAwareThumbnail: ({ src }: { src?: string | null }) => (
        <div data-testid="privacy-aware-thumbnail" data-src={src || ''} />
    )
}));

const filters: FilterState = {
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
    collectionId: null
};

const baseCollection: Collection = {
    id: 'collection-1',
    name: 'Collection One',
    imageIds: [],
    count: 1,
    createdAt: 1,
    updatedAt: 1,
    source: 'ambit'
};

const smartCollection: Collection = {
    ...baseCollection,
    id: 'smart-collection-1',
    name: 'Smart Collection One',
    filters: createDefaultFilters({ dateRange: 'today' })
};

const noopDrag = (_event: React.DragEvent, _collectionId: string) => { };
const noopDrop = (_event: React.DragEvent, _collectionId: string) => { };
const noopContextMenu = (_event: React.MouseEvent, _collectionId: string) => { };

const renderCollectionItem = (
    collection: Collection,
    options: {
        isThumbnailPending?: boolean;
        viewMode?: 'grid' | 'list';
    } = {}
) => render(
    <CollectionItem
        col={collection}
        filters={filters}
        setFilters={() => { }}
        editingColId={null}
        editName=""
        setEditName={() => { }}
        setEditingColId={() => { }}
        handleRenameSubmit={() => { }}
        handleDragEnter={noopDrag}
        handleDragOver={noopDrag}
        handleDragLeave={() => { }}
        handleDrop={noopDrop}
        handleContextMenu={noopContextMenu}
        dropTargetId={null}
        viewMode={options.viewMode ?? 'list'}
        isThumbnailPending={options.isThumbnailPending}
    />
);

describe('CollectionItem thumbnail hydration states', () => {
    it('renders a skeleton while a collection thumbnail is pending', () => {
        renderCollectionItem(baseCollection, { isThumbnailPending: true });

        expect(screen.getByTestId('collection-thumbnail-skeleton')).toBeTruthy();
        expect(screen.queryByTestId('collection-thumbnail-fallback')).toBeNull();
        expect(screen.queryByTestId('privacy-aware-thumbnail')).toBeNull();
    });

    it('renders the fallback once a collection has no thumbnail pending', () => {
        renderCollectionItem({
            ...baseCollection,
            count: 0
        });

        expect(screen.getByTestId('collection-thumbnail-fallback')).toBeTruthy();
        expect(screen.queryByTestId('collection-thumbnail-skeleton')).toBeNull();
        expect(screen.queryByTestId('privacy-aware-thumbnail')).toBeNull();
    });

    it('renders an existing thumbnail instead of the pending skeleton', () => {
        renderCollectionItem({
            ...baseCollection,
            thumbnail: 'asset://collection-thumb.webp'
        }, { isThumbnailPending: true });

        expect(screen.getByTestId('privacy-aware-thumbnail').getAttribute('data-src')).toBe('asset://collection-thumb.webp');
        expect(screen.queryByTestId('collection-thumbnail-skeleton')).toBeNull();
        expect(screen.queryByTestId('collection-thumbnail-fallback')).toBeNull();
    });

    it('renders the pending skeleton in grid mode', () => {
        renderCollectionItem(baseCollection, {
            isThumbnailPending: true,
            viewMode: 'grid'
        });

        expect(screen.getByTestId('collection-thumbnail-skeleton')).toBeTruthy();
    });

    it('renders a skeleton while a smart collection thumbnail is pending', () => {
        renderCollectionItem(smartCollection, { isThumbnailPending: true });

        expect(screen.getByTestId('collection-thumbnail-skeleton')).toBeTruthy();
        expect(screen.queryByTestId('collection-thumbnail-fallback')).toBeNull();
        expect(screen.queryByTestId('privacy-aware-thumbnail')).toBeNull();
    });

    it('renders a cached smart collection thumbnail instead of the pending skeleton', () => {
        renderCollectionItem({
            ...smartCollection,
            thumbnail: 'asset://cached-smart-thumb.webp',
            thumbnailSourceKind: 'dynamic'
        }, { isThumbnailPending: true });

        expect(screen.getByTestId('privacy-aware-thumbnail').getAttribute('data-src')).toBe('asset://cached-smart-thumb.webp');
        expect(screen.queryByTestId('collection-thumbnail-skeleton')).toBeNull();
        expect(screen.queryByTestId('collection-thumbnail-fallback')).toBeNull();
    });

    it('renders the smart collection fallback after pending clears with no thumbnail', () => {
        renderCollectionItem(smartCollection);

        expect(screen.getByTestId('collection-thumbnail-fallback')).toBeTruthy();
        expect(screen.queryByTestId('collection-thumbnail-skeleton')).toBeNull();
        expect(screen.queryByTestId('privacy-aware-thumbnail')).toBeNull();
    });

    it('shows an unknown smart count distinctly from a verified zero in both views', () => {
        const unknownSmart = { ...smartCollection, count: undefined, imageIds: ['one', 'two'] };
        const view = renderCollectionItem(unknownSmart);

        const listCount = screen.getByTitle('Count not calculated');
        expect(listCount.textContent).toBe('\u2014');
        expect(listCount.getAttribute('aria-label')).toBe('Count not calculated');

        view.rerender(
            <CollectionItem
                col={unknownSmart}
                filters={filters}
                setFilters={() => { }}
                editingColId={null}
                editName=""
                setEditName={() => { }}
                setEditingColId={() => { }}
                handleRenameSubmit={() => { }}
                handleDragEnter={noopDrag}
                handleDragOver={noopDrag}
                handleDragLeave={() => { }}
                handleDrop={noopDrop}
                handleContextMenu={noopContextMenu}
                dropTargetId={null}
                viewMode="grid"
            />
        );
        expect(screen.getByTitle('Count not calculated').textContent).toBe('\u2014');

        view.rerender(
            <CollectionItem
                col={{ ...unknownSmart, count: 0 }}
                filters={filters}
                setFilters={() => { }}
                editingColId={null}
                editName=""
                setEditName={() => { }}
                setEditingColId={() => { }}
                handleRenameSubmit={() => { }}
                handleDragEnter={noopDrag}
                handleDragOver={noopDrag}
                handleDragLeave={() => { }}
                handleDrop={noopDrop}
                handleContextMenu={noopContextMenu}
                dropTargetId={null}
            />
        );
        expect(screen.queryByTitle('Count not calculated')).toBeNull();
        expect(screen.getByText('0')).toBeTruthy();
    });

    it('routes inline rename changes, submission, and blur cancellation', () => {
        const setEditName = vi.fn();
        const setEditingColId = vi.fn();
        const handleRenameSubmit = vi.fn((event: React.FormEvent) => event.preventDefault());
        render(
            <CollectionItem
                col={baseCollection} filters={filters} setFilters={vi.fn()} editingColId={baseCollection.id} editName="Draft"
                setEditName={setEditName} setEditingColId={setEditingColId} handleRenameSubmit={handleRenameSubmit}
                handleDragEnter={noopDrag} handleDragOver={noopDrag} handleDragLeave={vi.fn()} handleDrop={noopDrop}
                handleContextMenu={noopContextMenu} dropTargetId={null}
            />
        );
        const input = screen.getByDisplayValue('Draft');
        fireEvent.change(input, { target: { value: 'Renamed' } });
        fireEvent.submit(input.closest('form') as HTMLFormElement);
        fireEvent.blur(input);
        expect(setEditName).toHaveBeenCalledWith('Renamed');
        expect(handleRenameSubmit).toHaveBeenCalledTimes(1);
        expect(setEditingColId).toHaveBeenCalledWith(null);
    });

    it('routes drag, drop, and context-menu events with the collection id', () => {
        const handleDragEnter = vi.fn();
        const handleDragOver = vi.fn();
        const handleDragLeave = vi.fn();
        const handleDrop = vi.fn();
        const handleContextMenu = vi.fn();
        const { container } = render(
            <CollectionItem
                col={baseCollection} filters={filters} setFilters={vi.fn()} editingColId={null} editName=""
                setEditName={vi.fn()} setEditingColId={vi.fn()} handleRenameSubmit={vi.fn()}
                handleDragEnter={handleDragEnter} handleDragOver={handleDragOver} handleDragLeave={handleDragLeave}
                handleDrop={handleDrop} handleContextMenu={handleContextMenu} dropTargetId={baseCollection.id}
            />
        );
        const root = container.firstElementChild as HTMLElement;
        fireEvent.dragEnter(root); fireEvent.dragOver(root); fireEvent.dragLeave(root); fireEvent.drop(root); fireEvent.contextMenu(root);
        expect(handleDragEnter).toHaveBeenCalledWith(expect.anything(), baseCollection.id);
        expect(handleDragOver).toHaveBeenCalledWith(expect.anything(), baseCollection.id);
        expect(handleDragLeave).toHaveBeenCalledTimes(1);
        expect(handleDrop).toHaveBeenCalledWith(expect.anything(), baseCollection.id);
        expect(handleContextMenu).toHaveBeenCalledWith(expect.anything(), baseCollection.id);
        expect(root.className).toContain('ring-2');
    });

    it('selects and clears collections from list and grid modes', () => {
        let current = filters;
        const setFilters = vi.fn((update: (previous: FilterState) => FilterState) => { current = update(current); });
        const shared = {
            col: baseCollection, setFilters, editingColId: null, editName: '', setEditName: vi.fn(), setEditingColId: vi.fn(),
            handleRenameSubmit: vi.fn(), handleDragEnter: noopDrag, handleDragOver: noopDrag, handleDragLeave: vi.fn(),
            handleDrop: noopDrop, handleContextMenu: noopContextMenu, dropTargetId: null
        };
        const { rerender } = render(<CollectionItem {...shared} filters={current} />);
        fireEvent.click(screen.getByTitle(baseCollection.name));
        expect(current.collectionId).toBe(baseCollection.id);
        rerender(<CollectionItem {...shared} filters={current} />);
        fireEvent.click(screen.getByTitle(baseCollection.name));
        expect(current.collectionId).toBeNull();

        rerender(<CollectionItem {...shared} filters={current} viewMode="grid" />);
        fireEvent.click(screen.getByTitle(baseCollection.name));
        expect(current.collectionId).toBe(baseCollection.id);
        rerender(<CollectionItem {...shared} filters={current} viewMode="grid" />);
        fireEvent.contextMenu(screen.getByTitle(baseCollection.name));
        fireEvent.click(screen.getByTitle(baseCollection.name));
        expect(current.collectionId).toBeNull();
    });

    it('renders archived, pinned, smart, thumbnail, count, and color variants', () => {
        const colors = ['red', 'orange', 'green', 'blue', 'purple', 'unknown', undefined];
        const shared = {
            filters, setFilters: vi.fn(), editingColId: null, editName: '', setEditName: vi.fn(), setEditingColId: vi.fn(),
            handleRenameSubmit: vi.fn(), handleDragEnter: noopDrag, handleDragOver: noopDrag, handleDragLeave: vi.fn(),
            handleDrop: noopDrop, handleContextMenu: noopContextMenu, dropTargetId: null
        };
        const { container, rerender } = render(<CollectionItem {...shared} col={{ ...smartCollection, thumbnail: 'thumb', isArchived: true, isPinned: true, color: 'red', count: 2, imageIds: ['a', 'b'] }} />);
        expect(screen.getByTestId('privacy-aware-thumbnail')).toBeTruthy();
        expect(screen.getByText('2')).toBeTruthy();
        expect(container.querySelector('.bg-red-500')).toBeTruthy();

        for (const color of colors) {
            rerender(<CollectionItem {...shared} col={{ ...baseCollection, color }} viewMode="grid" />);
            expect(screen.getByTitle(baseCollection.name)).toBeTruthy();
        }
        rerender(<CollectionItem {...shared} col={{ ...baseCollection, isArchived: true }} />);
        expect(screen.getByTestId('collection-thumbnail-fallback')).toBeTruthy();
        rerender(<CollectionItem {...shared} col={{ ...smartCollection, isPinned: true }} viewMode="grid" />);
        expect(screen.getByTitle(smartCollection.name).className).toContain('border-sage-400');
    });

    it('covers grid thumbnails and colored list hydration variants', () => {
        const shared = {
            filters: { ...filters, collectionId: baseCollection.id }, setFilters: vi.fn(), editingColId: null, editName: '', setEditName: vi.fn(), setEditingColId: vi.fn(),
            handleRenameSubmit: vi.fn(), handleDragEnter: noopDrag, handleDragOver: noopDrag, handleDragLeave: vi.fn(),
            handleDrop: noopDrop, handleContextMenu: noopContextMenu
        };
        const { container, rerender } = render(
            <CollectionItem {...shared} col={{ ...baseCollection, thumbnail: 'thumb', isArchived: true, filters: smartCollection.filters, count: undefined, imageIds: ['a', 'b'] }} dropTargetId={baseCollection.id} viewMode="grid" />
        );
        expect(screen.getByTestId('privacy-aware-thumbnail')).toBeTruthy();
        expect(screen.getByTitle(baseCollection.name).className).toContain('scale-105');
        expect(container.querySelector('.opacity-70.italic')).toBeTruthy();

        rerender(<CollectionItem {...shared} filters={filters} col={{ ...baseCollection, thumbnail: 'thumb', count: undefined, imageIds: ['a', 'b'] }} dropTargetId={null} viewMode="grid" />);
        expect(screen.getByTestId('privacy-aware-thumbnail')).toBeTruthy();
        expect(screen.getByText('2')).toBeTruthy();

        rerender(<CollectionItem {...shared} filters={filters} col={{ ...baseCollection, color: 'blue' }} dropTargetId={null} isThumbnailPending />);
        expect(screen.getByTestId('collection-thumbnail-skeleton')).toBeTruthy();
        expect(container.querySelector('.bg-blue-500')).toBeTruthy();

        rerender(<CollectionItem {...shared} filters={filters} col={{ ...smartCollection, color: 'green' }} dropTargetId={null} />);
        expect(screen.getByTestId('collection-thumbnail-fallback')).toBeTruthy();
        expect(container.querySelector('.bg-green-500')).toBeTruthy();
    });
});
