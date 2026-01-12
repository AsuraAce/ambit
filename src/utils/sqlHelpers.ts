import { FilterState, AppSettings, Collection } from '../types';

export const buildSqlWhereClause = (
    filters: FilterState,
    privacyEnabled: boolean,
    maskingMode: AppSettings['maskingMode'],
    maskedKeywords: string[],
    collections?: Collection[],
    isRecursive: boolean = false,
    excludeCategories: string[] = [] // New: Categories to exclude from the WHERE clause (for Disjunctive Faceting)
): { where: string; params: any[]; collectionId?: string; loraName?: string } => {
    const conditions: string[] = [];
    const params: any[] = [];

    // Base Condition: Not Deleted
    if (!isRecursive) {
        conditions.push('is_deleted = 0');

        if (!filters.showIntermediates) {
            conditions.push("(is_intermediate_gen IS NULL OR is_intermediate_gen != 1)");
        }
        if (!filters.showGrids) {
            // Use indexed is_grid_gen column only - no json_extract needed
            conditions.push("(is_grid_gen IS NULL OR is_grid_gen != 1)");
        }
    }

    // 1. Privacy Logic
    if (privacyEnabled && maskingMode === 'hide' && maskedKeywords.length > 0) {
        // Construct NOT LIKE clauses for each keyword
        const privacyConditions = maskedKeywords.map(kw => {
            params.push(`%${kw}%`);
            return `metadata_json NOT LIKE ?`;
        });
        conditions.push(`(${privacyConditions.join(' AND ')})`);
    }

    // 2. Collection ID (Hybrid Logic)
    // NOTE: For manual collection filtering, we DON'T add a WHERE clause here.
    // Instead, the collectionId is returned separately and searchRepo uses INNER JOIN 
    // with collection_images for much better performance (starts from smaller table).
    if (filters.collectionId) {
        const col = collections?.find(c => c.id === filters.collectionId);
        const subConditions: string[] = [];

        // ONLY add smart filter rules to WHERE - manual inclusions handled via INNER JOIN

        // B. Smart Filter Rules (Hybrid Mode)
        // If the collection defines smart rules, we combine them with manual inclusions using OR.
        // If the collection defines smart rules, we combine them with manual inclusions using OR.
        if (col && col.filters) {
            /** 
             * DATE PRE-EMPTION LOGIC:
             * If the user has selected a GLOBAL date filter (e.g. "Today") in the filter panel,
             * it should take precedence over any date range saved inside the smart collection's own rules.
             * This allows "narrowing down" a smart collection by date.
             */
            const effectiveSmartFilters = { ...col.filters };
            if (filters.dateRange !== 'all') {
                effectiveSmartFilters.dateRange = 'all'; // Disable internal date rule to let global one apply
            }

            // Recursively build conditions for the smart rules
            // We set isRecursive=true to skip repeating base constraints (is_deleted, privacy)
            const { where: smartWhere, params: smartParams } = buildSqlWhereClause(
                effectiveSmartFilters,
                false,   // privacy handled by parent
                'blur',
                [],
                [],
                true     // isRecursive
            );

            if (smartWhere) {
                subConditions.push(`(${smartWhere})`);
                params.push(...smartParams);
            }
        }

        if (subConditions.length > 0) {
            let combined = `(${subConditions.join(' OR ')})`;

            // C. Manual Exclusions
            if (col && col.manualExclusions && col.manualExclusions.length > 0) {
                const placeholders = col.manualExclusions.map(() => '?').join(',');
                combined = `(${combined} AND id NOT IN (${placeholders}))`;
                params.push(...col.manualExclusions);
            }

            conditions.push(combined);
        }
    }


    // 3. Favorites
    if (filters.favoritesOnly) {
        conditions.push('is_favorite = 1');
    }

    // 4. Pinned Only
    if (filters.pinnedOnly) {
        conditions.push('is_pinned = 1');
    }

    // 5. Models (Array) - Use denormalized resolved_model_name and model_hash columns
    if (filters.models.length > 0 && !excludeCategories.includes('models')) {
        const matchMode = filters.matchModes?.models || 'any';
        const modelConditions = filters.models.map(m => {
            if (m === 'Unknown') {
                return `(resolved_model_name IS NULL OR resolved_model_name = '' OR resolved_model_name = 'Unknown')`;
            }
            params.push(m);
            // Use indexed resolved_model_name column for fast lookup
            return `resolved_model_name = ?`;
        });
        conditions.push(`(${modelConditions.join(matchMode === 'all' ? ' AND ' : ' OR ')})`);
    }

    // 5. Tools (Array) - Use denormalized tool column
    if (filters.tools.length > 0 && !excludeCategories.includes('tools')) {
        const matchMode = filters.matchModes?.tools || 'any';
        const toolConditions = filters.tools.map(t => {
            if (t === 'Unknown') {
                return `(tool = 'Unknown' OR tool IS NULL)`;
            }
            params.push(t);
            return `tool = ?`;
        });
        conditions.push(`(${toolConditions.join(matchMode === 'all' ? ' AND ' : ' OR ')})`);
    }

    // 6. LoRAs, Embeddings, Hypernetworks - Use denormalized junction tables for fast filtering
    // For SINGLE lora filter, we skip adding WHERE and use INNER JOIN in searchRepo instead (like collections)
    // UNLESS matchMode is 'all', in which case we might want to force standard behavior for consistency, 
    // but single 'AND' is same as single 'OR', so optimization is still valid for length=1.
    // For multiple loras (OR condition), we still use EXISTS

    // LoRAs
    const loraMode = filters.matchModes?.loras || 'any';
    if (!excludeCategories.includes('loras')) {
        if (filters.loras.length === 1 && loraMode === 'any') {
            // Single lora - will use INNER JOIN in searchRepo, don't add WHERE condition
            // The loraName is returned and handled by searchRepo
        } else if (filters.loras.length > 0) {
            const loraConditions = filters.loras.map(l => {
                params.push(l);
                return `EXISTS (SELECT 1 FROM image_loras il WHERE il.image_id = id AND il.lora_name = ?)`;
            });
            conditions.push(`(${loraConditions.join(loraMode === 'all' ? ' AND ' : ' OR ')})`);
        }
    }

    // Embeddings
    const embMode = filters.matchModes?.embeddings || 'any';
    if (filters.embeddings.length > 0 && !excludeCategories.includes('embeddings')) {
        const embConditions = filters.embeddings.map(e => {
            params.push(e);
            return `EXISTS (SELECT 1 FROM image_embeddings ie WHERE ie.image_id = id AND ie.embedding_name = ?)`;
        });
        conditions.push(`(${embConditions.join(embMode === 'all' ? ' AND ' : ' OR ')})`);
    }

    // Hypernetworks
    const hnMode = filters.matchModes?.hypernetworks || 'any';
    if (filters.hypernetworks.length > 0 && !excludeCategories.includes('hypernetworks')) {
        const hnConditions = filters.hypernetworks.map(h => {
            params.push(h);
            return `EXISTS (SELECT 1 FROM image_hypernetworks ih WHERE ih.image_id = id AND ih.hypernetwork_name = ?)`;
        });
        conditions.push(`(${hnConditions.join(hnMode === 'all' ? ' AND ' : ' OR ')})`);
    }

    // 7. Search Query (Advanced)
    if (filters.searchQuery) {
        // Regex to handle quoted phrases or single terms, optionally prefixed with - or !
        const termRegex = /(-|!)?("(?:[^"\\]|\\.)*"|\S+)/g;
        let match;

        while ((match = termRegex.exec(filters.searchQuery)) !== null) {
            const prefix = match[1]; // - or !
            const isNegative = !!prefix;
            let term = match[2];

            // Remove quotes if present
            if (term.startsWith('"') && term.endsWith('"')) {
                term = term.slice(1, -1).replace(/\\"/g, '"');
            }

            const lowerTerm = term.toLowerCase();
            if (lowerTerm.includes(':') && !lowerTerm.startsWith(':')) {
                const [key, val] = lowerTerm.split(':');
                const isNumeric = ['steps', 'cfg', 'w', 'width', 'h', 'height'].includes(key);

                let sql = '';
                let param: any = val;

                if (key === 'steps') {
                    if (val.startsWith('>')) { sql = "CAST(json_extract(metadata_json, '$.steps') AS INTEGER) > ?"; param = Number(val.slice(1)); }
                    else if (val.startsWith('<')) { sql = "CAST(json_extract(metadata_json, '$.steps') AS INTEGER) < ?"; param = Number(val.slice(1)); }
                    else { sql = "CAST(json_extract(metadata_json, '$.steps') AS INTEGER) = ?"; param = Number(val); }
                } else if (key === 'cfg') {
                    if (val.startsWith('>')) { sql = "CAST(json_extract(metadata_json, '$.cfg') AS FLOAT) > ?"; param = Number(val.slice(1)); }
                    else if (val.startsWith('<')) { sql = "CAST(json_extract(metadata_json, '$.cfg') AS FLOAT) < ?"; param = Number(val.slice(1)); }
                    else { sql = "CAST(json_extract(metadata_json, '$.cfg') AS FLOAT) = ?"; param = Number(val); }
                } else if (key === 'w' || key === 'width') {
                    if (val.startsWith('>')) { sql = "width > ?"; param = Number(val.slice(1)); }
                    else if (val.startsWith('<')) { sql = "width < ?"; param = Number(val.slice(1)); }
                    else { sql = "width = ?"; param = Number(val); }
                } else if (key === 'h' || key === 'height') {
                    if (val.startsWith('>')) { sql = "height > ?"; param = Number(val.slice(1)); }
                    else if (val.startsWith('<')) { sql = "height < ?"; param = Number(val.slice(1)); }
                    else { sql = "height = ?"; param = Number(val); }
                } else if (key === 'model') {
                    // Search specific model entries only - prevents matching random JSON keys like "scheuler"
                    sql = `(resolved_model_name LIKE ? OR json_extract(metadata_json, '$.model') LIKE ?)`;
                    param = `%${val}%`;
                    // Push param twice for the two ? placeholders
                    conditions.push(sql);
                    params.push(param);
                    params.push(param);
                    continue; // Skip the normal sql handling below
                } else if (key === 'seed') {
                    sql = `json_extract(metadata_json, '$.seed') LIKE ?`;
                    param = `%${val}%`;
                } else if (key === 'neg' || key === 'negative') {
                    sql = `json_extract(metadata_json, '$.negativePrompt') LIKE ?`;
                    param = `%${val}%`;
                } else if (key === 'file' || key === 'filename' || key === 'path') {
                    // Search filename/path only
                    sql = `path LIKE ?`;
                    param = `%${val}%`;
                } else if (key === 'all') {
                    // Legacy behavior: search everything (path + full metadata)
                    if (isNegative) {
                        conditions.push(`(path NOT LIKE ? AND metadata_json NOT LIKE ?)`);
                    } else {
                        conditions.push(`(path LIKE ? OR metadata_json LIKE ?)`);
                    }
                    params.push(`%${val}%`);
                    params.push(`%${val}%`);
                    continue; // Skip the normal sql handling below
                } else if (key === 'sampler') {
                    // Use indexed column
                    sql = `sampler LIKE ?`;
                    param = `%${val}%`;
                } else if (key === 'tool') {
                    // Use indexed column
                    sql = `tool LIKE ?`;
                    param = `%${val}%`;
                } else if (key === 'lora') {
                    // Use normalized junction table for accurate lookup
                    sql = `EXISTS (SELECT 1 FROM image_loras il WHERE il.image_id = id AND il.lora_name LIKE ?)`;
                    param = `%${val}%`;
                } else if (key === 'upscaled') {
                    sql = `json_extract(metadata_json, '$.upscaled') = ?`;
                    param = val === 'true' ? 1 : 0;
                }

                if (sql) {
                    if (isNegative) {
                        conditions.push(`NOT (${sql})`);
                    } else {
                        conditions.push(sql);
                    }
                    params.push(param);
                }
            } else {
                // General text search - POSITIVE PROMPT ONLY (not negative prompt or metadata blob)
                // This prevents semantic inversions where searching "nsfw" matches images avoiding NSFW
                if (isNegative) {
                    conditions.push(`json_extract(metadata_json, '$.positivePrompt') NOT LIKE ?`);
                } else {
                    conditions.push(`json_extract(metadata_json, '$.positivePrompt') LIKE ?`);
                }
                params.push(`%${term}%`);
            }
        }
    }

    // 8. Range Sliders - Use denormalized columns (perf: no json_extract!)
    if (filters.minSteps !== undefined) {
        conditions.push("steps >= ?");
        params.push(filters.minSteps);
    }
    if (filters.maxSteps !== undefined) {
        conditions.push("steps <= ?");
        params.push(filters.maxSteps);
    }
    if (filters.minCfg !== undefined) {
        conditions.push("cfg >= ?");
        params.push(filters.minCfg);
    }
    if (filters.maxCfg !== undefined) {
        conditions.push("cfg <= ?");
        params.push(filters.maxCfg);
    }

    // 9. Samplers (Array) - Use denormalized sampler column (already normalized)
    if (filters.samplers && filters.samplers.length > 0 && !excludeCategories.includes('samplers')) {
        const samplerConditions = filters.samplers.map(() => {
            return `sampler = ?`;
        });
        // Push normalized values to match the pre-normalized column
        filters.samplers.forEach(s => params.push(s.toLowerCase().replace(/[_-]/g, ' ')));
        conditions.push(`(${samplerConditions.join(' OR ')})`);
    }

    // 10. Generation Types (Array) - Use denormalized generation_type column
    if (filters.generationTypes && filters.generationTypes.length > 0 && !excludeCategories.includes('generationTypes')) {
        const genTypeConditions = filters.generationTypes.map(() => {
            return `generation_type = ?`;
        });
        filters.generationTypes.forEach(gt => params.push(gt));
        conditions.push(`(${genTypeConditions.join(' OR ')})`);
    }

    // 11. Date Range

    if (filters.dateRange !== 'all') {
        const midnight = new Date();
        midnight.setHours(0, 0, 0, 0);
        const todayStart = midnight.getTime();
        const day = 24 * 60 * 60 * 1000;

        let cutOff = 0;
        if (filters.dateRange === 'today') cutOff = todayStart;
        if (filters.dateRange === 'week') cutOff = todayStart - (7 * day);
        if (filters.dateRange === 'month') cutOff = todayStart - (30 * day);

        if (cutOff > 0) {
            conditions.push('timestamp >= ?');
            params.push(cutOff);
        }
    }

    const where = conditions.length > 0 ? (isRecursive ? conditions.join(' AND ') : `WHERE ${conditions.join(' AND ')}`) : '';

    // Return collectionId for INNER JOIN optimization in searchRepo
    // Only for non-smart collections (manual collections) that don't have filter rules
    const col = collections?.find(c => c.id === filters.collectionId);
    const isManualOnly = filters.collectionId && (!col?.filters);

    // Return loraName for single-lora filter INNER JOIN optimization
    // OPTIMIZATION: Only use if matchMode is 'any' (default). 
    // If 'all', we might have logic differences (though for length=1 they are identical).
    // CRITICAL: Do NOT return loraName if 'loras' is excluded (Disjunctive Faceting)
    const loraModeCheck = filters.matchModes?.loras || 'any';
    const loraExcluded = excludeCategories.includes('loras');
    const singleLoraName = (!loraExcluded && filters.loras.length === 1 && loraModeCheck === 'any') ? filters.loras[0] : undefined;

    return {
        where,
        params,
        collectionId: isManualOnly ? filters.collectionId ?? undefined : undefined,
        loraName: singleLoraName
    };
};
