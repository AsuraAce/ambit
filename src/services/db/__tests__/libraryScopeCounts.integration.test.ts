// @vitest-environment node
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { countLibraryScopes } from '../searchRepo';
import { buildSqlWhereClause } from '../../../utils/sqlHelpers';
import { createDefaultFilters } from '../../../utils/filterState';
import type { FilterState } from '../../../types';

const mocks = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock('../connection', () => ({ getDb: mocks.getDb }));

describe('library media scopes over SQLite', () => {
    let sqlite: DatabaseSync;
    beforeEach(() => {
        sqlite = new DatabaseSync(':memory:');
        sqlite.exec(`
            CREATE TABLE images (
                id TEXT, media_type TEXT, source_kind TEXT, positive_prompt TEXT DEFAULT '',
                invoke_owner_id TEXT, invoke_scope_hidden INTEGER DEFAULT 0,
                is_deleted INTEGER DEFAULT 0, privacy_hidden INTEGER DEFAULT 0,
                is_intermediate_gen INTEGER DEFAULT 0, is_grid_gen INTEGER DEFAULT 0,
                is_invoke_asset_gen INTEGER DEFAULT 0
            );
            CREATE VIEW scoped_images AS SELECT * FROM images
                WHERE invoke_owner_id IS NULL OR invoke_owner_id = 'current';
            CREATE TABLE collection_images (collection_id TEXT, image_id TEXT);
            INSERT INTO images(id, media_type, source_kind, positive_prompt) VALUES
                ('photo', 'image', 'photograph', 'portrait'),
                ('generated', 'image', 'generated', 'landscape'),
                ('legacy', NULL, 'other', 'portrait'),
                ('video', 'video', 'other', 'portrait');
            INSERT INTO images(id, media_type, source_kind, privacy_hidden) VALUES
                ('private', 'image', 'photograph', 1);
            INSERT INTO images(id, media_type, source_kind, invoke_owner_id) VALUES
                ('other-owner', 'video', 'other', 'someone-else');
            INSERT INTO images(id, media_type, source_kind, invoke_scope_hidden) VALUES
                ('hidden-source', 'image', 'photograph', 1);
            INSERT INTO images(id, media_type, source_kind, is_deleted) VALUES
                ('removed', 'image', 'photograph', 1);
            INSERT INTO collection_images VALUES ('selected', 'photo'), ('selected', 'video');
        `);
        mocks.getDb.mockResolvedValue({
            select: async (sql: string, params: SQLInputValue[] = []) => sqlite.prepare(sql).all(...params),
        });
    });
    afterEach(() => sqlite.close());

    const count = async (overrides: Partial<FilterState> = {}, alternatives = false) => {
        const query = buildSqlWhereClause(createDefaultFilters(overrides), true, 'hide', [], [], false,
            alternatives ? ['mediaType', 'sourceKind'] : []);
        return countLibraryScopes(query.where, query.params, query.collectionId, query.loraName);
    };

    it('keeps All media inclusive and image-kind totals image-only with owner/privacy boundaries', async () => {
        expect(await count({ mediaType: 'all', sourceKind: 'photograph' })).toEqual({
            media: { all: 4, image: 3, video: 1 },
            imageKinds: { all: 3, generated: 1, photograph: 1, other: 1 },
        });
        expect((await count({ mediaType: 'video', sourceKind: 'photograph' })).media).toEqual({ all: 1, image: 0, video: 1 });
        expect((await count({ mediaType: 'image', sourceKind: 'photograph' })).media.all).toBe(1);
        expect((await count({ mediaType: 'image' })).media.image).toBe(3);
    });

    it('keeps contextual alternative counts inside search and collection while global availability survives empty search', async () => {
        expect((await count({ searchQuery: 'unmatched', sourceKind: 'photograph', mediaType: 'image' }, true)).media.all).toBe(0);
        expect((await count()).imageKinds.photograph).toBe(1);
        const contextual = await count({ collectionId: 'selected', searchQuery: 'portrait', mediaType: 'image', sourceKind: 'photograph' }, true);
        expect(contextual.media).toEqual({ all: 2, image: 1, video: 1 });
        expect(contextual.imageKinds).toEqual({ all: 1, generated: 0, photograph: 1, other: 0 });
    });
});
