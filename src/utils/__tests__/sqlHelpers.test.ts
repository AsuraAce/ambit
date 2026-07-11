import { describe, it, expect } from 'vitest';
import { buildSqlWhereClause, normalizeResourceReferenceForFilter, resourceReferenceEqualsSql, resourceReferenceSql } from '../sqlHelpers';
import { FilterState, Collection, GeneratorTool } from '../../types';

describe('sqlHelpers', () => {
    const defaultFilters: FilterState = {
        searchQuery: '',
        models: [],
        tools: [],
        loras: [],
        embeddings: [],
        hypernetworks: [],
        controlNets: [],
        ipAdapters: [],
        samplers: [],
        generationTypes: [],
        dateRange: 'all',
        favoritesOnly: false,
        collectionId: null,
    };

    describe('buildSqlWhereClause', () => {
        it('normalizes weighted and colon resource references and builds canonical SQL', () => {
            expect(normalizeResourceReferenceForFilter(' Detailer (0.75) ')).toBe('Detailer');
            expect(normalizeResourceReferenceForFilter('Embedding:1.2')).toBe('Embedding');
            expect(normalizeResourceReferenceForFilter('Plain')).toBe('Plain');
            expect(resourceReferenceSql('resource_name')).toContain("instr(resource_name, ' (')");
            expect(resourceReferenceEqualsSql('resource_name')).toContain('COLLATE NOCASE = ?');
        });
        it('should return base conditions by default', () => {
            const { where, params } = buildSqlWhereClause(defaultFilters, false, 'blur', []);
            expect(where).toContain('is_deleted = 0');
            expect(where).toContain('is_intermediate_gen');
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
            expect(where).toContain("resolved_model_name = ?");
            expect(params).toEqual(['SDXL', 'Flux']);
        });

        it('should always OR checkpoint models even if stale matchModes requests ALL', () => {
            const { where, params } = buildSqlWhereClause({
                ...defaultFilters,
                models: ['SDXL', 'Flux'],
                matchModes: { models: 'all' }
            }, false, 'blur', []);

            expect(where).toContain("resolved_model_name = ? COLLATE NOCASE OR resolved_model_name = ? COLLATE NOCASE");
            expect(where).not.toContain("resolved_model_name = ? COLLATE NOCASE AND resolved_model_name = ? COLLATE NOCASE");
            expect(params).toEqual(['SDXL', 'Flux']);
        });

        it('should filter model aliases as one selected asset', () => {
            const { where, params } = buildSqlWhereClause({
                ...defaultFilters,
                models: ['Pony Diffusion V6 XL'],
                assetFilterAliases: {
                    models: {
                        'Pony Diffusion V6 XL': ['Pony Diffusion V6 XL', 'ponyDiffusionV6XL']
                    }
                }
            }, false, 'blur', []);

            expect(where).toContain("(resolved_model_name = ? COLLATE NOCASE OR resolved_model_name = ? COLLATE NOCASE)");
            expect(params).toEqual(['Pony Diffusion V6 XL', 'ponyDiffusionV6XL']);
        });

        it('should handle tools filter', () => {
            const { where, params } = buildSqlWhereClause({ ...defaultFilters, tools: [GeneratorTool.COMFYUI, GeneratorTool.UNKNOWN] }, false, 'blur', []);
            expect(where).toContain("tool = ?");
            expect(where).toContain("tool IS NULL");
            expect(params).toEqual([GeneratorTool.COMFYUI]);
        });


        it('should return loraName for single LoRA filter (INNER JOIN optimization)', () => {
            const { where, params, loraName } = buildSqlWhereClause({ ...defaultFilters, loras: ['MyLora'] }, false, 'blur', []);
            // Single lora doesn't add WHERE clause - INNER JOIN is used in searchRepo instead
            expect(loraName).toBe('MyLora');
            expect(where).not.toContain('image_loras'); // No EXISTS for single lora
            expect(params).toEqual([]);
        });

        it('should canonicalize weighted single LoRA filters for the optimized path', () => {
            const { where, params, loraName } = buildSqlWhereClause({
                ...defaultFilters,
                loras: ['detail___add_detail (0.20)']
            }, false, 'blur', []);

            expect(loraName).toBe('detail___add_detail');
            expect(where).not.toContain('image_loras');
            expect(params).toEqual([]);
        });

        it('should keep canonical-only weighted LoRA aliases on the optimized path', () => {
            const { where, params, loraName } = buildSqlWhereClause({
                ...defaultFilters,
                loras: ['detail___add_detail'],
                assetFilterAliases: {
                    loras: {
                        detail___add_detail: ['detail___add_detail', 'detail___add_detail (0.20)']
                    }
                }
            }, false, 'blur', []);

            expect(loraName).toBe('detail___add_detail');
            expect(where).not.toContain('image_loras');
            expect(params).toEqual([]);
        });

        it('should expand merged LoRA aliases instead of using the single-LoRA optimization', () => {
            const { where, params, loraName } = buildSqlWhereClause({
                ...defaultFilters,
                loras: ['Detailer-Style'],
                assetFilterAliases: {
                    loras: {
                        'Detailer-Style': ['Detailer-Style', 'detailer style']
                    }
                }
            }, false, 'blur', []);

            expect(loraName).toBeUndefined();
            expect(where).toContain("instr(il.lora_name, ' (')");
            expect(where).toContain(") OR EXISTS");
            expect(params).toEqual(['Detailer-Style', 'detailer style']);
        });

        it('should use junction table for Embedding filters', () => {
            const { where, params } = buildSqlWhereClause({ ...defaultFilters, embeddings: ['EasyNegative'] }, false, 'blur', []);
            expect(where).toContain("EXISTS (SELECT 1 FROM image_embeddings ie WHERE ie.image_id = id AND (CASE");
            expect(where).toContain("ie.embedding_name");
            expect(params).toEqual(['EasyNegative']);
        });

        it('should use junction table for Hypernetwork filters', () => {
            const { where, params } = buildSqlWhereClause({ ...defaultFilters, hypernetworks: ['HyperNet'] }, false, 'blur', []);
            expect(where).toContain("EXISTS (SELECT 1 FROM image_hypernetworks ih WHERE ih.image_id = id AND (CASE");
            expect(where).toContain("ih.hypernetwork_name");
            expect(params).toEqual(['HyperNet']);
        });

        it('should handle privacy mode "hide"', () => {
            const { where, params } = buildSqlWhereClause(defaultFilters, true, 'hide', ['nude', 'nsfw']);
            expect(where).toContain('privacy_hidden = 0');
            expect(where).not.toContain('metadata_json NOT LIKE ?');
            expect(params).toEqual([]);
        });

        it('should handle preset date ranges', () => {
            // Today
            const today = buildSqlWhereClause({ ...defaultFilters, dateRange: 'today' }, false, 'blur', []);
            expect(today.where).toContain('timestamp >= ?');
            expect(today.params[0]).toBeGreaterThan(0);

            // Week
            const week = buildSqlWhereClause({ ...defaultFilters, dateRange: 'week' }, false, 'blur', []);
            expect(week.where).toContain('timestamp >= ?');
        });

        it('should handle custom exact-day date ranges', () => {
            const result = buildSqlWhereClause({
                ...defaultFilters,
                dateRange: 'custom',
                dateFrom: '2026-04-15',
                dateTo: '2026-04-15'
            }, false, 'blur', []);

            expect(result.where).toContain('timestamp >= ?');
            expect(result.where).toContain('timestamp < ?');
            expect(result.params).toEqual([
                new Date(2026, 3, 15).getTime(),
                new Date(2026, 3, 16).getTime()
            ]);
        });

        it('should handle custom bounded and one-sided date ranges', () => {
            const bounded = buildSqlWhereClause({
                ...defaultFilters,
                dateRange: 'custom',
                dateFrom: '2026-04-01',
                dateTo: '2026-04-30'
            }, false, 'blur', []);
            expect(bounded.params).toEqual([
                new Date(2026, 3, 1).getTime(),
                new Date(2026, 4, 1).getTime()
            ]);

            const fromOnly = buildSqlWhereClause({
                ...defaultFilters,
                dateRange: 'custom',
                dateFrom: '2026-04-01'
            }, false, 'blur', []);
            expect(fromOnly.where).toContain('timestamp >= ?');
            expect(fromOnly.where).not.toContain('timestamp < ?');
            expect(fromOnly.params).toEqual([new Date(2026, 3, 1).getTime()]);

            const toOnly = buildSqlWhereClause({
                ...defaultFilters,
                dateRange: 'custom',
                dateTo: '2026-04-30'
            }, false, 'blur', []);
            expect(toOnly.where).not.toContain('timestamp >= ?');
            expect(toOnly.where).toContain('timestamp < ?');
            expect(toOnly.params).toEqual([new Date(2026, 4, 1).getTime()]);
        });

        it('should normalize inverted custom date ranges', () => {
            const result = buildSqlWhereClause({
                ...defaultFilters,
                dateRange: 'custom',
                dateFrom: '2026-04-30',
                dateTo: '2026-04-01'
            }, false, 'blur', []);

            expect(result.params).toEqual([
                new Date(2026, 3, 1).getTime(),
                new Date(2026, 4, 1).getTime()
            ]);
        });

        describe('Search Query Parsing', () => {
            it('should handle simple text search', () => {
                const { where, params } = buildSqlWhereClause({ ...defaultFilters, searchQuery: 'sunset' }, false, 'blur', []);
                expect(where).toContain("positive_prompt LIKE ?");
                expect(params).toEqual(['%sunset%']);
            });

            it('should handle negative text search', () => {
                const { where, params } = buildSqlWhereClause({ ...defaultFilters, searchQuery: '-bird' }, false, 'blur', []);
                expect(where).toContain("positive_prompt NOT LIKE ?");
                expect(params).toEqual(['%bird%']);
            });

            it('should handle key:val filters (cfg)', () => {
                const { where, params } = buildSqlWhereClause({ ...defaultFilters, searchQuery: 'cfg:7' }, false, 'blur', []);
                expect(where).toContain("cfg = ?");
                expect(params).toEqual([7]);
            });

            it('should handle key:val comparison (steps)', () => {
                const { where, params } = buildSqlWhereClause({ ...defaultFilters, searchQuery: 'steps:>20' }, false, 'blur', []);
                expect(where).toContain("steps > ?");
                expect(params).toEqual([20]);
            });

            it.each([
                ['steps:<30', 'steps < ?', 30],
                ['steps:20', 'steps = ?', 20],
                ['cfg:>6.5', 'cfg > ?', 6.5],
                ['cfg:<8', 'cfg < ?', 8],
                ['w:>512', 'width > ?', 512],
                ['width:<2048', 'width < ?', 2048],
                ['width:1024', 'width = ?', 1024],
                ['h:>512', 'height > ?', 512],
                ['height:<2048', 'height < ?', 2048],
                ['height:768', 'height = ?', 768],
                ['neg:blur', 'negative_prompt LIKE ?', '%blur%'],
                ['negative:noise', 'negative_prompt LIKE ?', '%noise%'],
                ['file:image.png', 'path LIKE ?', '%image.png%'],
                ['filename:portrait', 'path LIKE ?', '%portrait%'],
                ['path:/output/', 'path LIKE ?', '%/output/%'],
                ['sampler:euler', 'sampler LIKE ?', '%euler%'],
                ['tool:comfy', 'tool LIKE ?', '%comfy%'],
                ['lora:detail', 'image_loras', '%detail%'],
                ['cn:canny', 'image_controlnets', '%canny%'],
                ['controlnet:depth', 'image_controlnets', '%depth%'],
                ['ip:face', 'image_ipadapters', '%face%'],
                ['ipadapter:style', 'image_ipadapters', '%style%'],
                ['upscaled:true', "json_extract(metadata_json, '$.upscaled') = ?", 1],
                ['upscaled:false', "json_extract(metadata_json, '$.upscaled') = ?", 0],
            ] as const)('parses scoped search token %s', (searchQuery, sqlFragment, expectedParam) => {
                const { where, params } = buildSqlWhereClause({ ...defaultFilters, searchQuery }, false, 'blur', []);
                expect(where).toContain(sqlFragment);
                expect(params).toContain(expectedParam);
            });

            it('handles model and all-field scoped searches in positive and negative forms', () => {
                const model = buildSqlWhereClause({ ...defaultFilters, searchQuery: 'model:pony' }, false, 'blur', []);
                expect(model.where).toContain('(resolved_model_name LIKE ? OR json_extract(metadata_json, \'$.model\') LIKE ?)');
                expect(model.params).toEqual(['%pony%', '%pony%']);

                const all = buildSqlWhereClause({ ...defaultFilters, searchQuery: 'all:detail' }, false, 'blur', []);
                expect(all.where).toContain('(path LIKE ? OR metadata_json LIKE ?)');
                expect(all.params).toEqual(['%detail%', '%detail%']);

                const negative = buildSqlWhereClause({ ...defaultFilters, searchQuery: '-all:secret' }, false, 'blur', []);
                expect(negative.where).toContain('(path NOT LIKE ? AND metadata_json NOT LIKE ?)');
                expect(negative.params).toEqual(['%secret%', '%secret%']);
            });

            it('should search the scalar seed column without loading metadata JSON', () => {
                const { where, params } = buildSqlWhereClause({ ...defaultFilters, searchQuery: 'seed:123' }, false, 'blur', []);

                expect(where).toContain('CAST(seed AS TEXT) LIKE ?');
                expect(where).not.toContain("json_extract(metadata_json, '$.seed')");
                expect(params).toEqual(['%123%']);
            });

            it('should handle quoted phrases', () => {
                const { where, params } = buildSqlWhereClause({ ...defaultFilters, searchQuery: '"golden hour"' }, false, 'blur', []);
                expect(where).toContain("positive_prompt LIKE ?");
                expect(params).toEqual(['%golden hour%']);
            });

            it('should group explicit OR prompt terms', () => {
                const { where, params } = buildSqlWhereClause({ ...defaultFilters, searchQuery: 'orc OR elf' }, false, 'blur', []);
                expect(where).toContain("(positive_prompt LIKE ? OR positive_prompt LIKE ?)");
                expect(params).toEqual(['%orc%', '%elf%']);
            });

            it('should keep space-separated prompt terms as AND filters', () => {
                const { where, params } = buildSqlWhereClause({ ...defaultFilters, searchQuery: 'orc elf' }, false, 'blur', []);
                expect(where).toContain("positive_prompt LIKE ? AND positive_prompt LIKE ?");
                expect(params).toEqual(['%orc%', '%elf%']);
            });

            it('should group explicit OR with quoted phrases', () => {
                const { where, params } = buildSqlWhereClause({ ...defaultFilters, searchQuery: '"dark elf" OR orc' }, false, 'blur', []);
                expect(where).toContain("(positive_prompt LIKE ? OR positive_prompt LIKE ?)");
                expect(params).toEqual(['%dark elf%', '%orc%']);
            });

            it('should AND OR prompt groups with advanced filters', () => {
                const { where, params } = buildSqlWhereClause({ ...defaultFilters, searchQuery: 'orc OR elf model:pony' }, false, 'blur', []);
                expect(where).toContain("(positive_prompt LIKE ? OR positive_prompt LIKE ?)");
                expect(where).toContain("(resolved_model_name LIKE ? OR json_extract(metadata_json, '$.model') LIKE ?)");
                expect(params).toEqual(['%orc%', '%elf%', '%pony%', '%pony%']);
            });

            it('should handle dangling OR safely', () => {
                const { where, params } = buildSqlWhereClause({ ...defaultFilters, searchQuery: 'orc OR' }, false, 'blur', []);
                const promptMatches = where.match(/positive_prompt LIKE \?/g) ?? [];
                expect(promptMatches).toHaveLength(1);
                expect(params).toEqual(['%orc%']);
            });

            it('skips unknown scoped tokens and handles leading or interrupted OR operators', () => {
                const unknown = buildSqlWhereClause({ ...defaultFilters, searchQuery: 'unknown:value' }, false, 'blur', []);
                expect(unknown.params).toEqual([]);

                const leading = buildSqlWhereClause({ ...defaultFilters, searchQuery: 'OR orc' }, false, 'blur', []);
                expect(leading.params).toEqual(['%orc%']);

                const interrupted = buildSqlWhereClause({ ...defaultFilters, searchQuery: 'orc OR model:pony' }, false, 'blur', []);
                expect(interrupted.where).toContain('positive_prompt LIKE ?');
                expect(interrupted.where).toContain('resolved_model_name LIKE ?');
            });

            it('should handle exact date search syntax', () => {
                const { where, params } = buildSqlWhereClause({ ...defaultFilters, searchQuery: 'date:2026-04-15' }, false, 'blur', []);
                expect(where).toContain('(timestamp >= ? AND timestamp < ?)');
                expect(params).toEqual([
                    new Date(2026, 3, 15).getTime(),
                    new Date(2026, 3, 16).getTime()
                ]);
            });

            it('should handle date range search syntax', () => {
                const { where, params } = buildSqlWhereClause({ ...defaultFilters, searchQuery: 'date:2026-04-01..2026-04-30' }, false, 'blur', []);
                expect(where).toContain('(timestamp >= ? AND timestamp < ?)');
                expect(params).toEqual([
                    new Date(2026, 3, 1).getTime(),
                    new Date(2026, 4, 1).getTime()
                ]);
            });

            it('should handle partial ISO date search syntax', () => {
                const year = buildSqlWhereClause({ ...defaultFilters, searchQuery: 'date:2025' }, false, 'blur', []);
                expect(year.where).toContain('(timestamp >= ? AND timestamp < ?)');
                expect(year.params).toEqual([
                    new Date(2025, 0, 1).getTime(),
                    new Date(2026, 0, 1).getTime()
                ]);

                const month = buildSqlWhereClause({ ...defaultFilters, searchQuery: 'date:2026-04' }, false, 'blur', []);
                expect(month.where).toContain('(timestamp >= ? AND timestamp < ?)');
                expect(month.params).toEqual([
                    new Date(2026, 3, 1).getTime(),
                    new Date(2026, 4, 1).getTime()
                ]);

                const mixedRange = buildSqlWhereClause({ ...defaultFilters, searchQuery: 'date:2025..2026-04' }, false, 'blur', []);
                expect(mixedRange.where).toContain('(timestamp >= ? AND timestamp < ?)');
                expect(mixedRange.params).toEqual([
                    new Date(2025, 0, 1).getTime(),
                    new Date(2026, 4, 1).getTime()
                ]);
            });

            it('should reject malformed date range search syntax', () => {
                const malformedRanges = [
                    'date:2025..2026-13',
                    'date:2026-13..2027',
                    'date:2025..',
                    'date:..2026'
                ];

                malformedRanges.forEach(searchQuery => {
                    const { where, params } = buildSqlWhereClause({ ...defaultFilters, searchQuery }, false, 'blur', []);
                    expect(where).not.toContain('timestamp >= ?');
                    expect(where).not.toContain('timestamp < ?');
                    expect(params).toEqual([]);
                });
            });

            it('should handle after and before date search syntax', () => {
                const after = buildSqlWhereClause({ ...defaultFilters, searchQuery: 'after:2026-04-01' }, false, 'blur', []);
                expect(after.where).toContain('(timestamp >= ?)');
                expect(after.params).toEqual([new Date(2026, 3, 1).getTime()]);

                const before = buildSqlWhereClause({ ...defaultFilters, searchQuery: 'before:2026-04-30' }, false, 'blur', []);
                expect(before.where).toContain('(timestamp < ?)');
                expect(before.params).toEqual([new Date(2026, 4, 1).getTime()]);

                const afterMonth = buildSqlWhereClause({ ...defaultFilters, searchQuery: 'after:2026-04' }, false, 'blur', []);
                expect(afterMonth.where).toContain('(timestamp >= ?)');
                expect(afterMonth.params).toEqual([new Date(2026, 3, 1).getTime()]);

                const beforeYear = buildSqlWhereClause({ ...defaultFilters, searchQuery: 'before:2026' }, false, 'blur', []);
                expect(beforeYear.where).toContain('(timestamp < ?)');
                expect(beforeYear.params).toEqual([new Date(2027, 0, 1).getTime()]);
            });

            it('negates date and scoped numeric search tokens', () => {
                const date = buildSqlWhereClause({ ...defaultFilters, searchQuery: '-before:2026-04-30' }, false, 'blur', []);
                expect(date.where).toContain('NOT (timestamp < ?)');
                const steps = buildSqlWhereClause({ ...defaultFilters, searchQuery: '-steps:20' }, false, 'blur', []);
                expect(steps.where).toContain('NOT (steps = ?)');
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

            it('should handle manual collections by returning collectionId for INNER JOIN', () => {
                const { where, params, collectionId } = buildSqlWhereClause({ ...defaultFilters, collectionId: 'col1' }, false, 'blur', [], mockCollections);
                // Manual collections don't add WHERE clause - INNER JOIN is used in searchRepo instead
                expect(collectionId).toBe('col1');
                // Base conditions should still be present
                expect(where).toContain('is_deleted = 0');
            });

            it('should handle smart collections (hybrid mode)', () => {
                const { where, params } = buildSqlWhereClause({ ...defaultFilters, collectionId: 'col2' }, false, 'blur', [], mockCollections);
                expect(where).toContain("positive_prompt LIKE ?"); // From smart filters
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

            it('should pre-empt smart collection custom date if global custom date is set', () => {
                const smartColWithDate: Collection = {
                    id: 'col_custom_date',
                    name: 'Custom Date Collection',
                    imageIds: [],
                    createdAt: Date.now(),
                    filters: {
                        ...defaultFilters,
                        dateRange: 'custom',
                        dateFrom: '2026-03-01',
                        dateTo: '2026-03-31'
                    },
                };
                const { where, params } = buildSqlWhereClause(
                    {
                        ...defaultFilters,
                        collectionId: 'col_custom_date',
                        dateRange: 'custom',
                        dateFrom: '2026-04-01',
                        dateTo: '2026-04-30'
                    },
                    false, 'blur', [], [smartColWithDate]
                );

                expect(where.match(/timestamp >= \?/g) ?? []).toHaveLength(1);
                expect(where.match(/timestamp < \?/g) ?? []).toHaveLength(1);
                expect(params).toEqual([
                    new Date(2026, 3, 1).getTime(),
                    new Date(2026, 4, 1).getTime()
                ]);
            });

            it('applies smart collection manual exclusions', () => {
                const collection: Collection = {
                    id: 'smart-exclusions', name: 'Smart exclusions', imageIds: [], createdAt: 1,
                    filters: { ...defaultFilters, favoritesOnly: true },
                    manualExclusions: ['image-1', 'image-2']
                };
                const result = buildSqlWhereClause(
                    { ...defaultFilters, collectionId: collection.id }, false, 'blur', [], [collection]
                );
                expect(result.where).toContain('id NOT IN (?,?)');
                expect(result.params).toEqual(['image-1', 'image-2']);
            });
        });

        it('handles Unknown models, tool Match All, aliases, ranges, sampler and generation filters', () => {
            const filters: FilterState = {
                ...defaultFilters,
                models: ['Unknown'],
                tools: [GeneratorTool.COMFYUI, GeneratorTool.INVOKEAI],
                embeddings: ['Easy', 'Bad'],
                hypernetworks: ['Hyper A', 'Hyper B'],
                controlNets: ['Canny', 'Depth'],
                ipAdapters: ['Face', 'Style'],
                samplers: ['DPM++_2M-Karras'],
                generationTypes: ['txt2img', 'img2img'],
                minSteps: 10, maxSteps: 40, minCfg: 3, maxCfg: 12,
                matchModes: {
                    tools: 'all', embeddings: 'all', hypernetworks: 'all', controlNets: 'all', ipAdapters: 'all'
                },
                assetFilterAliases: {
                    embeddings: { Easy: [' Easy ', 'easy', '', 'Easy (1.0)'] },
                    hypernetworks: { 'Hyper A': ['Hyper A', 'Hyper A:0.8'] },
                    controlNets: { Canny: ['Canny', 'Canny (0.5)'] },
                    ipAdapters: { Face: ['Face', 'Face:0.7'] }
                }
            };
            const { where, params } = buildSqlWhereClause(filters, false, 'blur', []);
            expect(where).toContain("resolved_model_name IS NULL");
            expect(where).toContain('tool = ? COLLATE NOCASE AND tool = ? COLLATE NOCASE');
            expect(where).toContain('steps >= ?');
            expect(where).toContain('steps <= ?');
            expect(where).toContain('cfg >= ?');
            expect(where).toContain('cfg <= ?');
            expect(where).toContain('sampler = ?');
            expect(where).toContain('generation_type = ?');
            expect(params).toContain('dpm++ 2m karras');
        });

        it('omits every explicitly excluded facet category', () => {
            const filters: FilterState = {
                ...defaultFilters,
                models: ['Flux'], tools: [GeneratorTool.COMFYUI], loras: ['Lora A', 'Lora B'],
                embeddings: ['Embed'], hypernetworks: ['Hyper'], controlNets: ['Canny'],
                ipAdapters: ['Face'], samplers: ['Euler'], generationTypes: ['txt2img']
            };
            const result = buildSqlWhereClause(
                filters, false, 'blur', [], undefined, false,
                ['models', 'tools', 'loras', 'embeddings', 'hypernetworks', 'controlNets', 'ipAdapters', 'samplers', 'generationTypes']
            );
            expect(result.where).not.toContain('resolved_model_name = ?');
            expect(result.where).not.toContain('image_loras');
            expect(result.where).not.toContain('sampler = ?');
            expect(result.params).toEqual([]);
        });

        it('allows intermediates and grids and uses Match Any for ControlNet and IP-Adapter filters', () => {
            const result = buildSqlWhereClause({
                ...defaultFilters,
                showIntermediates: true,
                showGrids: true,
                controlNets: ['Canny', 'Depth'],
                ipAdapters: ['Face', 'Style'],
                matchModes: { controlNets: 'any', ipAdapters: 'any' }
            }, false, 'blur', []);
            expect(result.where).not.toContain('is_intermediate_gen');
            expect(result.where).not.toContain('is_grid_gen');
            expect(result.where).toContain('image_controlnets');
            expect(result.where).toContain(') OR EXISTS (');
        });

        describe('Match Modes', () => {
            it('should default to OR logic for multiple loras (Match Any)', () => {
                const { where } = buildSqlWhereClause({ ...defaultFilters, loras: ['LoraA', 'LoraB'] }, false, 'blur', []);
                // Should use OR between EXISTS
                expect(where).toContain(') OR EXISTS (');
                expect(where).not.toContain(') AND EXISTS (');
            });

            it('should use AND logic when matchMode is ALL', () => {
                const { where } = buildSqlWhereClause({
                    ...defaultFilters,
                    loras: ['LoraA', 'LoraB'],
                    matchModes: { loras: 'all' }
                }, false, 'blur', []);

                // Should use AND between EXISTS
                expect(where).toContain(') AND EXISTS (');
                // Should NOT contain OR logic between EXISTS
                expect(where).not.toContain(') OR EXISTS (');
            });

            it('should keep alias groups OR-ed while Match All combines selected assets with AND', () => {
                const { where, params } = buildSqlWhereClause({
                    ...defaultFilters,
                    loras: ['Detailer-Style', 'PortraitBoost'],
                    matchModes: { loras: 'all' },
                    assetFilterAliases: {
                        loras: {
                            'Detailer-Style': ['Detailer-Style', 'detailer style'],
                            PortraitBoost: ['PortraitBoost']
                        }
                    }
                }, false, 'blur', []);

                expect(where).toContain("instr(il.lora_name, ' (')");
                expect(where).toContain(') OR EXISTS');
                expect(where).toContain(') AND EXISTS (');
                expect(params).toEqual(['Detailer-Style', 'detailer style', 'PortraitBoost']);
            });

            it('should use OR logic when matchMode is explicitly ANY', () => {
                const { where } = buildSqlWhereClause({
                    ...defaultFilters,
                    loras: ['LoraA', 'LoraB'],
                    matchModes: { loras: 'any' }
                }, false, 'blur', []);
                expect(where).toContain(') OR EXISTS (');
            });
        });
    });
});
