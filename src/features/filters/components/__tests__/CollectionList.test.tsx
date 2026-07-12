import * as React from 'react';
import { fireEvent, render, screen, waitFor } from '../../../../test/testUtils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Collection, FilterState, SidebarSortOption } from '../../../../types';
import type { ComponentProps } from 'react';
import { useCollectionStore } from '../../../../stores/collectionStore';
import { CollectionList } from '../CollectionList';

const settingsContextMocks = vi.hoisted(() => ({
    resourceSortOptions: {} as Record<string, SidebarSortOption>,
    resourceViewModes: { collections: 'list' } as Record<string, 'list' | 'grid'>,
    setSettings: vi.fn()
}));

vi.mock('../../../../contexts/SettingsContext', () => ({
    useSettings: () => ({
        settings: {
            resourceViewModes: settingsContextMocks.resourceViewModes,
            resourceSortOptions: settingsContextMocks.resourceSortOptions
        },
        setSettings: settingsContextMocks.setSettings
    })
}));

vi.mock('../CollectionItem', () => ({
    CollectionItem: (props: {
        col: Collection;
        editingColId: string | null;
        editName: string;
        setEditName: (value: string) => void;
        setEditingColId: (value: string | null) => void;
        handleRenameSubmit: (event: React.FormEvent) => void;
        handleDragEnter: (event: React.DragEvent, id: string) => void;
        handleDragOver: (event: React.DragEvent, id: string) => void;
        handleDragLeave: (event: React.DragEvent) => void;
        handleDrop: (event: React.DragEvent, id: string) => void;
        handleContextMenu: (event: React.MouseEvent, id: string) => void;
        dropTargetId: string | null;
        viewMode: string;
        isThumbnailPending: boolean;
    }) => (
        <div
            data-testid={`collection-${props.col.id}`}
            data-view={props.viewMode}
            data-pending={String(props.isThumbnailPending)}
            data-drop={String(props.dropTargetId === props.col.id)}
            onDragEnter={event => props.handleDragEnter(event, props.col.id)}
            onDragOver={event => props.handleDragOver(event, props.col.id)}
            onDragLeave={props.handleDragLeave}
            onDrop={event => props.handleDrop(event, props.col.id)}
            onContextMenu={event => props.handleContextMenu(event, props.col.id)}
        >
            <span>{props.col.name}</span>
            <button aria-label={`rename-${props.col.id}`} onClick={() => { props.setEditingColId(props.col.id); props.setEditName(props.col.name); }}>rename</button>
            <button aria-label={`nested-leave-${props.col.id}`} onClick={() => props.handleDragLeave({
                preventDefault: vi.fn(),
                stopPropagation: vi.fn(),
                currentTarget: { contains: () => true },
                relatedTarget: {},
            } as unknown as React.DragEvent)}>nested leave</button>
            {props.editingColId === props.col.id && (
                <form onSubmit={props.handleRenameSubmit}>
                    <input aria-label={`name-${props.col.id}`} value={props.editName} onChange={event => props.setEditName(event.target.value)} />
                    <button type="submit">save name</button>
                </form>
            )}
        </div>
    )
}));

