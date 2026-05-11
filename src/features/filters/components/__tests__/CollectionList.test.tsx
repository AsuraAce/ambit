import * as React from 'react';
import { render, screen } from '../../../../test/testUtils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Collection, FilterState, SidebarSortOption } from '../../../../types';
import { useCollectionStore } from '../../../../stores/collectionStore';
import { CollectionList } from '../CollectionList';

const settingsContextMocks = vi.hoisted(() => ({
    resourceSortOptions: {} as Record<string, SidebarSortOption>,
    setSettings: vi.fn()
}));

vi.mock('../../../../contexts/SettingsContext', () => ({
    useSettings: () => ({
        settings: {
            resourceViewModes: { collections: 'list' },
            resourceSortOptions: settingsContextMocks.resourceSortOptions
        },
        setSettings: settingsContextMocks.setSettings
    })
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
