import * as React from 'react';
import { render, screen } from '../../../../test/testUtils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Collection } from '../../../../types';
import { useCollectionStore } from '../../../../stores/collectionStore';
import { AddToCollectionModal } from '../AddToCollectionModal';

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

const renderModal = (collections: Collection[]) => render(
    <AddToCollectionModal
        isOpen
        onClose={() => { }}
        collections={collections}
        selectedIds={['image-1']}
        onConfirm={() => { }}
    />
);

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
});