vi.mock('../../../collections/components/CollectionContextMenu', () => ({
    CollectionContextMenu: (props: Record<string, unknown>) => (
        <div data-testid="collection-menu" data-archived={String(props.isArchived)} data-pinned={String(props.isPinned)} data-thumbnail={String(props.hasCustomThumbnail)} data-color={String(props.currentColor)}>
            {['onClose', 'onRename', 'onToggleArchive', 'onTogglePin', 'onDelete', 'onPlaySlideshow', 'onExport', 'onResetThumbnail', 'onEditCollection'].map(key => (
                <button key={key} onClick={() => (props[key] as () => void)()}>{key}</button>
            ))}
            <button onClick={() => (props.onColorChange as (color: string | undefined) => void)('red')}>onColorChange</button>
        </div>
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

const setFilters: React.Dispatch<React.SetStateAction<FilterState>> = () => { };

const makeCollection = ({
    id,
    name,
    createdAt,
    updatedAt
}: {
    id: string;
    name: string;
    createdAt: number;
    updatedAt: number;
}): Collection => ({
    id,
    name,
    imageIds: [],
    count: 1,
    createdAt,
    updatedAt,
    source: 'ambit'
});

const renderCollectionList = (collections: Collection[]) => render(
    <CollectionList
        collections={collections}
        filters={filters}
        setFilters={setFilters}
        onDeleteCollection={vi.fn()}
    />
);

const expectCollectionOrder = (names: string[]) => {
    for (let index = 0; index < names.length - 1; index += 1) {
        const current = screen.getByText(names[index]);
        const next = screen.getByText(names[index + 1]);
        expect(current.compareDocumentPosition(next) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
};

describe('CollectionList persisted sort narrowing', () => {
    beforeEach(() => {
        settingsContextMocks.resourceSortOptions = {};
        settingsContextMocks.resourceViewModes = { collections: 'list' };
        settingsContextMocks.setSettings.mockClear();
        useCollectionStore.setState(useCollectionStore.getInitialState(), true);
    });

    it('uses collection date sorting when date_desc is persisted for collections', () => {
        settingsContextMocks.resourceSortOptions = { collections: 'date_desc' };

        renderCollectionList([
            makeCollection({
                id: 'old-recent',
                name: 'Old Recent',
                createdAt: 100,
                updatedAt: 900
            }),
            makeCollection({
                id: 'new-stale',
                name: 'New Stale',
                createdAt: 900,
                updatedAt: 100
            })
        ]);

        expectCollectionOrder(['New Stale', 'Old Recent']);
    });

    it('falls back to recent sorting when an invalid collection sort is persisted', () => {
        settingsContextMocks.resourceSortOptions = {
            collections: 'not_a_collection_sort' as unknown as SidebarSortOption
        };

        renderCollectionList([
            makeCollection({
                id: 'old-recent',
                name: 'Old Recent',
                createdAt: 100,
                updatedAt: 900
            }),
            makeCollection({
                id: 'new-stale',
                name: 'New Stale',
                createdAt: 900,
                updatedAt: 100
            })
        ]);

        expectCollectionOrder(['Old Recent', 'New Stale']);
    });
});

describe('CollectionList interactions', () => {
    const refreshSmartCounts = vi.fn().mockResolvedValue(undefined);

    const renderList = (overrides: Partial<ComponentProps<typeof CollectionList<Collection>>> = {}) => {
        const props: ComponentProps<typeof CollectionList<Collection>> = {
            collections: [makeCollection({ id: 'alpha', name: 'Alpha', createdAt: 1, updatedAt: 2 })],
            filters,
            setFilters,
            onDeleteCollection: vi.fn(),
            onRenameCollection: vi.fn(),
            onDropOnCollection: vi.fn(),
            onToggleArchiveCollection: vi.fn(),
            onTogglePinCollection: vi.fn(),
            onSetCollectionColor: vi.fn(),
            onPlayCollection: vi.fn(),
            onExportCollection: vi.fn(),
            onResetCollectionThumbnail: vi.fn(),
            onEditCollection: vi.fn(),
            ...overrides,
        };
        return { ...render(<CollectionList {...props} />), props };
    };

    beforeEach(() => {
        vi.clearAllMocks();
        settingsContextMocks.resourceSortOptions = {};
        settingsContextMocks.resourceViewModes = { collections: 'list' };
        useCollectionStore.setState({
            ...useCollectionStore.getInitialState(),
            refreshSmartCounts,
            thumbnailHydrationPendingIds: {},
            smartSummaryPendingIds: {},
        }, true);
    });

    it('renders toolbar extras, creation form, and a custom empty state', () => {
        renderList({
            collections: [],
            renderToolbarExtras: () => <span>toolbar extra</span>,
            renderCreationForm: () => <div>creation form</div>,
            emptyMessage: <strong>Nothing here</strong>,
        });
        expect(screen.getByText('toolbar extra')).toBeTruthy();
        expect(screen.getByText('creation form')).toBeTruthy();
        expect(screen.getByText('Nothing here')).toBeTruthy();
    });

    it('persists list-grid view changes in both directions', () => {
        const first = renderList();
        fireEvent.click(screen.getByTitle('Switch to Grid View'));
        expect(settingsContextMocks.setSettings.mock.calls[0][0]({}).resourceViewModes.collections).toBe('grid');
        first.unmount();

        settingsContextMocks.resourceViewModes = { collections: 'grid' };
        renderList();
        expect(screen.getByTestId('collection-alpha').dataset.view).toBe('grid');
        fireEvent.click(screen.getByTitle('Switch to List View'));
        expect(settingsContextMocks.setSettings.mock.calls.at(-1)?.[0]({ resourceViewModes: { collections: 'grid' } }).resourceViewModes.collections).toBe('list');
    });

    it('searches collections and clears the query when search closes', async () => {
        renderList({ collections: [
            makeCollection({ id: 'alpha', name: 'Alpha', createdAt: 1, updatedAt: 1 }),
            makeCollection({ id: 'beta', name: 'Beta', createdAt: 2, updatedAt: 2 }),
        ] });
        fireEvent.click(screen.getByTitle('Search Collections'));
        fireEvent.change(screen.getByPlaceholderText('Find collection...'), { target: { value: 'alp' } });
        await waitFor(() => expect(screen.queryByText('Beta')).toBeNull());
        fireEvent.click(screen.getByTitle('Search Collections'));
        expect(screen.queryByPlaceholderText('Find collection...')).toBeNull();
        fireEvent.click(screen.getByTitle('Search Collections'));
        expect((screen.getByPlaceholderText('Find collection...') as HTMLInputElement).value).toBe('');
        expect(screen.getByText('Beta')).toBeTruthy();
    });

    it('hides archived collections until requested and refreshes archived smart counts', async () => {
        const archived = { ...makeCollection({ id: 'archived', name: 'Archived', createdAt: 1, updatedAt: 1 }), isArchived: true };
        renderList({ collections: [archived] });
        expect(screen.queryByText('Archived')).toBeNull();
        fireEvent.click(screen.getByTitle('Include Archived'));
        expect(screen.getByText('Archived')).toBeTruthy();
        await waitFor(() => expect(refreshSmartCounts).toHaveBeenCalledWith({ includeArchived: true, markPending: true }));
        expect(screen.getByTitle('Hide Archived')).toBeTruthy();
    });

    it('refreshes a selected smart collection once per id', async () => {
        const smart = { ...makeCollection({ id: 'smart', name: 'Smart', createdAt: 1, updatedAt: 1 }), filters: { ...filters } };
        const view = renderList({ collections: [smart], filters: { ...filters, collectionId: 'smart' } });
        await waitFor(() => expect(refreshSmartCounts).toHaveBeenCalledWith({
            collectionIds: ['smart'], includeArchived: true, includePromptSearch: true, markPending: true
        }));
        refreshSmartCounts.mockClear();
        view.rerender(<CollectionList {...view.props} />);
        expect(refreshSmartCounts).not.toHaveBeenCalled();
    });

    it('separates pinned collections and forwards pending thumbnail state', () => {
        const pinned = { ...makeCollection({ id: 'pinned', name: 'Pinned One', createdAt: 1, updatedAt: 1 }), isPinned: true };
        const normal = makeCollection({ id: 'normal', name: 'Normal', createdAt: 2, updatedAt: 2 });
        useCollectionStore.setState({ thumbnailHydrationPendingIds: { pinned: true }, smartSummaryPendingIds: { normal: true } });
        renderList({ collections: [normal, pinned] });
        expect(screen.getByText('Pinned')).toBeTruthy();
        expect(screen.getByTestId('collection-pinned').dataset.pending).toBe('true');
        expect(screen.getByTestId('collection-normal').dataset.pending).toBe('true');
    });

    it('paginates non-pinned collections by sixty', () => {
        renderList({ collections: Array.from({ length: 61 }, (_, index) => makeCollection({
            id: `id-${index}`, name: `Collection ${String(index).padStart(2, '0')}`, createdAt: index, updatedAt: index
        })) });
        expect(screen.queryByText('Collection 00')).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: /show more/i }));
        expect(screen.getByText('Collection 00')).toBeTruthy();
    });

    it('submits valid renames and ignores blank names', () => {
        const first = renderList();
        fireEvent.click(screen.getByLabelText('rename-alpha'));
        fireEvent.change(screen.getByLabelText('name-alpha'), { target: { value: 'Renamed' } });
        fireEvent.click(screen.getByRole('button', { name: 'save name' }));
        expect(first.props.onRenameCollection).toHaveBeenCalledWith('alpha', 'Renamed');
        first.unmount();

        const second = renderList();
        fireEvent.click(screen.getByLabelText('rename-alpha'));
        fireEvent.change(screen.getByLabelText('name-alpha'), { target: { value: '   ' } });
        fireEvent.click(screen.getByRole('button', { name: 'save name' }));
        expect(second.props.onRenameCollection).not.toHaveBeenCalled();
    });

    it('handles drag enter, over, nested leave, external leave, and custom drops', () => {
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
        vi.spyOn(Math, 'random').mockReturnValue(0);
        const { props } = renderList();
        const item = screen.getByTestId('collection-alpha');
        const transfer = { dropEffect: 'none', types: ['custom'], getData: vi.fn((type: string) => type === 'application/x-ambit-image-ids' ? '["1"]' : '') };
        fireEvent.dragEnter(item, { dataTransfer: transfer });
        expect(item.dataset.drop).toBe('true');
        fireEvent.dragOver(item, { dataTransfer: transfer });
        expect(transfer.dropEffect).toBe('copy');
        fireEvent.click(screen.getByLabelText('nested-leave-alpha'));
        expect(item.dataset.drop).toBe('true');
        fireEvent.dragLeave(item, { relatedTarget: document.body, dataTransfer: transfer });
        expect(item.dataset.drop).toBe('false');
        fireEvent.drop(item, { dataTransfer: transfer });
        expect(props.onDropOnCollection).toHaveBeenCalledWith('alpha', '["1"]');
        expect(logSpy).toHaveBeenCalled();
        logSpy.mockRestore();
    });

    it.each([
        ['name_asc', ['Alpha', 'Zulu']],
        ['name_desc', ['Zulu', 'Alpha']],
        ['count_asc', ['Few', 'Many']],
        ['count_desc', ['Many', 'Few']],
        ['date_asc', ['Old', 'New']],
        ['recent_asc', ['Stale', 'Recent']],
        ['recent_desc', ['Recent', 'Stale']]
    ] as const)('sorts collections with %s', (sort, expected) => {
        settingsContextMocks.resourceSortOptions = { collections: sort };
        const expectedNames: readonly string[] = expected;
        const data = expectedNames.includes('Alpha')
            ? [
                makeCollection({ id: 'z', name: 'Zulu', createdAt: 2, updatedAt: 2 }),
                makeCollection({ id: 'a', name: 'Alpha', createdAt: 1, updatedAt: 1 })
            ]
            : expectedNames.includes('Few')
                ? [
                    { ...makeCollection({ id: 'many', name: 'Many', createdAt: 2, updatedAt: 2 }), count: 5 },
                    { ...makeCollection({ id: 'few', name: 'Few', createdAt: 1, updatedAt: 1 }), count: undefined, imageIds: ['1'] }
                ]
                : expectedNames.includes('Old')
                    ? [
                        makeCollection({ id: 'new', name: 'New', createdAt: 20, updatedAt: 1 }),
                        makeCollection({ id: 'old', name: 'Old', createdAt: 10, updatedAt: 2 })
                    ]
                    : [
                        { ...makeCollection({ id: 'recent', name: 'Recent', createdAt: 1, updatedAt: 20 }) },
                        { ...makeCollection({ id: 'stale', name: 'Stale', createdAt: 10, updatedAt: 0 }) }
                    ];
        renderList({ collections: data });
        expectCollectionOrder([...expected]);
    });

    it('persists sort selections and exercises the open dropdown trigger style', () => {
        renderList();
        fireEvent.click(screen.getByTitle('Sort Options'));
        fireEvent.click(screen.getByText('Name (A-Z)'));
        const update = settingsContextMocks.setSettings.mock.calls.at(-1)?.[0];
        expect(update({}).resourceSortOptions.collections).toBe('name_asc');
    });

    it('renders pinned and paginated layouts in grid mode', () => {
        settingsContextMocks.resourceViewModes = { collections: 'grid' };
        const pinned = { ...makeCollection({ id: 'pinned', name: 'Pinned', createdAt: 1, updatedAt: 1 }), isPinned: true };
        const collections = [pinned, ...Array.from({ length: 61 }, (_, index) => makeCollection({
            id: `grid-${index}`, name: `Grid ${index}`, createdAt: index, updatedAt: index
        }))];
        renderList({ collections });
        expect(screen.getByTestId('collection-pinned').parentElement?.className).toBe('');
        expect(screen.getByRole('button', { name: /show more/i }).className).toContain('col-span-3');
    });

    it('allows the active collection to disappear before rename is chosen', () => {
        const view = renderList();
        fireEvent.contextMenu(screen.getByTestId('collection-alpha'));
        view.rerender(<CollectionList {...view.props} collections={[]} />);
        fireEvent.click(screen.getByText('onRename'));
        expect(screen.queryByLabelText('name-alpha')).toBeNull();
    });

    it('defaults to list view without a persisted collection mode', () => {
        settingsContextMocks.resourceViewModes = {};
        renderList();
        expect(screen.getByTestId('collection-alpha').dataset.view).toBe('list');
    });

    it('handles ordinary drag-over events without diagnostic logging', () => {
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
        vi.spyOn(Math, 'random').mockReturnValue(1);
        renderList();
        const item = screen.getByTestId('collection-alpha');
        fireEvent.dragOver(item, { dataTransfer: { dropEffect: 'none', types: [] } });
        expect(logSpy).not.toHaveBeenCalled();
        logSpy.mockRestore();
    });

    it('uses image-id counts and created dates when optional sort fields are absent', () => {
        settingsContextMocks.resourceSortOptions = { collections: 'count_asc' };
        const countAsc = renderList({ collections: [
            { ...makeCollection({ id: 'two', name: 'Two', createdAt: 2, updatedAt: 2 }), count: undefined, imageIds: ['1', '2'] },
            { ...makeCollection({ id: 'one', name: 'One', createdAt: 1, updatedAt: 1 }), count: undefined, imageIds: ['1'] }
        ] });
        expectCollectionOrder(['One', 'Two']);
        countAsc.unmount();

        settingsContextMocks.resourceSortOptions = { collections: 'count_desc' };
        const countDesc = renderList({ collections: [
            { ...makeCollection({ id: 'two', name: 'Two', createdAt: 2, updatedAt: 2 }), count: undefined, imageIds: ['1', '2'] },
            { ...makeCollection({ id: 'one', name: 'One', createdAt: 1, updatedAt: 1 }), count: undefined, imageIds: ['1'] }
        ] });
        expectCollectionOrder(['Two', 'One']);
        countDesc.unmount();

        settingsContextMocks.resourceSortOptions = { collections: 'recent_asc' };
        renderList({ collections: [
            { ...makeCollection({ id: 'new', name: 'New', createdAt: 20, updatedAt: 1 }), updatedAt: 0 },
            { ...makeCollection({ id: 'old', name: 'Old', createdAt: 10, updatedAt: 1 }), updatedAt: 0 }
        ] });
        expectCollectionOrder(['Old', 'New']);
    });

    it('falls back to plain-text drops and ignores empty data', () => {
        const { props } = renderList();
        const item = screen.getByTestId('collection-alpha');
        fireEvent.drop(item, { dataTransfer: { getData: (type: string) => type === 'text/plain' ? 'plain-data' : '' } });
        expect(props.onDropOnCollection).toHaveBeenCalledWith('alpha', 'plain-data');
        fireEvent.drop(item, { dataTransfer: { getData: () => '' } });
        expect(props.onDropOnCollection).toHaveBeenCalledTimes(1);
    });

    it('routes every context-menu action and begins rename editing', () => {
        const collection = {
            ...makeCollection({ id: 'alpha', name: 'Alpha', createdAt: 1, updatedAt: 1 }),
            isArchived: false, isPinned: true, customThumbnail: 'thumb', color: 'blue'
        };
        const { props } = renderList({ collections: [collection] });
        const openMenu = () => fireEvent.contextMenu(screen.getByTestId('collection-alpha'));

        openMenu();
        expect(screen.getByTestId('collection-menu').dataset.archived).toBe('false');
        fireEvent.click(screen.getByText('onRename'));
        expect(screen.getByLabelText('name-alpha')).toBeTruthy();

        const actions: Array<[string, keyof typeof props]> = [
            ['onToggleArchive', 'onToggleArchiveCollection'], ['onTogglePin', 'onTogglePinCollection'],
            ['onDelete', 'onDeleteCollection'], ['onPlaySlideshow', 'onPlayCollection'],
            ['onExport', 'onExportCollection'], ['onResetThumbnail', 'onResetCollectionThumbnail'],
            ['onEditCollection', 'onEditCollection']
        ];
        for (const [button, prop] of actions) {
            openMenu();
            fireEvent.click(screen.getByText(button));
            expect(props[prop]).toHaveBeenCalledWith('alpha');
        }
        openMenu();
        fireEvent.click(screen.getByText('onColorChange'));
        expect(props.onSetCollectionColor).toHaveBeenCalledWith('alpha', 'red');
        openMenu();
        fireEvent.click(screen.getByText('onClose'));
        expect(screen.queryByTestId('collection-menu')).toBeNull();
    });
});
