import * as React from 'react';
import { fireEvent, render, screen } from '../../../../test/testUtils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Collection } from '../../../../types';
import { useCollectionStore } from '../../../../stores/collectionStore';
import { AddToCollectionModal } from '../AddToCollectionModal';
import { createDefaultFilters } from '../../../../utils/filterState';

vi.mock('framer-motion', () => {
    type MotionDivProps = React.HTMLAttributes<HTMLDivElement> & {
        initial?: unknown;
        animate?: unknown;
        exit?: unknown;
    };

    const MotionDiv = ({
        children,
        initial: _initial,
        animate: _animate,
        exit: _exit,
        ...props
    }: MotionDivProps) => <div {...props}>{children}</div>;

    return {
        AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
        motion: {
            div: MotionDiv
        }
    };
});

vi.mock('../../../../components/ui/PrivacyAwareThumbnail', () => ({
    PrivacyAwareThumbnail: ({ src }: { src?: string | null }) => (
        <div data-testid="privacy-aware-thumbnail" data-src={src || ''} />
    )
}));

const baseCollection: Collection = {
    id: 'collection-1',
    name: 'Collection One',
    imageIds: [],
    count: 1,
    createdAt: 1,
    updatedAt: 1,
    source: 'ambit'
};

type ModalOverrides = Partial<React.ComponentProps<typeof AddToCollectionModal>>;

const renderModal = (collections: Collection[], overrides: ModalOverrides = {}) => render(
    <AddToCollectionModal
        isOpen
        onClose={() => { }}
        collections={collections}
        selectedIds={['image-1']}
        onConfirm={() => { }}
        {...overrides}
    />
);

const FocusHarness = () => {
    const [isOpen, setIsOpen] = React.useState(false);

    return (
        <>
            <button type="button" onClick={() => setIsOpen(true)}>Open collection picker</button>
            <AddToCollectionModal
                isOpen={isOpen}
                onClose={() => setIsOpen(false)}
                collections={[baseCollection]}
                selectedIds={['image-1']}
                onConfirm={() => { }}
            />
        </>
    );
};

