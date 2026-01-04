import { describe, it, expect } from 'vitest';
import { buildSqlWhereClause } from '../sqlHelpers';
import { FilterState, Collection, GeneratorTool } from '../../types';

describe('sqlHelpers', () => {
    const defaultFilters: FilterState = {
        searchQuery: '',
        models: [],
        tools: [],
        loras: [],
        embeddings: [],
        hypernetworks: [],
        dateRange: 'all',
        favoritesOnly: false,
        collectionId: null,
    };

    describe('buildSqlWhereClause', () => {
        it('should return base conditions by default', () => {
            const { where, params } = buildSqlWhereClause(defaultFilters, false, 'blur', []);
            expect(where).toContain('is_deleted = 0');
            expect(where).toContain('isIntermediate');
            expect(params).toHaveLength(0);
        });

        it('should handle favorites only', () => {
            const { where } = buildSqlWhereClause({ ...defaultFilters, favoritesOnly: true }, false, 'blur', []);
            expect(where).toContain('is_favorite = 1');
        });

        it('should handle pinned only', () => {
            const { where } = buildSqlWhereClause({ ...defaultFilters, pinnedOnly: true }, false, 'blur', []);
            expect(where).toContain('is_pinned = 1');
        });

        it('should handle models filter', () => {
            const { where, params } = buildSqlWhereClause({ ...defaultFilters, models: ['SDXL', 'Flux'] }, false, 'blur', []);
            expect(where).toContain("(m.name = ? OR json_extract(images.metadata_json, '$.model') = ? OR json_extract(images.metadata_json, '$.modelHash') = ?)");
            expect(params).toEqual(['SDXL', 'SDXL', 'SDXL', 'Flux', 'Flux', 'Flux']);
        });

        it('should handle tools filter', () => {
            const { where, params } = buildSqlWhereClause({ ...defaultFilters, tools: [GeneratorTool.COMFYUI, GeneratorTool.UNKNOWN] }, false, 'blur', []);
            expect(where).toContain("json_extract(metadata_json, '$.tool') = ?");
            expect(where).toContain("json_extract(metadata_json, '$.tool') IS NULL");
            expect(params).toEqual([GeneratorTool.COMFYUI]);
        });

        it('should handle fuzzy LoRA filters', () => {
            const { where, params } = buildSqlWhereClause({ ...defaultFilters, loras: ['MyLora'] }, false, 'blur', []);
            expect(where).toContain("value = ? OR value LIKE ? OR value LIKE ?");
            expect(params).toEqual(['MyLora', 'MyLora (%', 'MyLora:%']);
        });

        it('should handle privacy mode "hide"', () => {
            const { where, params } = buildSqlWhereClause(defaultFilters, true, 'hide', ['nude', 'nsfw']);
            expect(where).toContain('metadata_json NOT LIKE ? AND metadata_json NOT LIKE ?');
            expect(params).toEqual(['%nude%', '%nsfw%']);
        });

        it('should handle date ranges', () => {
            // Today
            const today = buildSqlWhereClause({ ...defaultFilters, dateRange: 'today' }, false, 'blur', []);
            expect(today.where).toContain('timestamp >= ?');
            expect(today.params[0]).toBeGreaterThan(0);

            // Week
            const week = buildSqlWhereClause({ ...defaultFilters, dateRange: 'week' }, false, 'blur', []);
            expect(week.where).toContain('timestamp >= ?');
        });

        describe('Search Query Parsing', () => {
            it('should handle simple text search', () => {
                const { where, params } = buildSqlWhereClause({ ...defaultFilters, searchQuery: 'sunset' }, false, 'blur', []);
                expect(where).toContain('(path LIKE ? OR metadata_json LIKE ?)');
                expect(params).toEqual(['%sunset%', '%sunset%']);
            });

            it('should handle negative text search', () => {
                const { where, params } = buildSqlWhereClause({ ...defaultFilters, searchQuery: '-bird' }, false, 'blur', []);
                expect(where).toContain('(path NOT LIKE ? AND metadata_json NOT LIKE ?)');
                expect(params).toEqual(['%bird%', '%bird%']);
            });

            it('should handle key:val filters (cfg)', () => {
                const { where, params } = buildSqlWhereClause({ ...defaultFilters, searchQuery: 'cfg:7' }, false, 'blur', []);
                expect(where).toContain("CAST(json_extract(metadata_json, '$.cfg') AS FLOAT) = ?");
                expect(params).toEqual([7]);
            });

            it('should handle key:val comparison (steps)', () => {
                const { where, params } = buildSqlWhereClause({ ...defaultFilters, searchQuery: 'steps:>20' }, false, 'blur', []);
                expect(where).toContain("CAST(json_extract(metadata_json, '$.steps') AS INTEGER) > ?");
                expect(params).toEqual([20]);
            });

            it('should handle quoted phrases', () => {
                const { where, params } = buildSqlWhereClause({ ...defaultFilters, searchQuery: '"golden hour"' }, false, 'blur', []);
                expect(params).toEqual(['%golden hour%', '%golden hour%']);
            });
        });

        describe('Collection Logic', () => {
            const mockCollections: Collection[] = [
                {
                    id: 'col1',
                    name: 'Manual Collection',
                    imageIds: ['img1'],
                    createdAt: Date.now(),
                },
                {
                    id: 'col2',
                    name: 'Smart Collection',
                    imageIds: [],
                    createdAt: Date.now(),
                    filters: { ...defaultFilters, searchQuery: 'ocean' },
                }
            ];

            it('should handle manual collections', () => {
                const { where, params } = buildSqlWhereClause({ ...defaultFilters, collectionId: 'col1' }, false, 'blur', [], mockCollections);
                expect(where).toContain('id IN (SELECT image_id FROM collection_images WHERE collection_id = ?)');
                expect(params).toContain('col1');
            });

            it('should handle smart collections (hybrid mode)', () => {
                const { where, params } = buildSqlWhereClause({ ...defaultFilters, collectionId: 'col2' }, false, 'blur', [], mockCollections);
                expect(where).toContain('(path LIKE ? OR metadata_json LIKE ?)'); // From smart filters
                expect(params).toContain('%ocean%');
            });

            it('should pre-empt smart collection date if global date is set', () => {
                const smartColWithDate: Collection = {
                    id: 'col_date',
                    name: 'Date Collection',
                    imageIds: [],
                    createdAt: Date.now(),
                    filters: { ...defaultFilters, dateRange: 'week' },
                };
                const { where, params } = buildSqlWhereClause(
                    { ...defaultFilters, collectionId: 'col_date', dateRange: 'today' },
                    false, 'blur', [], [smartColWithDate]
                );

                // The output should contain the global today cutoff, not the week cutoff twice or conflictingly.
                // Our logic sets effectiveSmartFilters.dateRange = 'all' if global date is set.
                expect(where).toContain('timestamp >= ?');
                // We shouldn't have two timestamp conditions from smart filter and global if logic works.
                const count = (where.match(/timestamp >= \?/g) || []).length;
                expect(count).toBe(1);
            });
        });
    });
});
