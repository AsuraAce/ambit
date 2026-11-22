// @vitest-environment node
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildSqlWhereClause } from '../../../utils/sqlHelpers';
import { createDefaultFilters } from '../../../utils/filterState';
import { GeneratorTool, type Collection, type FilterState } from '../../../types';

const mocks = vi.hoisted(() => ({
    getDb: vi.fn(),
    execute: vi.fn(),
    selects: [] as string[],
    failWhenParam: null as string | null,
}));

vi.mock('../../../bindings', () => ({ commands: {} }));
vi.mock('@tauri-apps/api/core', () => ({ convertFileSrc: (path: string) => `asset://${path}`, invoke: vi.fn() }));
vi.mock('../../runtime', () => ({ isTauriRuntime: () => true, isBrowserMockMode: () => false }));
vi.mock('../connection', () => ({
    getDb: mocks.getDb,
    dbMutex: { dispatch: async (fn: () => Promise<unknown>) => fn() },
}));
// Held reads run on select_readonly's own connection; in these tests they reach the same fake database.
vi.mock('../readonlySelect', async () => {
    const { getDb } = await import('../connection');
    return {
        selectReadonly: vi.fn(async (sql: string, params?: unknown[]) => {
            const db = await getDb();
            return params === undefined ? db.select(sql) : db.select(sql, params);
        }),
    };
});

const ACTIVE_OWNER = 'owner-a';

interface Cover {
    thumbnail_path: string | null;
    privacy_hidden: number;
}

const makeSmart = (id: string, filters: Partial<FilterState>, extra: Partial<Collection> = {}): Collection => ({
    id,
    name: id,
    createdAt: 1,
    source: 'ambit',
    count: 0,
    imageIds: [],
    filters: createDefaultFilters(filters),
    ...extra,
});

