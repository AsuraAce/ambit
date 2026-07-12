import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { GeneratorTool, type Collection, type FilterState } from '../../../../types';
import { CollectionsSection } from '../CollectionsSection';

const probe = vi.hoisted(() => ({ props: null as null | Record<string, unknown> }));
vi.mock('../CollectionList', () => ({
    CollectionList: (props: Record<string, unknown>) => {
        probe.props = props;
        const toolbar = props.renderToolbarExtras as () => React.ReactNode;
        const form = props.renderCreationForm as () => React.ReactNode;
        return <div>{toolbar()}{form()}{props.emptyMessage as React.ReactNode}</div>;
    },
}));

const filters: FilterState = {
    searchQuery: 'portrait', models: [], tools: [GeneratorTool.COMFYUI], loras: [], embeddings: [], hypernetworks: [],
    samplers: [], generationTypes: [], controlNets: [], ipAdapters: [], dateRange: 'all', favoritesOnly: false, collectionId: null,
};
const collection: Collection = { id: 'c1', name: 'One', imageIds: [], createdAt: 1, source: 'ambit' };

const setup = (overrides: Partial<React.ComponentProps<typeof CollectionsSection>> = {}) => {
    const onCreateCollection = vi.fn();
    const onToggle = vi.fn();
    const props: React.ComponentProps<typeof CollectionsSection> = {
        collections: [collection], filters, setFilters: vi.fn(), isOpen: true, onToggle, onCreateCollection,
        ...overrides,
    };
    return { ...render(<CollectionsSection {...props} />), onCreateCollection, onToggle };
};

describe('CollectionsSection', () => {
    it('collapses content and toggles the header', () => {
        setup({ isOpen: false });
        expect(screen.queryByTitle('New Empty Collection')).toBeNull();
        fireEvent.click(screen.getByText('Collections'));
        expect(probe.props).toBeNull();
    });

    it('creates empty collections from toolbar and empty state', () => {
        const view = setup({ collections: [] });
        fireEvent.click(screen.getByRole('button', { name: 'Create Collection' }));
        const input = screen.getByPlaceholderText('New collection name...');
        fireEvent.change(input, { target: { value: 'New Collection' } });
        fireEvent.submit(input.closest('form') as HTMLFormElement);
        expect(view.onCreateCollection).toHaveBeenCalledWith('New Collection', undefined);

        fireEvent.click(screen.getByTitle('New Empty Collection'));
        fireEvent.change(screen.getByPlaceholderText('New collection name...'), { target: { value: '   ' } });
        fireEvent.submit(screen.getByPlaceholderText('New collection name...').closest('form') as HTMLFormElement);
        expect(view.onCreateCollection).toHaveBeenCalledOnce();
    });

    it('saves current filters and cancels blank creation on blur', () => {
        const view = setup({ isDirty: true });
        fireEvent.click(screen.getByTitle('Save Filters as Collection'));
        const input = screen.getByPlaceholderText('Save search as...');
        fireEvent.change(input, { target: { value: 'Saved Search' } });
        fireEvent.submit(input.closest('form') as HTMLFormElement);
        expect(view.onCreateCollection).toHaveBeenCalledWith('Saved Search', filters);

        fireEvent.click(screen.getByTitle('New Empty Collection'));
        fireEvent.blur(screen.getByPlaceholderText('New collection name...'));
        expect(screen.queryByPlaceholderText('New collection name...')).toBeNull();
    });

    it('forwards collection callbacks and supplies a safe delete fallback', () => {
        const callbacks = {
            onRenameCollection: vi.fn(), onDropOnCollection: vi.fn(), onToggleArchiveCollection: vi.fn(),
            onTogglePinCollection: vi.fn(), onSetCollectionColor: vi.fn(), onPlayCollection: vi.fn(),
            onExportCollection: vi.fn(), onResetCollectionThumbnail: vi.fn(), onEditCollection: vi.fn(),
        };
        setup(callbacks);
        expect(probe.props).toMatchObject(callbacks);
        expect(() => (probe.props?.onDeleteCollection as () => void)()).not.toThrow();
    });
});