describe('AddToCollectionModal thumbnail hydration states', () => {
    beforeEach(() => {
        useCollectionStore.setState(useCollectionStore.getInitialState(), true);
    });

    it('renders a skeleton for collections with pending thumbnail hydration', () => {
        useCollectionStore.setState({
            thumbnailHydrationPendingIds: {
                'collection-1': true
            }
        });

        renderModal([baseCollection]);

        expect(screen.getByTestId('collection-thumbnail-skeleton')).toBeTruthy();
        expect(screen.queryByTestId('collection-thumbnail-fallback')).toBeNull();
        expect(screen.queryByTestId('privacy-aware-thumbnail')).toBeNull();
    });

    it('renders a skeleton for smart collections with pending summary hydration', () => {
        useCollectionStore.setState({
            smartSummaryPendingIds: {
                'smart-collection-1': true
            }
        });

        renderModal([{
            ...baseCollection,
            id: 'smart-collection-1',
            name: 'Smart Collection One',
            filters: createDefaultFilters({ dateRange: 'today' })
        }]);

        expect(screen.getByTestId('collection-thumbnail-skeleton')).toBeTruthy();
        expect(screen.queryByTestId('collection-thumbnail-fallback')).toBeNull();
        expect(screen.queryByTestId('privacy-aware-thumbnail')).toBeNull();
    });

    it('renders nothing while closed', () => {
        renderModal([baseCollection], { isOpen: false });
        expect(screen.queryByText('Add to Collection')).toBeNull();
    });

    it('combines regular and smart collections and confirms the selected target', () => {
        const onConfirm = vi.fn();
        renderModal([baseCollection], {
            smartCollections: [{ ...baseCollection, id: 'smart', name: 'Smart', createdAt: 2 }],
            selectedIds: ['one', 'two'],
            onConfirm,
        });

        expect(screen.getByText('2 images selected')).not.toBeNull();
        fireEvent.click(screen.getByRole('button', { name: /smart/i }));
        expect(onConfirm).toHaveBeenCalledWith(['one', 'two'], 'smart', 'add', undefined);
    });

    it('renders move mode and excludes the source collection', () => {
        renderModal([baseCollection, { ...baseCollection, id: 'target', name: 'Target' }], {
            mode: 'move',
            sourceCollectionId: baseCollection.id,
        });
        expect(screen.getByText('Move to Collection')).not.toBeNull();
        expect(screen.queryByText(baseCollection.name)).toBeNull();
        expect(screen.getByText('Target')).not.toBeNull();
    });

    it('filters by search and shows the empty state', () => {
        renderModal([baseCollection]);
        fireEvent.change(screen.getByPlaceholderText('Search collections...'), { target: { value: 'missing' } });
        expect(screen.getByText('No matching collections found')).not.toBeNull();
    });

    it('hides archived collections until requested', () => {
        const archived = { ...baseCollection, id: 'archived', name: 'Archived Set', isArchived: true };
        renderModal([baseCollection, archived]);
        expect(screen.queryByText('Archived Set')).toBeNull();

        fireEvent.click(screen.getByRole('button', { name: 'Show Archived Collections' }));
        expect(screen.getByText('Archived Set')).not.toBeNull();
        expect(screen.getByText('Archived')).not.toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Hide Archived Collections' }));
        expect(screen.queryByText('Archived Set')).toBeNull();
    });

    it.each([
        ['Name (A-Z)', ['Alpha', 'Beta']],
        ['Name (Z-A)', ['Beta', 'Alpha']],
        ['Most Images', ['Beta', 'Alpha']],
        ['Fewest Images', ['Alpha', 'Beta']],
        ['Oldest Created', ['Alpha', 'Beta']],
        ['Recently Created', ['Beta', 'Alpha']],
    ])('sorts collections by %s', (option, expected) => {
        const alpha = { ...baseCollection, id: 'alpha', name: 'Alpha', count: undefined, imageIds: ['one'], createdAt: 1 };
        const beta = { ...baseCollection, id: 'beta', name: 'Beta', count: undefined, imageIds: ['one', 'two', 'three'], createdAt: 2 };
        renderModal([beta, alpha]);

        fireEvent.click(screen.getByRole('button', { name: 'Sort Collections' }));
        fireEvent.click(screen.getByRole('button', { name: option }));
        const names = screen.getAllByRole('button').filter(button => expected.includes(button.textContent?.match(/Alpha|Beta/)?.[0] ?? ''));
        expect(names.map(button => button.textContent?.match(/Alpha|Beta/)?.[0])).toEqual(expected);
    });

    it('renders unknown smart counts as uncalculated and sorts them last in both count directions', () => {
        const unknown = {
            ...baseCollection,
            id: 'unknown',
            name: 'Unknown',
            count: undefined,
            imageIds: ['one', 'two', 'three'],
            filters: createDefaultFilters()
        };
        const empty = { ...baseCollection, id: 'empty', name: 'Empty', count: 0 };
        const full = { ...baseCollection, id: 'full', name: 'Full', count: undefined, imageIds: ['one', 'two'] };
        renderModal([unknown, empty, full]);

        const unknownCount = screen.getByTitle('Count not calculated');
        expect(unknownCount.textContent).toBe('\u2014');
        expect(unknownCount.getAttribute('aria-label')).toBe('Count not calculated');
        expect(screen.getByText('0 images')).toBeTruthy();

        const collectionOrder = () => screen.getAllByRole('button')
            .map(button => button.textContent?.match(/Unknown|Empty|Full/)?.[0])
            .filter((name): name is string => !!name);

        fireEvent.click(screen.getByRole('button', { name: 'Sort Collections' }));
        fireEvent.click(screen.getByRole('button', { name: 'Most Images' }));
        expect(collectionOrder()).toEqual(['Full', 'Empty', 'Unknown']);

        fireEvent.click(screen.getByRole('button', { name: 'Sort Collections' }));
        fireEvent.click(screen.getByRole('button', { name: 'Fewest Images' }));
        expect(collectionOrder()).toEqual(['Empty', 'Full', 'Unknown']);
    });

    it('closes the sort menu from its backdrop and closes the modal from header and overlay', () => {
        const onClose = vi.fn();
        const { container } = renderModal([baseCollection], { onClose });
        fireEvent.click(screen.getByRole('button', { name: 'Sort Collections' }));
        const sortBackdrop = container.querySelector('.fixed.inset-0.z-10');
        expect(sortBackdrop).not.toBeNull();
        fireEvent.click(sortBackdrop!);
        expect(screen.queryByRole('button', { name: 'Name (A-Z)' })).toBeNull();

        const closeButton = container.querySelector('button.p-2.hover\\:bg-gray-100');
        fireEvent.click(closeButton!);
        const modalOverlay = container.querySelector('.absolute.inset-0.bg-black\\/40');
        fireEvent.click(modalOverlay!);
        expect(onClose).toHaveBeenCalledTimes(2);
    });

    it('stops clicks inside the dialog from reaching its overlay', () => {
        const { container } = renderModal([baseCollection]);
        const dialog = container.querySelector('.relative.w-full.max-w-md');
        const event = new MouseEvent('click', { bubbles: true });
        const stopPropagation = vi.spyOn(event, 'stopPropagation');
        dialog!.dispatchEvent(event);
        expect(stopPropagation).toHaveBeenCalled();
    });

    it('renders hydrated thumbnails and all collection color classes', () => {
        const colors = ['red', 'orange', 'green', 'blue', 'purple', 'unknown'] as const;
        renderModal(colors.map((color, index) => ({
            ...baseCollection,
            id: color,
            name: color,
            color,
            thumbnail: `thumb-${index}`,
            safeThumbnail: `safe-${index}`,
            thumbnailIsSensitive: index === 0,
            filters: index % 2 === 0 ? createDefaultFilters() : undefined,
            createdAt: index,
        })));
        expect(screen.getAllByTestId('privacy-aware-thumbnail')).toHaveLength(colors.length);
        for (const className of ['bg-red-500', 'bg-orange-500', 'bg-green-500', 'bg-blue-500', 'bg-purple-500']) {
            expect(document.querySelector(`.${className}`)).not.toBeNull();
        }
    });

    it('renders colored skeletons and smart, folder, and archived fallbacks', () => {
        useCollectionStore.setState({ thumbnailHydrationPendingIds: { pending: true } });
        renderModal([
            { ...baseCollection, id: 'pending', name: 'Pending', color: 'red' },
            { ...baseCollection, id: 'smart', name: 'Smart', filters: createDefaultFilters() },
            { ...baseCollection, id: 'folder', name: 'Folder' },
            { ...baseCollection, id: 'archived', name: 'Old', isArchived: true, color: 'blue' },
        ]);
        expect(screen.getByTestId('collection-thumbnail-skeleton')).not.toBeNull();
        expect(screen.getAllByTestId('collection-thumbnail-fallback')).toHaveLength(2);
        fireEvent.click(screen.getByRole('button', { name: 'Show Archived Collections' }));
        expect(screen.getAllByTestId('collection-thumbnail-fallback')).toHaveLength(3);
    });
});

describe('AddToCollectionModal focus handoff', () => {
    it('returns focus to the collection launcher after closing', () => {
        render(<FocusHarness />);
        const launcher = screen.getByRole('button', { name: 'Open collection picker' });
        launcher.focus();

        fireEvent.click(launcher);
        const closeButton = screen.getByRole('button', { name: 'Close Add to Collection' });
        expect(document.activeElement).toBe(closeButton);

        fireEvent.click(closeButton);
        expect(document.activeElement).toBe(launcher);
    });

    it('reports the sort popup as an expanded disclosure without claiming menu behavior', () => {
        renderModal([baseCollection]);

        const sortButton = screen.getByRole('button', { name: 'Sort Collections' });
        expect(sortButton.getAttribute('aria-expanded')).toBe('false');
        expect(sortButton.getAttribute('aria-haspopup')).toBeNull();

        fireEvent.click(sortButton);

        expect(sortButton.getAttribute('aria-expanded')).toBe('true');
        expect(screen.getByRole('button', { name: 'Name (A-Z)' })).toBeTruthy();
    });
});