describe('smart collection summaries in one pass over SQLite', () => {
    let sqlite: DatabaseSync;

    beforeEach(() => {
        vi.resetModules();
        mocks.execute.mockReset();
        mocks.selects.length = 0;
        mocks.failWhenParam = null;
        sqlite = new DatabaseSync(':memory:');
        sqlite.exec(`
            CREATE TABLE images (
                id TEXT, path TEXT, positive_prompt TEXT DEFAULT '', negative_prompt TEXT, metadata_json TEXT,
                tool TEXT, resolved_model_name TEXT, timestamp INTEGER DEFAULT 0, is_pinned INTEGER DEFAULT 0,
                is_favorite INTEGER DEFAULT 0, is_deleted INTEGER DEFAULT 0, privacy_hidden INTEGER DEFAULT 0,
                invoke_scope_hidden INTEGER DEFAULT 0, is_intermediate_gen INTEGER DEFAULT 0, is_grid_gen INTEGER DEFAULT 0,
                is_invoke_asset_gen INTEGER DEFAULT 0, media_type TEXT, source_kind TEXT, thumbnail_path TEXT,
                invoke_source_id TEXT, invoke_owner_id TEXT, steps INTEGER, cfg REAL, width INTEGER, height INTEGER,
                seed INTEGER, sampler TEXT, generation_type TEXT
            );
            -- The owner boundary of the real view: another owner's rows are not visible.
            CREATE VIEW scoped_images AS SELECT * FROM images
                WHERE invoke_owner_id IS NULL OR invoke_owner_id = '${ACTIVE_OWNER}';
            CREATE TABLE image_loras (image_id TEXT, lora_name TEXT);
            CREATE TABLE image_embeddings (image_id TEXT, embedding_name TEXT);
            CREATE TABLE image_hypernetworks (image_id TEXT, hypernetwork_name TEXT);
            CREATE TABLE image_controlnets (image_id TEXT, controlnet_name TEXT);
            CREATE TABLE image_ipadapters (image_id TEXT, ipadapter_name TEXT);
            INSERT INTO images (id, path, positive_prompt, tool, timestamp, is_pinned, is_favorite, privacy_hidden,
                                thumbnail_path, invoke_source_id, invoke_owner_id, is_deleted, is_invoke_asset_gen) VALUES
                ('i1', 'C:/lib/a1.png', 'portrait of a cat', 'ComfyUI', 100, 0, 0, 0, 'C:/t/i1.webp', NULL, NULL, 0, 0),
                ('i2', 'C:/lib/a2.png', 'portrait of a dog', 'ComfyUI', 200, 1, 0, 1, 'C:/t/i2.webp', NULL, NULL, 0, 0),
                ('i3', 'C:/lib/b3.png', 'landscape with a cat', 'Automatic1111', 300, 0, 1, 0, 'C:/t/i3.webp', 'invoke.db', 'owner-a', 0, 0),
                ('i4', 'C:/lib/b4.png', 'portrait cat in a hat', 'ComfyUI', 400, 0, 0, 0, NULL, NULL, NULL, 0, 0),
                ('i5', 'C:/lib/c5.png', 'portrait cat', 'ComfyUI', 500, 0, 0, 0, '', NULL, NULL, 0, 0),
                ('i6', 'C:/lib/a6.png', 'portrait cat', 'ComfyUI', 9999, 1, 0, 0, 'C:/t/i6-other-owner.webp', 'invoke.db', 'owner-b', 0, 0),
                ('i7', 'C:/lib/a7.png', 'portrait cat', 'ComfyUI', 600, 0, 0, 0, 'C:/t/i7-deleted.webp', NULL, NULL, 1, 0),
                ('i8', 'C:/lib/a8.png', 'portrait cat', 'Automatic1111', 700, 0, 0, 1, 'C:/t/i8.webp', NULL, NULL, 0, 0),
                ('i9', 'C:/lib/a9.png', 'portrait cat', 'ComfyUI', 800, 0, 0, 0, 'C:/t/i9-asset.webp', 'invoke.db', 'owner-a', 0, 1);
            INSERT INTO image_loras VALUES ('i1', 'styleA'), ('i3', 'styleA'), ('i2', 'styleB');
            INSERT INTO image_controlnets VALUES ('i4', 'depth');
        `);
        mocks.getDb.mockResolvedValue({
            select: async (sql: string, params: SQLInputValue[] = []) => {
                mocks.selects.push(sql);
                if (mocks.failWhenParam && params.includes(mocks.failWhenParam)) throw new Error('this filter cannot run');
                return sqlite.prepare(sql).all(...params);
            },
            execute: mocks.execute,
        });
    });
    afterEach(() => sqlite.close());

    /** Today's reading of one collection: a count, a cover and a safe cover, one query each. */
    const todaysReading = (collection: Collection) => {
        const statsFilters: FilterState = {
            mediaType: 'all',
            collectionId: collection.id,
            dateRange: 'all',
            favoritesOnly: false,
            pinnedOnly: false,
            models: [],
            tools: [],
            loras: [],
            embeddings: [],
            hypernetworks: [],
            controlNets: [],
            ipAdapters: [],
            samplers: [],
            generationTypes: [],
            searchQuery: '',
        };
        const { where, params } = buildSqlWhereClause(statsFilters, false, 'blur', [], [collection]);
        const args = params as SQLInputValue[];
        const count = (sqlite.prepare(`SELECT COUNT(*) AS n FROM scoped_images AS images ${where}`).get(...args) as { n: number }).n;
        const cover = sqlite
            .prepare(
                `SELECT thumbnail_path, privacy_hidden FROM scoped_images AS images ${where}
                 AND thumbnail_path IS NOT NULL AND thumbnail_path != '' ORDER BY is_pinned DESC, timestamp DESC LIMIT 1`
            )
            .get(...args) as unknown as Cover | undefined;
        const safe = sqlite
            .prepare(
                `SELECT thumbnail_path FROM scoped_images AS images ${where}
                 AND privacy_hidden = 0 AND thumbnail_path IS NOT NULL AND thumbnail_path != '' ORDER BY is_pinned DESC, timestamp DESC LIMIT 1`
            )
            .get(...args) as unknown as { thumbnail_path: string } | undefined;
        return { count, cover, safe };
    };

    const expectedSummary = (collection: Collection) => {
        const { count, cover, safe } = todaysReading(collection);
        return {
            count,
            thumbnail: cover?.thumbnail_path ? `asset://${cover.thumbnail_path}` : undefined,
            safeThumbnail: safe ? `asset://${safe.thumbnail_path}` : undefined,
            thumbnailIsSensitive: cover?.privacy_hidden === 1,
            thumbnailSourceKind: 'dynamic',
        };
    };

    const filterKinds: Collection[] = [
        makeSmart('prompt-words', { searchQuery: 'portrait cat' }),
        makeSmart('file-search', { searchQuery: 'file:a1' }),
        makeSmart('owned-ambit', { searchQuery: 'cat' }, { invokeSourceId: 'invoke.db', invokeOwnerId: 'owner-a' }),
        makeSmart('manual-exclusions', { searchQuery: 'portrait' }, { manualExclusions: ['i1', 'i5'] }),
        makeSmart('no-match', { searchQuery: 'zzzzzz' }),
        // The EXISTS subqueries name the outer row as `id`; they must still resolve inside the CASE.
        makeSmart('exists-lora-token', { searchQuery: 'lora:styleA' }),
        makeSmart('exists-loras', { loras: ['styleA', 'styleB'] }),
        makeSmart('exists-controlnet', { controlNets: ['depth'] }),
        makeSmart('favorite-tool', { favoritesOnly: true, tools: [GeneratorTool.AUTOMATIC1111] }),
        makeSmart('everything', {}),
    ];

    it('gives every kind of smart collection the count and covers of today\u2019s three queries', async () => {
        const { getSmartCollectionSummaries } = await import('../collectionRepo');
        const expected = Object.fromEntries(filterKinds.map((collection) => [collection.id, expectedSummary(collection)]));
        // The fixture exercises a hit, a miss and the cover rules.
        expect(expected['prompt-words'].count).toBeGreaterThan(1);
        expect(expected['no-match']).toMatchObject({ count: 0, thumbnail: undefined });
        expect(expected['everything'].thumbnailIsSensitive).toBe(true);
        expect(expected['everything'].safeThumbnail).not.toBe(expected['everything'].thumbnail);

        const summaries = await getSmartCollectionSummaries(filterKinds);

        expect(summaries).toEqual(expected);
        // The cache rows written for the covers are the ones today's covers would write.
        const writes = mocks.execute.mock.calls
            .filter(([sql]) => String(sql).includes('dynamic_thumbnail_path'))
            .map(([, params]) => (params as unknown[]).filter((_, index) => index !== 3));
        const expectedWrites = filterKinds.map((collection) => {
            const { cover, safe } = todaysReading(collection);
            const hasCover = !!cover?.thumbnail_path;
            return [
                hasCover ? cover.thumbnail_path : null,
                hasCover ? (safe?.thumbnail_path ?? null) : null,
                hasCover ? (cover.privacy_hidden === 1 ? 1 : 0) : null,
                collection.id,
            ];
        });
        expect(writes).toEqual(expectedWrites);
    });

    it('reads counts alone with no cover when thumbnails are not wanted', async () => {
        const { getSmartCollectionSummaries } = await import('../collectionRepo');

        const summaries = await getSmartCollectionSummaries(filterKinds, { includeThumbnails: false });

        expect(Object.fromEntries(Object.entries(summaries).map(([id, summary]) => [id, summary.count]))).toEqual(
            Object.fromEntries(filterKinds.map((collection) => [collection.id, todaysReading(collection).count]))
        );
        expect(mocks.selects).toHaveLength(1);
        expect(mocks.selects[0]).not.toContain("'cover'");
        expect(mocks.execute).not.toHaveBeenCalled();
    });

    // Another owner's images must never reach a count or a cover; every read goes through the scoped view.
    it('never reads another owner\u2019s images and always reads through scoped_images', async () => {
        const { getSmartCollectionSummaries } = await import('../collectionRepo');

        const summaries = await getSmartCollectionSummaries([
            makeSmart('everything', {}),
            makeSmart('portrait', { searchQuery: 'portrait' }),
        ]);

        // i6 (owner-b, pinned, newest) would be the cover of both; i7 is deleted and i9 is an asset.
        // The pinned, masked i2 is the cover; the safe cover skips it for the newest unmasked image.
        expect(summaries['everything'].thumbnail).toBe('asset://C:/t/i2.webp');
        expect(summaries['everything'].safeThumbnail).toBe('asset://C:/t/i3.webp');
        expect(summaries['everything'].count).toBe(6);
        expect(summaries['portrait'].count).toBe(5);
        expect(Object.values(summaries).map((summary) => summary.thumbnail)).not.toContain('asset://C:/t/i6-other-owner.webp');
        expect(mocks.selects.length).toBeGreaterThan(0);
        for (const sql of mocks.selects) {
            expect(sql).toMatch(/FROM scoped_images AS images/);
            expect(sql).not.toMatch(/FROM images\b/);
        }
    });

    // Reading the late columns of a large image row costs a walk of its overflow pages, so the
    // pass reads `scoped_images` once per chunk of collections, not once per question (#565).
    it('reads scoped_images once for a chunk of collections, and one chunk per 32 collections', async () => {
        const { getSmartCollectionSummaries } = await import('../collectionRepo');
        const many = Array.from({ length: 33 }, (_, index) => makeSmart(`smart-${index}`, { searchQuery: index % 2 ? 'portrait' : 'cat' }));

        const summaries = await getSmartCollectionSummaries(many);

        expect(Object.keys(summaries)).toHaveLength(33);
        // Today: 1 count query for all, then 2 cover queries each: 67 reads.
        expect(mocks.selects).toHaveLength(2);
        for (const sql of mocks.selects) expect(sql.match(/FROM scoped_images/g)).toHaveLength(1);
        expect(summaries['smart-0']).toEqual(expectedSummary(many[0]));
        expect(summaries['smart-32']).toEqual(expectedSummary(many[32]));
    });

    it('reads one collection in one query', async () => {
        const { getSmartCollectionSummaries } = await import('../collectionRepo');

        await getSmartCollectionSummaries([makeSmart('one', { searchQuery: 'cat' })]);

        expect(mocks.selects).toHaveLength(1);
    });

    // A chunk holds at most 30,000 bound parameters, and each manual exclusion binds one.
    it('puts a collection whose exclusions fill the parameter budget in its own query', async () => {
        const { getSmartCollectionSummaries } = await import('../collectionRepo');
        const exclusions = Array.from({ length: 31_000 }, (_, index) => `gone-${index}`);
        exclusions.push('i1');
        const small = makeSmart('small-before', { searchQuery: 'portrait' });
        const big = makeSmart('big', { searchQuery: 'portrait' }, { manualExclusions: exclusions });
        const smallAfter = makeSmart('small-after', { searchQuery: 'cat' });

        const summaries = await getSmartCollectionSummaries([small, big, smallAfter]);

        expect(mocks.selects).toHaveLength(3);
        expect(summaries['big'].count).toBe(expectedSummary(big).count);
        expect(summaries['big'].count).toBe(summaries['small-before'].count - 1);
        expect(summaries['small-after']).toEqual(expectedSummary(smallAfter));
    });

    // SQLite binds at most 32,766 variables per statement: a collection beyond that cannot run at
    // all, and must lose only itself.
    it('loses only the collection whose manual exclusions exceed the variable limit', async () => {
        const { getSmartCollectionSummaries } = await import('../collectionRepo');
        const exclusions = Array.from({ length: 33_000 }, (_, index) => `gone-${index}`);
        const before = makeSmart('small-before', { searchQuery: 'portrait' });
        const over = makeSmart('over-the-limit', { searchQuery: 'portrait' }, { manualExclusions: exclusions });
        const after = makeSmart('small-after', { searchQuery: 'cat' });
        vi.spyOn(console, 'error').mockImplementation(() => undefined);

        const summaries = await getSmartCollectionSummaries([before, over, after]);

        expect(Object.keys(summaries).sort()).toEqual(['small-after', 'small-before']);
        expect(summaries['small-before']).toEqual(expectedSummary(before));
        expect(summaries['small-after']).toEqual(expectedSummary(after));
    });

    // One filter that cannot run must not blank the collections read with it (the read was one
    // query per collection before the one-pass read).
    it('keeps the counts and covers of the other collections when one collection fails', async () => {
        const { getSmartCollectionSummaries } = await import('../collectionRepo');
        const first = makeSmart('first', { searchQuery: 'cat' });
        const broken = makeSmart('broken', { searchQuery: 'brokenterm' });
        const last = makeSmart('last', { searchQuery: 'portrait' });
        mocks.failWhenParam = '%brokenterm%';
        vi.spyOn(console, 'error').mockImplementation(() => undefined);

        const summaries = await getSmartCollectionSummaries([first, broken, last]);

        expect(Object.keys(summaries).sort()).toEqual(['first', 'last']);
        expect(summaries['first']).toEqual(expectedSummary(first));
        expect(summaries['last']).toEqual(expectedSummary(last));
        // The chunk, then each collection alone.
        expect(mocks.selects).toHaveLength(4);
        // The covers of the collections that succeeded are cached; the failed one writes nothing.
        const cached = mocks.execute.mock.calls
            .filter(([sql]) => String(sql).includes('dynamic_thumbnail_path'))
            .map(([, params]) => (params as unknown[]).at(-1));
        expect(cached.sort()).toEqual(['first', 'last']);
    });
});
